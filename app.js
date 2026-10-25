
(function () {
  "use strict";

  const LS_AI_KEY = "gj_health_deepseek_key";
  const LS_AI_MODEL = "gj_health_deepseek_model";
  const LS_MACROS = "gj_health_macros_v1";
  const LS_DIALS = "gj_health_dials_v1";
  const LS_PROXY_F = "gj_health_proxy_fundies_v1";
  const LS_RUN = "gj_health_gates_v1";

  const CLUSTERS = [
    { id: "surat_textiles_weaving", name: "Surat textiles - weaving", region: "Surat" },
    { id: "surat_textiles_processing", name: "Surat textiles - processing", region: "Surat" },
    { id: "morbi_ceramics", name: "Morbi ceramics", region: "Morbi" },
    { id: "vapi_ankleshwar_chemicals", name: "Vapi-Ankleshwar chemicals", region: "South Gujarat" },
    { id: "diamonds_jewellery", name: "Diamonds / jewellery", region: "Surat / retail proxy" },
    { id: "auto_ancillary", name: "Auto / ancillary", region: "Gujarat footprint" },
    { id: "ports_logistics", name: "Ports / logistics", region: "Mundra / Hazira / Kandla" },
    { id: "renewables", name: "Renewables", region: "Gujarat RE" },
  ];

  const DIAL_KEYS = [
    { key: "demand", label: "Demand", formula: "orders / utilisation / export enquiry", invert: false },
    { key: "cost", label: "Cost (power/fuel/wage)", formula: "Rising cost = unhealthy", invert: true },
    { key: "wc", label: "WC / receivables stress", formula: "Rising stress = unhealthy", invert: true },
    { key: "policy", label: "Policy / export", formula: "duty, FTA, BIS, export incentive", invert: false },
  ];

  const MACRO_KEYS = [
    ["gsdp_yoy", "GSDP YoY %", "state accounts"],
    ["iip_gujarat", "Gujarat IIP YoY %", "DES / MoSPI"],
    ["state_gst", "State GST", "₹ cr or YoY"],
    ["power_dgvcl", "DGVCL power", "MU / %"],
    ["power_mgvcl", "MGVCL power", "MU / %"],
    ["port_mundra", "Mundra throughput", "MT / %"],
    ["port_hazira", "Hazira throughput", "MT / %"],
    ["port_kandla", "Kandla throughput", "MT / %"],
    ["rbi_gujarat_credit", "RBI Gujarat credit growth", "%"],
    ["rainfall_agri", "Rainfall / agri note", "qualitative OK"],
  ];

  let snapshot = { market: {}, proxies: {}, proxy_map: {}, macros: {}, warnings: [] };
  let macros = {};
  let dials = {};
  let proxyFundies = {};
  let run = defaultRun();

  try { macros = JSON.parse(localStorage.getItem(LS_MACROS) || "{}") || {}; } catch (e) { macros = {}; }
  try { dials = JSON.parse(localStorage.getItem(LS_DIALS) || "{}") || {}; } catch (e) { dials = {}; }
  try { proxyFundies = JSON.parse(localStorage.getItem(LS_PROXY_F) || "{}") || {}; } catch (e) { proxyFundies = {}; }
  try {
    var saved = JSON.parse(localStorage.getItem(LS_RUN) || "null");
    if (saved && saved.g1) run = Object.assign(defaultRun(), saved);
  } catch (e) {}

  function defaultRun() {
    return {
      current: 1,
      stoppedAt: null,
      stopReason: null,
      clusterId: "surat_textiles_weaving",
      g1: { sentence: "" },
      g2: { notes: "" },
      g3: { flips: {} },
      g4: { pricedIn: "", evidence: "", gap: "" },
      g5: { notes: "" },
    };
  }

  function saveMacros() { localStorage.setItem(LS_MACROS, JSON.stringify(macros)); }
  function saveDials() { localStorage.setItem(LS_DIALS, JSON.stringify(dials)); }
  function saveProxyF() { localStorage.setItem(LS_PROXY_F, JSON.stringify(proxyFundies)); }
  function saveRun() { localStorage.setItem(LS_RUN, JSON.stringify(run)); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function clusterById(id) {
    return CLUSTERS.find(function (c) { return c.id === id; }) || CLUSTERS[0];
  }

  function ensureClusterDials(id) {
    if (!dials[id]) {
      dials[id] = { demand: "unknown", cost: "unknown", wc: "unknown", policy: "unknown", notes: "" };
    }
    return dials[id];
  }

  function majorityDirection(dirs) {
    var known = dirs.filter(function (d) { return d && d !== "unknown" && d !== "flat"; });
    if (known.length < 1) return { score: "Unclear", detail: "insufficient" };
    var rising = known.filter(function (d) { return d === "rising"; }).length;
    var falling = known.filter(function (d) { return d === "falling"; }).length;
    var n = known.length;
    if (rising / n >= 0.6) return { score: "Rising", detail: rising + "/" + n };
    if (falling / n >= 0.6) return { score: "Falling", detail: falling + "/" + n };
    return { score: "Unclear", detail: "mixed " + rising + "↑ " + falling + "↓" };
  }

  /** Map dial raw dir to health signal: +1 healthy, -1 unhealthy, 0 unclear */
  function dialHealthSignal(key, dir) {
    if (!dir || dir === "unknown" || dir === "flat") return 0;
    var inv = key === "cost" || key === "wc";
    if (dir === "rising") return inv ? -1 : 1;
    if (dir === "falling") return inv ? 1 : -1;
    return 0;
  }

  function scoreCluster(id) {
    var d = ensureClusterDials(id);
    var signals = DIAL_KEYS.map(function (dk) {
      return { key: dk.key, raw: d[dk.key] || "unknown", health: dialHealthSignal(dk.key, d[dk.key]) };
    });
    var known = signals.filter(function (s) { return s.health !== 0; });
    if (known.length < 2) {
      return { health: "Unclear", detail: "need ≥2 known dials", signals: signals, dialScores: {} };
    }
    var up = known.filter(function (s) { return s.health > 0; }).length;
    var down = known.filter(function (s) { return s.health < 0; }).length;
    var health = "Mixed";
    if (up >= 3 && down === 0) health = "Strong";
    else if (down >= 3 && up === 0) health = "Weak";
    else if (up > down && down <= 1) health = "Strong";
    else if (down > up && up <= 1) health = "Weak";
    else if (up === 0 && down === 0) health = "Unclear";
    var dialScores = {};
    DIAL_KEYS.forEach(function (dk) {
      dialScores[dk.key] = majorityDirection([d[dk.key] || "unknown"]).score;
    });
    return {
      health: health,
      detail: up + " healthy / " + down + " unhealthy of " + known.length + " known",
      signals: signals,
      dialScores: dialScores,
    };
  }

  function proxyList(clusterId) {
    var map = snapshot.proxy_map || {};
    return map[clusterId] || [];
  }

  function proxyQuote(sym) {
    return (snapshot.proxies && snapshot.proxies[sym]) || {};
  }

  function divergence(clusterId) {
    var sc = scoreCluster(clusterId);
    var syms = proxyList(clusterId);
    var dirs = syms.map(function (s) { return proxyQuote(s).direction_1m || "unknown"; });
    var known = dirs.filter(function (d) { return d === "rising" || d === "falling"; });
    if (known.length < 2 || sc.health === "Unclear" || sc.health === "Mixed") {
      return { flag: false, reason: "insufficient for divergence test", rising: 0, falling: 0, health: sc.health };
    }
    var rising = known.filter(function (d) { return d === "rising"; }).length;
    var falling = known.filter(function (d) { return d === "falling"; }).length;
    var disagree = false;
    var reason = "aligned";
    if (sc.health === "Strong" && falling / known.length >= 0.5) {
      disagree = true;
      reason = "Cluster Strong but ≥50% proxies falling 1m";
    }
    if (sc.health === "Weak" && rising / known.length >= 0.5) {
      disagree = true;
      reason = "Cluster Weak but ≥50% proxies rising 1m";
    }
    return { flag: disagree, reason: reason, rising: rising, falling: falling, health: sc.health, known: known.length };
  }

  async function callDeepSeek(messages) {
    var key = ((document.getElementById("ai-key") || {}).value || "").trim() || localStorage.getItem(LS_AI_KEY) || "";
    var model = ((document.getElementById("ai-model") || {}).value) || localStorage.getItem(LS_AI_MODEL) || "deepseek-chat";
    if (!key) throw new Error("Paste DeepSeek API key in Settings first.");
    var res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: model, temperature: 0.2, response_format: { type: "json_object" }, messages: messages }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var msg = (data.error && (data.error.message || data.error)) || res.statusText;
      throw new Error("DeepSeek " + res.status + ": " + msg);
    }
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    try { return JSON.parse(content); } catch (e) {
      var m = String(content || "").match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Could not parse JSON from DeepSeek");
    }
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    ["ops", "board", "macros", "settings"].forEach(function (id) {
      document.getElementById("view-" + id).classList.toggle("hidden", id !== name);
    });
    if (name === "board") renderBoard();
    if (name === "macros") renderMacros();
  }

  document.getElementById("tabs").addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (t) switchTab(t.dataset.tab);
  });

  document.getElementById("btn-save-ai").onclick = function () {
    var k = document.getElementById("ai-key").value.trim();
    var m = document.getElementById("ai-model").value;
    if (k) localStorage.setItem(LS_AI_KEY, k);
    localStorage.setItem(LS_AI_MODEL, m);
    var st = document.getElementById("ai-settings-status");
    st.textContent = k ? "Saved locally." : "Model saved; key empty.";
    st.className = "status ok";
  };
  document.getElementById("btn-clear-ai").onclick = function () {
    localStorage.removeItem(LS_AI_KEY);
    document.getElementById("ai-key").value = "";
    document.getElementById("ai-settings-status").textContent = "Key cleared.";
  };

  function dirSelect(id, val) {
    var opts = ["unknown", "rising", "flat", "falling"];
    return '<select id="' + id + '" class="blue">' + opts.map(function (o) {
      return '<option value="' + o + '"' + (val === o ? " selected" : "") + ">" + o + "</option>";
    }).join("") + "</select>";
  }

  function renderMacros() {
    var root = document.getElementById("macros-form");
    var snapM = snapshot.macros || {};
    root.innerHTML = MACRO_KEYS.map(function (row) {
      var k = row[0], label = row[1], hint = row[2];
      var seed = macros[k];
      if (seed == null && snapM[k] && snapM[k].value != null) seed = snapM[k].value;
      var dir = macros[k + "_dir"] || "unknown";
      return '<label class="field">' + escapeHtml(label) +
        '<span class="formula">input · ' + escapeHtml(hint) + "</span>" +
        '<input class="blue" data-macro="' + k + '" value="' + escapeHtml(seed == null ? "" : seed) + '"/>' +
        '<span class="formula">direction</span>' + dirSelect("macro-dir-" + k, dir) +
        "</label>";
    }).join("");
    document.getElementById("macro-warnings").innerHTML =
      (snapshot.warnings || []).map(function (w) { return "⚠ " + escapeHtml(w); }).join("<br/>") ||
      "No fetch warnings.";
  }

  document.getElementById("btn-save-macros").onclick = function () {
    document.querySelectorAll("[data-macro]").forEach(function (el) {
      var k = el.getAttribute("data-macro");
      macros[k] = el.value;
      macros._ev = macros._ev || {};
      macros._ev[k] = "manual";
      var d = document.getElementById("macro-dir-" + k);
      if (d) { macros[k + "_dir"] = d.value; macros._ev[k + "_dir"] = "manual"; }
    });
    saveMacros();
    document.getElementById("macros-status").textContent = "Macros saved locally.";
    document.getElementById("macros-status").className = "status ok";
  };

  document.getElementById("btn-ai-macros").onclick = async function () {
    var st = document.getElementById("macros-status");
    st.className = "status loading"; st.textContent = "Calling DeepSeek…";
    try {
      var data = await callDeepSeek([
        { role: "system", content: "Gujarat macro assistant for credit field work. JSON object with keys gsdp_yoy,iip_gujarat,state_gst,power_dgvcl,power_mgvcl,port_mundra,port_hazira,port_kandla,rbi_gujarat_credit,rainfall_agri and optional *_dir (rising|falling|flat|unknown) plus warnings[]. CRITICAL: never invent numbers - if unknown leave null and warn. Values may be strings for qualitative notes." },
        { role: "user", content: "Fill latest Gujarat state macros if you have public knowledge. Snapshot market: " + JSON.stringify(snapshot.market || {}).slice(0, 2500) + " Existing: " + JSON.stringify(macros).slice(0, 1500) },
      ]);
      macros._ev = macros._ev || {};
      MACRO_KEYS.forEach(function (row) {
        var k = row[0];
        if (data[k] != null && data[k] !== "") {
          macros[k] = data[k];
          macros._ev[k] = "ai";
        }
        if (data[k + "_dir"]) {
          macros[k + "_dir"] = data[k + "_dir"];
          macros._ev[k + "_dir"] = "ai";
        }
      });
      saveMacros();
      st.className = "status ok";
      st.textContent = "AI fill applied (tagged ai). Verify state releases." + (data.warnings ? " " + data.warnings.join("; ") : "");
      renderMacros();
    } catch (e) {
      st.className = "status err"; st.textContent = String(e.message || e);
    }
  };

  function renderBoard() {
    var sel = document.getElementById("cluster-select");
    if (!sel.options.length) {
      sel.innerHTML = CLUSTERS.map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.name) + "</option>";
      }).join("");
    }
    if (run.clusterId) sel.value = run.clusterId;
    sel.onchange = function () {
      run.clusterId = sel.value;
      saveRun();
      renderBoard();
    };
    var id = sel.value || run.clusterId;
    run.clusterId = id;
    var d = ensureClusterDials(id);
    var sc = scoreCluster(id);
    document.getElementById("cluster-health").innerHTML =
      '<span class="pill ' + sc.health.toLowerCase() + '">' + escapeHtml(sc.health) + "</span> " +
      '<span class="muted">' + escapeHtml(sc.detail) + " · " + escapeHtml(clusterById(id).region) + "</span>";

    document.getElementById("dials-form").innerHTML = DIAL_KEYS.map(function (dk) {
      return '<label class="field">' + escapeHtml(dk.label) +
        '<span class="formula">' + escapeHtml(dk.formula) + (dk.invert ? " · inverted in health" : "") + "</span>" +
        dirSelect("dial-" + dk.key, d[dk.key] || "unknown") + "</label>";
    }).join("") +
      '<label class="field" style="flex:2">Notes<textarea id="dial-notes" class="blue">' + escapeHtml(d.notes || "") + "</textarea></label>";

    // proxies table
    var syms = proxyList(id);
    var rows = syms.map(function (sym) {
      var q = proxyQuote(sym);
      var f = proxyFundies[sym] || {};
      return "<tr><td><strong>" + escapeHtml(sym) + "</strong><div class=\"muted\">proxy</div></td>" +
        "<td>" + (q.value != null ? escapeHtml(String(Math.round(q.value * 100) / 100)) : "null") +
        "<div class=\"muted\">" + escapeHtml(q.as_of || "") + "</div></td>" +
        "<td>" + escapeHtml(q.direction_1m || "unknown") +
        (q.change_1m_pct != null ? " (" + q.change_1m_pct + "%)" : "") + "</td>" +
        '<td><input class="blue" style="width:70px" data-pf="' + sym + '" data-fk="rev" placeholder="rev%" value="' + escapeHtml(f.rev || "") + '"/></td>' +
        '<td><input class="blue" style="width:70px" data-pf="' + sym + '" data-fk="ebitda" placeholder="EBITDA%" value="' + escapeHtml(f.ebitda || "") + '"/></td>' +
        '<td><input class="blue" style="width:70px" data-pf="' + sym + '" data-fk="debt" placeholder="D/EBITDA" value="' + escapeHtml(f.debt || "") + '"/></td>' +
        '<td><input class="blue" style="width:70px" data-pf="' + sym + '" data-fk="days" placeholder="rec/inv d" value="' + escapeHtml(f.days || "") + '"/></td>' +
        "</tr>";
    }).join("");
    document.getElementById("proxies-table").innerHTML =
      "<table><tr><th>Proxy (≠ buy)</th><th>Price</th><th>1m dir</th><th>Rev g%</th><th>EBITDA%</th><th>Debt/EBITDA</th><th>Days</th></tr>" +
      rows + "</table>" +
      '<p class="muted" style="margin-top:6px">Fundie fields are manual/AI from latest results - leave blank if unknown.</p>';

    var div = divergence(id);
    document.getElementById("divergence-box").innerHTML = div.flag
      ? '<div class="verdict stop">DIVERGENCE · ' + escapeHtml(div.reason) + "</div>"
      : '<div class="muted">Divergence check: ' + escapeHtml(div.reason) +
        " (proxies ↑" + div.rising + " ↓" + div.falling + ")</div>";
  }

  document.getElementById("btn-save-dials").onclick = function () {
    var id = document.getElementById("cluster-select").value;
    var d = ensureClusterDials(id);
    DIAL_KEYS.forEach(function (dk) {
      var el = document.getElementById("dial-" + dk.key);
      if (el) d[dk.key] = el.value;
    });
    var n = document.getElementById("dial-notes");
    if (n) d.notes = n.value;
    document.querySelectorAll("[data-pf]").forEach(function (el) {
      var sym = el.getAttribute("data-pf");
      var fk = el.getAttribute("data-fk");
      proxyFundies[sym] = proxyFundies[sym] || {};
      proxyFundies[sym][fk] = el.value;
      proxyFundies[sym]._ev = proxyFundies[sym]._ev || {};
      proxyFundies[sym]._ev[fk] = "manual";
    });
    saveDials();
    saveProxyF();
    document.getElementById("dials-status").textContent = "Dials + proxy fundies saved.";
    document.getElementById("dials-status").className = "status ok";
    renderBoard();
  };

  document.getElementById("btn-ai-dials").onclick = async function () {
    var st = document.getElementById("dials-status");
    st.className = "status loading"; st.textContent = "Calling DeepSeek…";
    var id = document.getElementById("cluster-select").value;
    try {
      var data = await callDeepSeek([
        { role: "system", content: "Gujarat industry cluster dial assistant for credit underwriting. JSON: {demand,cost,wc,policy,notes,warnings[]} each dial rising|flat|falling|unknown. cost=power/fuel/wage pressure; wc=receivables/WC stress. Never invent false precision; prefer unknown + warning." },
        { role: "user", content: "Cluster: " + clusterById(id).name + ". Macros: " + JSON.stringify(macros).slice(0, 1500) + " Proxies 1m: " + JSON.stringify(proxyList(id).map(function (s) { return { s: s, q: proxyQuote(s) }; })).slice(0, 2000) },
      ]);
      var d = ensureClusterDials(id);
      ["demand", "cost", "wc", "policy"].forEach(function (k) {
        if (data[k]) d[k] = data[k];
      });
      if (data.notes) d.notes = String(data.notes) + "\n[AI draft]";
      saveDials();
      st.className = "status ok";
      st.textContent = "AI dial draft loaded - review before relying." + (data.warnings ? " " + data.warnings.join("; ") : "");
      renderBoard();
    } catch (e) {
      st.className = "status err"; st.textContent = String(e.message || e);
    }
  };

  document.getElementById("btn-ai-proxies").onclick = async function () {
    var st = document.getElementById("proxies-status");
    st.className = "status loading"; st.textContent = "Calling DeepSeek…";
    var id = document.getElementById("cluster-select").value;
    try {
      var data = await callDeepSeek([
        { role: "system", content: "Credit proxy commentary for Gujarat industry health-check. JSON: {commentary:string, fundies:{SYMBOL:{rev,ebitda,debt,days}}, warnings[]}. These are PROXIES not buy ideas. Never invent fundies - null if unknown." },
        { role: "user", content: "Cluster " + id + " symbols " + proxyList(id).join(", ") + " quotes " + JSON.stringify(proxyList(id).map(function (s) { return proxyQuote(s); })).slice(0, 3000) },
      ]);
      if (data.fundies) {
        Object.keys(data.fundies).forEach(function (sym) {
          proxyFundies[sym] = proxyFundies[sym] || {};
          var src = data.fundies[sym] || {};
          ["rev", "ebitda", "debt", "days"].forEach(function (fk) {
            if (src[fk] != null && src[fk] !== "") {
              proxyFundies[sym][fk] = src[fk];
              proxyFundies[sym]._ev = proxyFundies[sym]._ev || {};
              proxyFundies[sym]._ev[fk] = "ai";
            }
          });
        });
        saveProxyF();
      }
      st.className = "status ok";
      st.textContent = (data.commentary || "AI commentary applied.") + (data.warnings ? " Warnings: " + data.warnings.join("; ") : "");
      renderBoard();
    } catch (e) {
      st.className = "status err"; st.textContent = String(e.message || e);
    }
  };

  /* ---- Gates ---- */
  function verdictBox(kind, title, detail) {
    return '<div class="verdict ' + kind + '">' + title +
      '<div style="font-weight:500;font-size:.85rem;margin-top:6px">' + (detail || "") + "</div></div>";
  }

  function renderGateNav() {
    var labels = ["1 QUESTION", "2 REGIME", "3 CHANGE", "4 GAP", "5 CONFLICT"];
    document.getElementById("gate-nav").innerHTML = labels.map(function (lab, i) {
      var n = i + 1;
      var cls = "gate-pill";
      if (run.stoppedAt && n === run.stoppedAt) cls += " stopped";
      else if (n === run.current && !run.stoppedAt) cls += " current";
      else if (n < run.current || (run.stoppedAt && n < run.stoppedAt)) cls += " done";
      return '<span class="' + cls + '">G' + lab + "</span>";
    }).join("");
  }

  function stopHere(reason) {
    run.stoppedAt = run.current;
    run.stopReason = reason;
    saveRun();
    renderGates();
  }

  function proceed() {
    if (run.current >= 5) {
      run.stoppedAt = null;
      saveRun();
      renderGates();
      return;
    }
    run.current += 1;
    run.stoppedAt = null;
    run.stopReason = null;
    saveRun();
    renderGates();
  }

  function renderGates() {
    renderGateNav();
    var show = run.stoppedAt || run.current;
    var html = "";
    if (show === 1) {
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 1 - QUESTION</h3>' +
        '<p class="muted">One sentence: which cluster / credit decision? Cannot state -> STOP.</p>' +
        '<label class="field">Cluster<select id="g1-cluster" class="blue">' +
        CLUSTERS.map(function (c) {
          return '<option value="' + c.id + '"' + (run.clusterId === c.id ? " selected" : "") + ">" + escapeHtml(c.name) + "</option>";
        }).join("") + "</select></label>" +
        '<label class="field">Decision sentence<textarea id="g1-sentence" class="blue">' + escapeHtml(run.g1.sentence || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g1-stop">STOP</button>' +
        '<button type="button" class="go" id="g1-go">PROCEED</button></div><div id="g1-v"></div></div>';
    } else if (show === 2) {
      var sc = scoreCluster(run.clusterId);
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 2 - MACRO + CLUSTER REGIME</h3>' +
        '<p class="muted">Cluster health + Gujarat macro skim. Unclear cluster -> STOP.</p>' +
        '<p><span class="pill ' + sc.health.toLowerCase() + '">' + escapeHtml(sc.health) + "</span> " +
        escapeHtml(clusterById(run.clusterId).name) + " · " + escapeHtml(sc.detail) + "</p>" +
        '<div class="row">' + DIAL_KEYS.map(function (dk) {
          var d = ensureClusterDials(run.clusterId);
          return '<div class="dial"><div class="name">' + escapeHtml(dk.label) + '</div><div class="score">' +
            escapeHtml(d[dk.key] || "unknown") + "</div></div>";
        }).join("") + "</div>" +
        '<label class="field">Notes<textarea id="g2-notes" class="blue">' + escapeHtml(run.g2.notes || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g2-stop">STOP Unclear</button>' +
        '<button type="button" class="go" id="g2-go"' + (sc.health === "Unclear" ? " disabled" : "") + '>PROCEED</button></div><div id="g2-v"></div></div>';
    } else if (show === 3) {
      var items = ["Power tariff / fuel cost flip", "Export order book flip", "Receivables days spike", "Policy/BIS/duty change", "Port congestion / freight flip", "Peer insolvency / WC stress news"];
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 3 - CHANGE</h3>' +
        '<p class="muted">Leading watchlist. 0-1 flipped -> STOP.</p>' +
        items.map(function (lab, idx) {
          return '<label class="check"><input type="checkbox" data-flip="' + idx + '"' +
            (run.g3.flips[idx] ? " checked" : "") + "/> <span>" + escapeHtml(lab) + "</span></label>";
        }).join("") +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g3-stop">STOP</button>' +
        '<button type="button" class="go" id="g3-go">PROCEED</button></div><div id="g3-v"></div></div>';
    } else if (show === 4) {
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 4 - GAP</h3>' +
        '<p class="muted">Priced-in market/credit view vs field evidence. No gap -> STOP.</p>' +
        '<label class="field">Priced in<textarea id="g4-priced" class="blue">' + escapeHtml(run.g4.pricedIn || "") + "</textarea></label>" +
        '<label class="field">Field evidence<textarea id="g4-ev" class="blue">' + escapeHtml(run.g4.evidence || "") + "</textarea></label>" +
        '<label class="field">Named gap<textarea id="g4-gap" class="blue">' + escapeHtml(run.g4.gap || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g4-stop">STOP - no gap</button>' +
        '<button type="button" class="go" id="g4-go">PROCEED</button></div><div id="g4-v"></div></div>';
    } else {
      var sc5 = scoreCluster(run.clusterId);
      var div = divergence(run.clusterId);
      var conflict = sc5.health === "Unclear" || div.flag;
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 5 - CONFLICT / DIVERGENCE</h3>' +
        '<p class="muted">STOP if dials conflict (Unclear) or proxies diverge badly from cluster health.</p>' +
        '<p>Health: <span class="pill ' + sc5.health.toLowerCase() + '">' + escapeHtml(sc5.health) + "</span></p>" +
        '<p class="muted">Divergence: ' + escapeHtml(div.reason) + (div.flag ? " · FLAG" : "") + "</p>" +
        '<label class="field">Notes<textarea id="g5-notes" class="blue">' + escapeHtml(run.g5.notes || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g5-stop">STOP</button>' +
        '<button type="button" class="go" id="g5-go"' + (conflict ? " disabled" : "") + '>PROCEED / COMPLETE</button></div>' +
        (conflict ? verdictBox("stop", "Auto-STOP candidate", div.flag ? div.reason : "Cluster Unclear - resolve dials") : "") +
        '<div id="g5-v"></div></div>';
    }
    if (run.stoppedAt) {
      html += verdictBox("stop", "Stopped at Gate " + run.stoppedAt, escapeHtml(run.stopReason || ""));
      html += '<div class="row" style="margin-top:8px"><button type="button" class="ghost" id="btn-resume">Edit / clear stop</button></div>';
    }
    document.getElementById("gate-root").innerHTML = html;
    wireGate(show);
    var resume = document.getElementById("btn-resume");
    if (resume) {
      resume.onclick = function () {
        run.current = run.stoppedAt;
        run.stoppedAt = null;
        run.stopReason = null;
        saveRun();
        renderGates();
      };
    }
  }

  function wireGate(n) {
    if (n === 1) {
      document.getElementById("g1-cluster").onchange = function (e) {
        run.clusterId = e.target.value;
        saveRun();
      };
      document.getElementById("g1-sentence").oninput = function (e) { run.g1.sentence = e.target.value; saveRun(); };
      document.getElementById("g1-stop").onclick = function () { stopHere("Gate 1: cannot state decision"); };
      document.getElementById("g1-go").onclick = function () {
        run.clusterId = document.getElementById("g1-cluster").value;
        var s = (document.getElementById("g1-sentence").value || "").trim();
        run.g1.sentence = s;
        if (!s) { stopHere("Gate 1: empty sentence"); return; }
        proceed();
      };
    } else if (n === 2) {
      document.getElementById("g2-notes").oninput = function (e) { run.g2.notes = e.target.value; saveRun(); };
      document.getElementById("g2-stop").onclick = function () { stopHere("Gate 2: Unclear regime"); };
      document.getElementById("g2-go").onclick = function () {
        if (scoreCluster(run.clusterId).health === "Unclear") { stopHere("Gate 2: Unclear on proceed"); return; }
        proceed();
      };
    } else if (n === 3) {
      document.querySelectorAll("[data-flip]").forEach(function (el) {
        el.onchange = function () { run.g3.flips[el.dataset.flip] = el.checked; saveRun(); };
      });
      document.getElementById("g3-stop").onclick = function () { stopHere("Gate 3: stopped"); };
      document.getElementById("g3-go").onclick = function () {
        var c = Object.keys(run.g3.flips || {}).filter(function (k) { return run.g3.flips[k]; }).length;
        if (c <= 1) { stopHere("Gate 3: 0-1 flips"); return; }
        proceed();
      };
    } else if (n === 4) {
      document.getElementById("g4-priced").oninput = function (e) { run.g4.pricedIn = e.target.value; saveRun(); };
      document.getElementById("g4-ev").oninput = function (e) { run.g4.evidence = e.target.value; saveRun(); };
      document.getElementById("g4-gap").oninput = function (e) { run.g4.gap = e.target.value; saveRun(); };
      document.getElementById("g4-stop").onclick = function () { stopHere("Gate 4: no gap"); };
      document.getElementById("g4-go").onclick = function () {
        if (!(run.g4.gap || "").trim() || !(run.g4.pricedIn || "").trim() || !(run.g4.evidence || "").trim()) {
          stopHere("Gate 4: incomplete");
          return;
        }
        proceed();
      };
    } else if (n === 5) {
      document.getElementById("g5-notes").oninput = function (e) { run.g5.notes = e.target.value; saveRun(); };
      document.getElementById("g5-stop").onclick = function () { stopHere("Gate 5: conflict/divergence"); };
      document.getElementById("g5-go").onclick = function () {
        var sc = scoreCluster(run.clusterId);
        var div = divergence(run.clusterId);
        if (sc.health === "Unclear" || div.flag) {
          stopHere(div.flag ? div.reason : "Gate 5: Unclear dials");
          return;
        }
        run.stoppedAt = null;
        saveRun();
        document.getElementById("g5-v").innerHTML = verdictBox("go", "HEALTH CHECK COMPLETE",
          escapeHtml(clusterById(run.clusterId).name) + " · " + sc.health + " · write the credit note");
      };
    }
  }

  document.getElementById("btn-reset-gates").onclick = function () {
    var cid = run.clusterId;
    run = defaultRun();
    run.clusterId = cid;
    saveRun();
    renderGates();
  };

  async function boot() {
    document.getElementById("ai-key").value = localStorage.getItem(LS_AI_KEY) || "";
    document.getElementById("ai-model").value = localStorage.getItem(LS_AI_MODEL) || "deepseek-chat";
    try {
      var res = await fetch("./data/snapshot.json", { cache: "no-store" });
      if (res.ok) snapshot = await res.json();
    } catch (e) {
      snapshot = { market: {}, proxies: {}, proxy_map: {}, macros: {}, warnings: ["snapshot unreadable"] };
    }
    renderGates();
  }

  boot();
})();

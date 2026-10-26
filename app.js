(function () {
  "use strict";

  const LS_AI_KEY = "gj_health_deepseek_key";
  const LS_AI_MODEL = "gj_health_deepseek_model";
  const LS_MACROS = "gj_health_macros_v1";
  const LS_DIALS = "gj_health_dials_v1";
  const LS_FIELD = "gj_health_field_notes_v1";
  const LS_RUN = "gj_health_gates_v1";

  const CLUSTERS = [
    { id: "surat_textiles_weaving", name: "Surat textiles — weaving", region: "Surat" },
    { id: "surat_textiles_processing", name: "Surat textiles — processing", region: "Surat" },
    { id: "morbi_ceramics", name: "Morbi ceramics", region: "Morbi" },
    { id: "vapi_ankleshwar_chemicals", name: "Vapi–Ankleshwar chemicals", region: "South Gujarat" },
    { id: "diamonds_jewellery", name: "Diamonds / jewellery", region: "Surat" },
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

  // Fallback indicator map if snapshot lacks it
  const DEFAULT_INDICATOR_MAP = {
    surat_textiles_weaving: [
      { key: "cotton", label: "Cotton futures", dial: "cost" },
      { key: "brent", label: "Brent", dial: "cost" },
      { key: "inr_usd", label: "USDINR", dial: "cost" },
    ],
    surat_textiles_processing: [
      { key: "brent", label: "Brent", dial: "cost" },
      { key: "inr_usd", label: "USDINR", dial: "cost" },
    ],
    morbi_ceramics: [
      { key: "natgas", label: "Natural gas", dial: "cost" },
      { key: "brent", label: "Brent", dial: "cost" },
      { key: "inr_usd", label: "USDINR", dial: "cost" },
    ],
    vapi_ankleshwar_chemicals: [
      { key: "brent", label: "Brent / naphtha proxy", dial: "cost" },
      { key: "inr_usd", label: "USDINR", dial: "cost" },
    ],
    diamonds_jewellery: [
      { key: "inr_usd", label: "USDINR", dial: "demand" },
      { key: "gold", label: "Gold", dial: "demand" },
    ],
    auto_ancillary: [
      { key: "nifty_auto", label: "Nifty Auto", dial: "demand" },
      { key: "inr_usd", label: "USDINR", dial: "cost" },
    ],
    ports_logistics: [
      { key: "macro:port_mundra", label: "Mundra", dial: "demand" },
      { key: "macro:port_hazira", label: "Hazira", dial: "demand" },
      { key: "brent", label: "Brent", dial: "cost" },
    ],
    renewables: [
      { key: "inr_usd", label: "USDINR", dial: "cost", note: "Mostly manual" },
    ],
  };

  let snapshot = { market: {}, leading: {}, proxies: {}, proxy_map: {}, macros: {}, indicator_map: {}, warnings: [] };
  let macros = {};
  let dials = {};
  let fieldNotes = {};
  let run = defaultRun();
  let activeCluster = "surat_textiles_weaving";

  try { macros = JSON.parse(localStorage.getItem(LS_MACROS) || "{}") || {}; } catch (e) { macros = {}; }
  try { dials = JSON.parse(localStorage.getItem(LS_DIALS) || "{}") || {}; } catch (e) { dials = {}; }
  try { fieldNotes = JSON.parse(localStorage.getItem(LS_FIELD) || "{}") || {}; } catch (e) { fieldNotes = {}; }
  try {
    var saved = JSON.parse(localStorage.getItem(LS_RUN) || "null");
    if (saved && saved.g1) run = Object.assign(defaultRun(), saved);
  } catch (e) {}
  if (run.clusterId) activeCluster = run.clusterId;

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
  function saveField() { localStorage.setItem(LS_FIELD, JSON.stringify(fieldNotes)); }
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

  function indicatorMapFor(id) {
    return (snapshot.indicator_map && snapshot.indicator_map[id]) || DEFAULT_INDICATOR_MAP[id] || [];
  }

  function resolveIndicator(spec) {
    var key = spec.key || "";
    if (key.indexOf("macro:") === 0) {
      var mk = key.slice(6);
      var m = (snapshot.macros || {})[mk] || {};
      return {
        label: spec.label || mk,
        dial: spec.dial,
        note: spec.note || m.note,
        value: m.value,
        display: m.display || (m.value != null ? String(m.value) : null),
        direction: m.direction || "unknown",
        change_1m_pct: (m.raw && m.raw.yoy_pct != null) ? m.raw.yoy_pct : null,
        as_of: m.as_of,
        evidence: m.evidence || "unknown",
        source: m.source,
        null_reason: m.error,
      };
    }
    var q = (snapshot.leading && snapshot.leading[key]) || (snapshot.market && snapshot.market[key]) || {};
    return {
      label: spec.label || key,
      dial: spec.dial,
      note: spec.note,
      value: q.value,
      display: q.value != null ? (Math.round(q.value * 100) / 100) : null,
      direction: q.direction_1m || "unknown",
      change_1m_pct: q.change_1m_pct,
      as_of: q.as_of,
      evidence: q.evidence || (q.value != null ? "fact" : "unknown"),
      source: q.source,
      null_reason: q.error,
    };
  }

  function indicatorsFor(id) {
    return indicatorMapFor(id).map(resolveIndicator);
  }

  function dialHealthSignal(key, dir) {
    if (!dir || dir === "unknown" || dir === "flat") return 0;
    var inv = key === "cost" || key === "wc";
    if (dir === "rising") return inv ? -1 : 1;
    if (dir === "falling") return inv ? 1 : -1;
    return 0;
  }

  /** Indicator → health signal for its mapped dial (cost rising = bad, demand rising = good). */
  function indicatorHealth(ind) {
    if (!ind || ind.value == null || ind.direction === "unknown" || ind.direction === "flat") return 0;
    return dialHealthSignal(ind.dial || "cost", ind.direction);
  }

  /**
   * Health verdict weight: dials (primary) + leading indicators + soft macro skim.
   * Listed pulse is NOT in score — secondary check only via divergence().
   */
  function scoreCluster(id) {
    var d = ensureClusterDials(id);
    var dialSignals = DIAL_KEYS.map(function (dk) {
      return { key: dk.key, raw: d[dk.key] || "unknown", health: dialHealthSignal(dk.key, d[dk.key]), layer: "dial" };
    });
    var inds = indicatorsFor(id);
    var indSignals = inds.filter(function (i) { return i.value != null; }).map(function (i) {
      return { key: i.label, raw: i.direction, health: indicatorHealth(i), layer: "indicator", dial: i.dial };
    });

    var dialKnown = dialSignals.filter(function (s) { return s.health !== 0; });
    var indKnown = indSignals.filter(function (s) { return s.health !== 0; });

    // Weight: dials count 2x, indicators 1x
    var score = 0;
    var weight = 0;
    dialKnown.forEach(function (s) { score += s.health * 2; weight += 2; });
    indKnown.forEach(function (s) { score += s.health; weight += 1; });

    var health = "Unclear";
    var detail = "";
    if (weight < 2) {
      health = "Unclear";
      detail = "need dials and/or leading indicators";
    } else {
      var ratio = score / weight;
      if (ratio >= 0.45) health = "Strong";
      else if (ratio <= -0.45) health = "Weak";
      else health = "Mixed";
      detail = "dials " + dialKnown.length + " · indicators " + indKnown.length +
        " · score " + (Math.round(ratio * 100) / 100);
    }

    var fn = (fieldNotes[id] || "").trim();
    if (fn) detail += " · field notes ✓";

    // Soft macro skim for ports/GST (display only)
    var macroBits = [];
    var sm = snapshot.macros || {};
    if (id === "ports_logistics") {
      if (sm.port_mundra && sm.port_mundra.value != null) macroBits.push("Mundra fact");
      if (sm.port_hazira && sm.port_hazira.value != null) macroBits.push("Hazira fact");
    }
    if (sm.state_gst && sm.state_gst.value != null) macroBits.push("GST fact");

    return {
      health: health,
      detail: detail,
      dialSignals: dialSignals,
      indSignals: indSignals,
      fieldNotes: fn,
      macroBits: macroBits,
      inds: inds,
    };
  }

  function proxyList(clusterId) {
    return (snapshot.proxy_map || {})[clusterId] || [];
  }

  function proxyQuote(sym) {
    return (snapshot.proxies && snapshot.proxies[sym]) || {};
  }

  /**
   * Divergence: indicators vs dials conflict → STOP candidate.
   * Listed pulse only soft secondary note (not primary STOP).
   */
  function divergence(clusterId) {
    var sc = scoreCluster(clusterId);
    var d = ensureClusterDials(clusterId);
    var conflicts = [];

    // Per-dial: if dial set and majority of indicators on that dial disagree
    ["demand", "cost", "wc", "policy"].forEach(function (dial) {
      var dialDir = d[dial] || "unknown";
      if (dialDir === "unknown" || dialDir === "flat") return;
      var dialH = dialHealthSignal(dial, dialDir);
      if (dialH === 0) return;
      var related = (sc.indSignals || []).filter(function (s) {
        return s.dial === dial && s.health !== 0;
      });
      if (related.length < 1) return;
      var disagree = related.filter(function (s) { return s.health !== dialH; });
      if (disagree.length / related.length >= 0.5) {
        conflicts.push(dial + " dial vs leading indicators");
      }
    });

    // Soft pulse note (secondary)
    var syms = proxyList(clusterId);
    var dirs = syms.map(function (s) { return proxyQuote(s).direction_1m || "unknown"; });
    var known = dirs.filter(function (x) { return x === "rising" || x === "falling"; });
    var pulseNote = null;
    if (known.length >= 2 && (sc.health === "Strong" || sc.health === "Weak")) {
      var rising = known.filter(function (x) { return x === "rising"; }).length;
      var falling = known.filter(function (x) { return x === "falling"; }).length;
      if (sc.health === "Strong" && falling / known.length >= 0.5) {
        pulseNote = "Soft: listed pulse falling while cluster Strong (secondary — not credit)";
      }
      if (sc.health === "Weak" && rising / known.length >= 0.5) {
        pulseNote = "Soft: listed pulse rising while cluster Weak (secondary — not credit)";
      }
    }

    var flag = conflicts.length > 0;
    return {
      flag: flag,
      reason: flag ? ("Indicator↔dial conflict: " + conflicts.join("; ")) : "no indicator↔dial conflict",
      conflicts: conflicts,
      pulseNote: pulseNote,
      health: sc.health,
    };
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
    ["clusters", "ops", "macros", "settings"].forEach(function (id) {
      var el = document.getElementById("view-" + id);
      if (el) el.classList.toggle("hidden", id !== name);
    });
    if (name === "clusters") renderClusters();
    if (name === "macros") renderMacros();
    if (name === "ops") renderGates();
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

  function chipClass(dir) {
    if (dir === "rising") return "up";
    if (dir === "falling") return "down";
    return "";
  }

  function renderScoreGrid() {
    var root = document.getElementById("score-grid");
    root.innerHTML = CLUSTERS.map(function (c) {
      var sc = scoreCluster(c.id);
      var chips = (sc.inds || []).slice(0, 4).map(function (ind) {
        if (ind.value == null) {
          return '<span class="ind-chip">null ' + escapeHtml(ind.label) + "</span>";
        }
        var pct = ind.change_1m_pct != null ? (ind.change_1m_pct > 0 ? "+" : "") + ind.change_1m_pct + "%" : ind.direction;
        return '<span class="ind-chip ' + chipClass(ind.direction) + '">' +
          escapeHtml(ind.label) + " " + escapeHtml(String(pct)) + " →" + escapeHtml(ind.dial) + "</span>";
      }).join("");
      var fn = (fieldNotes[c.id] || "").trim();
      return '<div class="score-card' + (c.id === activeCluster ? " active" : "") + '" data-cluster="' + c.id + '">' +
        "<h3>" + escapeHtml(c.name) + "</h3>" +
        '<span class="pill ' + sc.health.toLowerCase() + '">' + escapeHtml(sc.health) + "</span> " +
        '<span class="muted">' + escapeHtml(c.region) + "</span>" +
        '<div class="inds">' + (chips || '<span class="muted">no indicators yet</span>') + "</div>" +
        '<div class="fn">' + (fn ? "📝 " + escapeHtml(fn.slice(0, 80)) : '<span class="muted">No field notes yet</span>') + "</div>" +
        "</div>";
    }).join("");
    root.querySelectorAll(".score-card").forEach(function (card) {
      card.onclick = function () {
        activeCluster = card.getAttribute("data-cluster");
        run.clusterId = activeCluster;
        saveRun();
        renderClusters();
      };
    });
  }

  function renderClusterDetail() {
    var id = activeCluster;
    var c = clusterById(id);
    var d = ensureClusterDials(id);
    var sc = scoreCluster(id);
    document.getElementById("detail-title").textContent = c.name;
    document.getElementById("detail-health").innerHTML =
      '<span class="pill ' + sc.health.toLowerCase() + '">' + escapeHtml(sc.health) + "</span> " +
      '<span class="muted">' + escapeHtml(sc.detail) +
      (sc.macroBits.length ? " · macros: " + sc.macroBits.join(", ") : "") + "</span>";

    var inds = sc.inds || [];
    document.getElementById("leading-box").innerHTML = inds.length ? (
      "<table><tr><th>Indicator</th><th>Value</th><th>1m / dir</th><th>Feeds dial</th><th>Note</th></tr>" +
      inds.map(function (ind) {
        return "<tr><td>" + escapeHtml(ind.label) +
          (ind.evidence === "fact" ? ' <span class="ai-tag">fact</span>' : "") +
          "</td><td>" +
          (ind.display != null ? escapeHtml(String(ind.display)) : '<span class="muted">null</span>') +
          (ind.as_of ? '<div class="muted">' + escapeHtml(ind.as_of) + "</div>" : "") +
          "</td><td>" + escapeHtml(ind.direction || "unknown") +
          (ind.change_1m_pct != null ? " (" + ind.change_1m_pct + "%)" : "") +
          "</td><td>" + escapeHtml(ind.dial || "—") +
          "</td><td class=\"muted\">" + escapeHtml(ind.note || ind.null_reason || "") +
          "</td></tr>";
      }).join("") + "</table>" +
      (id.indexOf("textile") >= 0
        ? '<p class="muted" style="margin-top:6px">PSF / POY / polyester yarn: no Yahoo series — paste in field notes if you have polymer-report prices.</p>'
        : "")
    ) : '<p class="muted">No indicator map for this cluster.</p>';

    document.getElementById("dials-form").innerHTML = DIAL_KEYS.map(function (dk) {
      // Soft hint from indicators
      var hintInds = inds.filter(function (i) { return i.dial === dk.key && i.value != null; });
      var hint = hintInds.map(function (i) {
        return i.label + " " + i.direction;
      }).join("; ");
      return '<label class="field">' + escapeHtml(dk.label) +
        '<span class="formula">' + escapeHtml(dk.formula) +
        (dk.invert ? " · inverted in health" : "") +
        (hint ? " · indicators: " + escapeHtml(hint) : "") + "</span>" +
        dirSelect("dial-" + dk.key, d[dk.key] || "unknown") + "</label>";
    }).join("");

    document.getElementById("field-notes").value = fieldNotes[id] || "";

    // Listed pulse — collapsed, price/1m only
    var syms = proxyList(id);
    var rows = syms.map(function (sym) {
      var q = proxyQuote(sym);
      return "<tr><td>" + escapeHtml(sym) + "</td><td>" +
        (q.value != null ? escapeHtml(String(Math.round(q.value * 100) / 100)) : "null") +
        "</td><td>" + escapeHtml(q.direction_1m || "unknown") +
        (q.change_1m_pct != null ? " (" + q.change_1m_pct + "%)" : "") +
        "</td><td class=\"muted\">" + escapeHtml(q.as_of || "") + "</td></tr>";
    }).join("");
    document.getElementById("proxies-table").innerHTML = syms.length
      ? "<table><tr><th>Symbol</th><th>Price</th><th>1m dir</th><th>as_of</th></tr>" + rows + "</table>"
      : '<p class="muted">No listed pulse tickers mapped.</p>';

    var div = divergence(id);
    var html = "";
    if (div.flag) {
      html = '<div class="verdict stop">DIVERGENCE · ' + escapeHtml(div.reason) + "</div>";
    } else {
      html = '<div class="muted">Divergence: ' + escapeHtml(div.reason) + "</div>";
    }
    if (div.pulseNote) {
      html += '<div class="muted" style="margin-top:4px">' + escapeHtml(div.pulseNote) + "</div>";
    }
    document.getElementById("divergence-box").innerHTML = html;
  }

  function renderClusters() {
    renderScoreGrid();
    renderClusterDetail();
  }

  document.getElementById("btn-save-cluster").onclick = function () {
    var id = activeCluster;
    var d = ensureClusterDials(id);
    DIAL_KEYS.forEach(function (dk) {
      var el = document.getElementById("dial-" + dk.key);
      if (el) d[dk.key] = el.value;
    });
    fieldNotes[id] = document.getElementById("field-notes").value || "";
    saveDials();
    saveField();
    var st = document.getElementById("cluster-status");
    st.textContent = "Saved dials + field notes locally.";
    st.className = "status ok";
    renderClusters();
  };

  document.getElementById("btn-ai-dials").onclick = async function () {
    var st = document.getElementById("cluster-status");
    st.className = "status loading"; st.textContent = "Calling DeepSeek…";
    var id = activeCluster;
    try {
      var sc = scoreCluster(id);
      var data = await callDeepSeek([
        {
          role: "system",
          content: "Gujarat SME credit cluster dial assistant. JSON: {demand,cost,wc,policy,notes,warnings[]}. " +
            "Each dial: rising|flat|falling|unknown. Use leading indicators + macros + field notes. " +
            "cost=power/fuel pressure; wc=receivables stress. Prefer unknown over inventing. " +
            "Do NOT invent company fundamentals or listed-company fundies.",
        },
        {
          role: "user",
          content: "Cluster: " + clusterById(id).name +
            ". Indicators: " + JSON.stringify(sc.inds).slice(0, 2500) +
            ". Macros skim: " + JSON.stringify({
              gst: (snapshot.macros || {}).state_gst,
              mundra: (snapshot.macros || {}).port_mundra,
              hazira: (snapshot.macros || {}).port_hazira,
            }).slice(0, 1200) +
            ". Field notes: " + JSON.stringify(fieldNotes[id] || "").slice(0, 800),
        },
      ]);
      var d = ensureClusterDials(id);
      ["demand", "cost", "wc", "policy"].forEach(function (k) {
        if (data[k]) d[k] = data[k];
      });
      if (data.notes) {
        var cur = fieldNotes[id] || "";
        fieldNotes[id] = (cur ? cur + "\n" : "") + "[AI dial note] " + String(data.notes);
        saveField();
      }
      saveDials();
      st.className = "status ok";
      st.textContent = "AI dial draft from indicators — review." + (data.warnings ? " " + data.warnings.join("; ") : "");
      renderClusters();
    } catch (e) {
      st.className = "status err"; st.textContent = String(e.message || e);
    }
  };

  function renderMacros() {
    var root = document.getElementById("macros-form");
    var snapM = snapshot.macros || {};
    root.innerHTML = MACRO_KEYS.map(function (row) {
      var k = row[0], label = row[1], hint = row[2];
      var snap = snapM[k] || {};
      var seed = macros[k];
      if (seed == null || seed === "") {
        if (snap.display != null) seed = snap.display;
        else if (snap.value != null) seed = snap.value;
      }
      var dir = macros[k + "_dir"] || snap.direction || "unknown";
      var ev = (macros._ev && macros._ev[k]) || snap.evidence || "unknown";
      var metaBits = [];
      if (snap.source) metaBits.push("source: " + snap.source);
      if (snap.as_of) metaBits.push("as_of: " + snap.as_of);
      if (snap.source_url) {
        metaBits.push('<a href="' + escapeHtml(snap.source_url) + '" target="_blank" rel="noopener" style="color:#93c5fd">link</a>');
      }
      if (snap.note) metaBits.push(snap.note);
      if (snap.error && snap.value == null) metaBits.push("null: " + snap.error);
      metaBits.push("evidence: " + ev);
      return '<label class="field">' + escapeHtml(label) +
        '<span class="formula">input · ' + escapeHtml(hint) + " · manual override kept</span>" +
        '<input class="blue" data-macro="' + k + '" value="' + escapeHtml(seed == null ? "" : seed) + '"/>' +
        '<span class="formula">direction</span>' + dirSelect("macro-dir-" + k, dir) +
        '<span class="formula" style="display:block;margin-top:4px">' + metaBits.join(" · ") + "</span>" +
        "</label>";
    }).join("");
    var warns = (snapshot.warnings || []).slice();
    document.getElementById("macro-warnings").innerHTML =
      warns.map(function (w) { return "⚠ " + escapeHtml(w); }).join("<br/>") || "No fetch warnings.";
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
      var snapMacros = snapshot.macros || {};
      var data = await callDeepSeek([
        {
          role: "system",
          content: "Gujarat macro assistant. JSON keys gsdp_yoy,iip_gujarat,state_gst,power_dgvcl,power_mgvcl,port_mundra,port_hazira,port_kandla,rbi_gujarat_credit,rainfall_agri + optional *_dir + warnings[]. " +
            "CRITICAL: never invent. If snapshot evidence=fact, COPY it. Only fill null keys with real public figures else null.",
        },
        {
          role: "user",
          content: "Snapshot macros: " + JSON.stringify(snapMacros).slice(0, 4500),
        },
      ]);
      macros._ev = macros._ev || {};
      MACRO_KEYS.forEach(function (row) {
        var k = row[0];
        var snap = snapMacros[k] || {};
        if (snap.evidence === "fact" && (snap.display != null || snap.value != null)) {
          macros[k] = snap.display != null ? snap.display : snap.value;
          macros._ev[k] = "fact";
          if (snap.direction) macros[k + "_dir"] = snap.direction;
        } else if (data[k] != null && data[k] !== "") {
          macros[k] = data[k];
          macros._ev[k] = "ai";
        }
        if (data[k + "_dir"] && macros._ev[k] !== "fact") {
          macros[k + "_dir"] = data[k + "_dir"];
          macros._ev[k + "_dir"] = "ai";
        }
      });
      saveMacros();
      st.className = "status ok";
      st.textContent = "Applied (fact preserved; AI only on nulls)." + (data.warnings ? " " + data.warnings.join("; ") : "");
      renderMacros();
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
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 1 — QUESTION</h3>' +
        '<p class="muted">One sentence: which cluster / credit decision? Cannot state → STOP.</p>' +
        '<label class="field">Cluster<select id="g1-cluster" class="blue">' +
        CLUSTERS.map(function (c) {
          return '<option value="' + c.id + '"' + (run.clusterId === c.id ? " selected" : "") + ">" + escapeHtml(c.name) + "</option>";
        }).join("") + "</select></label>" +
        '<label class="field">Decision sentence<textarea id="g1-sentence" class="blue">' + escapeHtml(run.g1.sentence || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g1-stop">STOP</button>' +
        '<button type="button" class="go" id="g1-go">PROCEED</button></div><div id="g1-v"></div></div>';
    } else if (show === 2) {
      var sc = scoreCluster(run.clusterId);
      var fn = (fieldNotes[run.clusterId] || "").trim();
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 2 — REGIME (macros + dials + indicators + field notes)</h3>' +
        '<p class="muted">Listed pulse ignored here. Unclear → STOP.</p>' +
        '<p><span class="pill ' + sc.health.toLowerCase() + '">' + escapeHtml(sc.health) + "</span> " +
        escapeHtml(clusterById(run.clusterId).name) + " · " + escapeHtml(sc.detail) + "</p>" +
        '<div class="row">' + DIAL_KEYS.map(function (dk) {
          var dd = ensureClusterDials(run.clusterId);
          return '<div class="dial"><div class="name">' + escapeHtml(dk.label) + '</div><div class="score">' +
            escapeHtml(dd[dk.key] || "unknown") + "</div></div>";
        }).join("") + "</div>" +
        '<p class="muted" style="margin-top:8px">Field notes: ' + (fn ? escapeHtml(fn.slice(0, 200)) : "<em>empty — add on Clusters tab</em>") + "</p>" +
        '<div class="inds" style="margin-top:6px">' +
        (sc.inds || []).filter(function (i) { return i.value != null; }).map(function (i) {
          return '<span class="ind-chip ' + chipClass(i.direction) + '">' + escapeHtml(i.label) + " " + escapeHtml(i.direction) + "</span>";
        }).join("") + "</div>" +
        '<label class="field">Gate notes<textarea id="g2-notes" class="blue">' + escapeHtml(run.g2.notes || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g2-stop">STOP Unclear</button>' +
        '<button type="button" class="go" id="g2-go"' + (sc.health === "Unclear" ? " disabled" : "") + ">PROCEED</button></div><div id=\"g2-v\"></div></div>";
    } else if (show === 3) {
      var items = ["Power tariff / fuel cost flip", "Export order book flip", "Receivables days spike", "Policy/BIS/duty change", "Port congestion / freight flip", "Peer insolvency / WC stress news"];
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 3 — CHANGE</h3>' +
        '<p class="muted">Leading watchlist. 0–1 flipped → STOP.</p>' +
        items.map(function (lab, idx) {
          return '<label class="check"><input type="checkbox" data-flip="' + idx + '"' +
            (run.g3.flips[idx] ? " checked" : "") + "/> <span>" + escapeHtml(lab) + "</span></label>";
        }).join("") +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g3-stop">STOP</button>' +
        '<button type="button" class="go" id="g3-go">PROCEED</button></div><div id="g3-v"></div></div>';
    } else if (show === 4) {
      var fn4 = (fieldNotes[run.clusterId] || "").trim();
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 4 — GAP</h3>' +
        '<p class="muted">Priced-in view vs field evidence. Prefer your field notes. No gap → STOP.</p>' +
        (fn4 ? '<p class="muted">From Clusters field notes: ' + escapeHtml(fn4.slice(0, 240)) + "</p>" : "") +
        '<label class="field">Priced in<textarea id="g4-priced" class="blue">' + escapeHtml(run.g4.pricedIn || "") + "</textarea></label>" +
        '<label class="field">Field evidence<textarea id="g4-ev" class="blue">' + escapeHtml(run.g4.evidence || fn4) + "</textarea></label>" +
        '<label class="field">Named gap<textarea id="g4-gap" class="blue">' + escapeHtml(run.g4.gap || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g4-stop">STOP — no gap</button>' +
        '<button type="button" class="go" id="g4-go">PROCEED</button></div><div id="g4-v"></div></div>';
    } else {
      var sc5 = scoreCluster(run.clusterId);
      var div = divergence(run.clusterId);
      var conflict = sc5.health === "Unclear" || div.flag;
      html = '<div class="panel" style="border:none;padding:0"><h3>Gate 5 — CONFLICT / DIVERGENCE</h3>' +
        '<p class="muted">STOP if Unclear or leading indicators conflict with dials. Listed pulse is soft-only.</p>' +
        '<p>Health: <span class="pill ' + sc5.health.toLowerCase() + '">' + escapeHtml(sc5.health) + "</span></p>" +
        '<p class="muted">Divergence: ' + escapeHtml(div.reason) + (div.flag ? " · FLAG" : "") + "</p>" +
        (div.pulseNote ? '<p class="muted">' + escapeHtml(div.pulseNote) + "</p>" : "") +
        '<label class="field">Notes<textarea id="g5-notes" class="blue">' + escapeHtml(run.g5.notes || "") + "</textarea></label>" +
        '<div class="row" style="margin-top:10px"><button type="button" class="stop" id="g5-stop">STOP</button>' +
        '<button type="button" class="go" id="g5-go"' + (conflict ? " disabled" : "") + ">PROCEED / COMPLETE</button></div>" +
        (conflict ? verdictBox("stop", "Auto-STOP candidate", div.flag ? div.reason : "Cluster Unclear — set dials / check indicators") : "") +
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
        activeCluster = run.clusterId;
        saveRun();
      };
      document.getElementById("g1-sentence").oninput = function (e) { run.g1.sentence = e.target.value; saveRun(); };
      document.getElementById("g1-stop").onclick = function () { stopHere("Gate 1: cannot state decision"); };
      document.getElementById("g1-go").onclick = function () {
        run.clusterId = document.getElementById("g1-cluster").value;
        activeCluster = run.clusterId;
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
          stopHere(div.flag ? div.reason : "Gate 5: Unclear");
          return;
        }
        run.stoppedAt = null;
        saveRun();
        document.getElementById("g5-v").innerHTML = verdictBox("go", "HEALTH CHECK COMPLETE",
          escapeHtml(clusterById(run.clusterId).name) + " · " + sc.health + " · write the credit note from field notes + dials");
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
      snapshot = { market: {}, leading: {}, proxies: {}, proxy_map: {}, macros: {}, warnings: ["snapshot unreadable"] };
    }
    renderClusters();
  }

  boot();
})();

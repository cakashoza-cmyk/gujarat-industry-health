#!/usr/bin/env python3
"""Fetch Yahoo proxies + scrapeable Gujarat macros. Never invent; 403→fallback→null+warning."""
from __future__ import annotations

import json
import re
import ssl
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent / "data" / "snapshot.json"
IST = timezone(timedelta(hours=5, minutes=30), name="Asia/Calcutta")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

PROXIES = {
    "surat_textiles_weaving": [
        "TRIDENT.NS", "ARVIND.NS", "KPRMILL.NS", "FILATEX.NS",
    ],
    "surat_textiles_processing": [
        "WELSPUNLIV.NS", "HIMATSEIDE.NS", "GOKEX.NS", "RAYMOND.NS",
    ],
    "morbi_ceramics": [
        "CERA.NS", "KAJARIACER.NS", "SOMANYCERA.NS", "ORIENTBELL.NS",
    ],
    "vapi_ankleshwar_chemicals": [
        "DEEPAKNTR.NS", "AARTIIND.NS", "GUJALKALI.NS", "ATUL.NS",
    ],
    "diamonds_jewellery": [
        "TITAN.NS", "KALYANKJIL.NS", "SENCO.NS",
    ],
    "auto_ancillary": [
        "MOTHERSON.NS", "BHARATFORG.NS", "ENDURANCE.NS",
    ],
    "ports_logistics": [
        "ADANIPORTS.NS", "GPPL.NS", "JSWINFRA.NS", "GESHIP.NS",
    ],
    "renewables": [
        "SUZLON.NS", "INOXWIND.NS", "WAAREEENER.NS", "KPIGREEN.NS",
    ],
}

MARKET = {
    "nifty": "^NSEI",
    "inr_usd": "INR=X",
    "brent": "BZ=F",
    "india_vix": "^INDIAVIX",
    "gold": "GC=F",
    "natgas": "NG=F",
    "cotton": "CT=F",
    "nifty_auto": "^CNXAUTO",
}

# Cluster → leading indicator keys (from market/macros) → dial they inform.
# PSF/polyester yarn: no clean Yahoo series — UI shows null + manual hint.
INDICATOR_MAP = {
    "surat_textiles_weaving": [
        {"key": "cotton", "label": "Cotton futures (CT=F)", "dial": "cost",
         "note": "US cotton proxy — Indian yarn/PSF paste manually if known"},
        {"key": "brent", "label": "Brent (fuel/poly cost proxy)", "dial": "cost", "note": None},
        {"key": "inr_usd", "label": "USDINR", "dial": "cost", "note": "INR weak can lift export enquiry"},
    ],
    "surat_textiles_processing": [
        {"key": "brent", "label": "Brent (process fuel/chem cost)", "dial": "cost", "note": None},
        {"key": "inr_usd", "label": "USDINR", "dial": "cost", "note": None},
        {"key": "cotton", "label": "Cotton futures", "dial": "cost", "note": "Indirect; PSF/POY manual"},
    ],
    "morbi_ceramics": [
        {"key": "natgas", "label": "Natural gas (NG=F)", "dial": "cost", "note": "Kiln fuel proxy"},
        {"key": "brent", "label": "Brent", "dial": "cost", "note": "Fuel cost co-move"},
        {"key": "inr_usd", "label": "USDINR", "dial": "cost", "note": "Import/export mix"},
    ],
    "vapi_ankleshwar_chemicals": [
        {"key": "brent", "label": "Brent / naphtha proxy", "dial": "cost", "note": "Feedstock stand-in"},
        {"key": "inr_usd", "label": "USDINR", "dial": "cost", "note": None},
    ],
    "diamonds_jewellery": [
        {"key": "inr_usd", "label": "USDINR", "dial": "demand", "note": "INR weak often helps polished exports"},
        {"key": "gold", "label": "Gold futures (GC=F)", "dial": "demand", "note": "Jewellery demand / inventory cost"},
    ],
    "auto_ancillary": [
        {"key": "nifty_auto", "label": "Nifty Auto", "dial": "demand", "note": None},
        {"key": "inr_usd", "label": "USDINR", "dial": "cost", "note": None},
    ],
    "ports_logistics": [
        {"key": "macro:port_mundra", "label": "Mundra throughput", "dial": "demand", "note": "From macros"},
        {"key": "macro:port_hazira", "label": "Hazira throughput", "dial": "demand", "note": "From macros"},
        {"key": "brent", "label": "Brent (freight/bunker co-move)", "dial": "cost", "note": None},
    ],
    "renewables": [
        {"key": "inr_usd", "label": "USDINR (module import)", "dial": "cost",
         "note": "Mostly manual — policy/tariff field notes"},
    ],
}

GST_STATS = "https://www.gst.gov.in/download/gststatistics"
GST_XLSX = (
    "https://tutorial.gst.gov.in/offlineutilities/gst_statistics/"
    "statewise_GST_collection_{fy}.xlsx"
)
GST_NEWS = "https://tutorial.gst.gov.in/downloads/news/"
ADANI_OPS = (
    "https://www.adaniports.com/-/media/project/ports/investor/"
    "investor-downloads/operational-highlights/q1-fy27.pdf"
)
ADANI_IR_INDEX = "https://www.adaniports.com/Investors/Investor-Downloads"
IMD_STATE = "https://mausam.imd.gov.in/responsive/rainfallinformation_state.php"
RBI_HANDBOOK = (
    "https://rbi.org.in/Scripts/AnnualPublications.aspx?"
    "head=Handbook%20of%20Statistics%20on%20Indian%20States"
)
RBI_CREDIT_XLSX = (
    "https://rbidocs.rbi.org.in/rdocs/Publications/DOCs/"
    "156T_1112202520771561966C49F1B9C00F56ACF97557.XLSX"
)


def now_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S Asia/Calcutta")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def http_get(
    url: str,
    timeout: int = 40,
    headers: dict | None = None,
) -> tuple[bytes | None, str | None, int | None]:
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read(), None, resp.status
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}", e.code
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}", None


def yahoo_chart(symbol: str, range_: str = "1mo") -> dict:
    enc = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?range={range_}&interval=1d"
    raw, err, _ = http_get(url)
    out = {
        "symbol": symbol,
        "value": None,
        "prior": None,
        "as_of": None,
        "direction_1d": "unknown",
        "direction_1m": "unknown",
        "change_1m_pct": None,
        "source": "Yahoo Finance chart API",
        "source_url": url,
        "error": err,
        "evidence": "fact",
    }
    if not raw:
        return out
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            out["error"] = "empty chart result"
            return out
        r0 = result[0]
        meta = r0.get("meta") or {}
        ts = r0.get("timestamp") or []
        quote = ((r0.get("indicators") or {}).get("quote") or [{}])[0]
        closes = [c for c in (quote.get("close") or []) if c is not None]
        if not closes:
            price = meta.get("regularMarketPrice")
            if price is None:
                out["error"] = "no closes"
                return out
            out["value"] = float(price)
            out["as_of"] = datetime.fromtimestamp(
                meta.get("regularMarketTime") or 0, tz=IST
            ).strftime("%Y-%m-%d")
            out["error"] = None
            return out
        out["value"] = float(closes[-1])
        out["prior"] = float(closes[-2]) if len(closes) >= 2 else None
        if ts:
            out["as_of"] = datetime.fromtimestamp(ts[-1], tz=IST).strftime("%Y-%m-%d")
        if out["prior"] is not None and out["prior"] != 0:
            chg = (out["value"] - out["prior"]) / abs(out["prior"])
            if chg > 0.0015:
                out["direction_1d"] = "rising"
            elif chg < -0.0015:
                out["direction_1d"] = "falling"
            else:
                out["direction_1d"] = "flat"
        if len(closes) >= 2 and closes[0] != 0:
            m = (closes[-1] - closes[0]) / abs(closes[0])
            out["change_1m_pct"] = round(m * 100.0, 3)
            if m > 0.02:
                out["direction_1m"] = "rising"
            elif m < -0.02:
                out["direction_1m"] = "falling"
            else:
                out["direction_1m"] = "flat"
        out["error"] = None
    except Exception as e:  # noqa: BLE001
        out["error"] = f"parse: {e}"
    return out


def macro_shell(
    name: str,
    *,
    unit: str = "%",
    source: str | None = None,
    source_url: str | None = None,
    error: str | None = None,
    evidence: str = "unknown",
    note: str | None = None,
) -> dict:
    return {
        "name": name,
        "value": None,
        "display": None,
        "unit": unit,
        "as_of": None,
        "direction": "unknown",
        "source": source,
        "source_url": source_url,
        "error": error,
        "evidence": evidence,
        "note": note,
        "raw": None,
    }


def _dir_from_pct(pct: float | None, thr: float = 1.0) -> str:
    if pct is None:
        return "unknown"
    if pct > thr:
        return "rising"
    if pct < -thr:
        return "falling"
    return "flat"


def fetch_gst(warnings: list[str]) -> dict:
    """GSTN public state-wise collection — prefer latest monthly PDF YoY, else xlsx."""
    out = macro_shell(
        "Gujarat GST collections",
        unit="% YoY",
        source="GSTN / gst.gov.in statistics",
        source_url=GST_STATS,
        evidence="unknown",
    )

    # --- 1) Latest monthly revenue PDF (Table 3 state-wise growth) ---
    news_html, nerr, _ = http_get(GST_NEWS, timeout=30)
    pdf_url = None
    if news_html:
        html = news_html.decode("utf-8", errors="replace")
        # newest monthly publishing PDF
        pdfs = re.findall(
            r'href=["\']([^"\']*final_gst_revenue_report_for_publishing_monthly_[^"\']+\.pdf)["\']',
            html,
            re.I,
        )
        if not pdfs:
            pdfs = re.findall(
                r'href=["\']([^"\']*monthly[^"\']*gst[^"\']*\.pdf)["\']',
                html,
                re.I,
            )
        if pdfs:
            href = pdfs[0]
            pdf_url = href if href.startswith("http") else (
                "https://tutorial.gst.gov.in" + href if href.startswith("/") else GST_NEWS + href
            )
    # Known recent fallback
    if not pdf_url:
        pdf_url = (
            GST_NEWS
            + "final_gst_revenue_report_for_publishing_monthly_sep_2026.pdf"
        )

    raw, err, code = http_get(pdf_url, timeout=60)
    if raw and raw[:4] == b"%PDF":
        pdf_path = Path(tempfile.gettempdir()) / "gst_monthly.pdf"
        pdf_path.write_bytes(raw)
        try:
            import subprocess

            text_pdf = subprocess.check_output(
                ["pdftotext", "-layout", str(pdf_path), "-"],
                stderr=subprocess.DEVNULL,
                timeout=60,
            ).decode("utf-8", errors="replace")
            # Prefer Table 3 "State-wise growth of GST Revenues during <Month>"
            # (gross collections), not Table 2 SGST settlement rows.
            month_label = None
            ml = re.search(
                r"State-wise growth of GST Revenues during\s+([A-Za-z]+,?\s*\d{4})",
                text_pdf,
                re.I,
            )
            section = text_pdf
            if ml:
                month_label = ml.group(1).replace(",", "").strip()
                section = text_pdf[ml.start(): ml.start() + 8000]
            if not month_label:
                ml2 = re.search(
                    r"publishing_monthly_([a-z]+)_(\d{4})",
                    pdf_url,
                    re.I,
                )
                if ml2:
                    month_label = f"{ml2.group(1).title()} {ml2.group(2)}"
            # Among Gujarat rows, pick the one with largest current-month figure
            # (gross GST >> SGST-only settlement lines).
            candidates = re.findall(
                r"Gujarat\s+([0-9,]+)\s+([0-9,]+)\s+([+\-]?[0-9]+)\s*%",
                section,
            )
            m = None
            if candidates:
                ranked = sorted(
                    candidates,
                    key=lambda t: float(t[1].replace(",", "")),
                    reverse=True,
                )
                m = ranked[0]
            if m:
                prior = float(m[0].replace(",", ""))
                cur = float(m[1].replace(",", ""))
                yoy = float(m[2])
                # as_of from month label
                as_of = None
                if month_label:
                    try:
                        as_of = datetime.strptime(month_label, "%B %Y").strftime("%Y-%m")
                    except ValueError:
                        as_of = month_label
                out.update(
                    {
                        "value": yoy,
                        "display": (
                            f"₹{cur:,.0f} Cr ({month_label or 'latest'}) · YoY {yoy:+.0f}% "
                            f"(vs ₹{prior:,.0f} Cr)"
                        ),
                        "unit": "% YoY",
                        "as_of": as_of,
                        "direction": _dir_from_pct(yoy),
                        "source": "GSTN monthly GST revenue report (state-wise growth table)",
                        "source_url": pdf_url,
                        "error": None,
                        "evidence": "fact",
                        "raw": {
                            "month_total_cr": cur,
                            "prior_year_same_month_cr": prior,
                            "yoy_pct": yoy,
                            "period": month_label,
                        },
                    }
                )
                return out
        except Exception as e:  # noqa: BLE001
            warnings.append(f"GST monthly PDF parse: {e}")
    else:
        if code == 403:
            warnings.append(f"GST monthly PDF 403 — trying statewise xlsx")
        elif err:
            warnings.append(f"GST monthly PDF: {err}")

    # --- 2) Statewise xlsx (Collections-Statewise) ---
    try:
        import openpyxl  # noqa: WPS440
    except ImportError:
        out["error"] = "openpyxl missing and monthly PDF failed"
        warnings.append("GST: openpyxl not installed — left null")
        return out

    def parse_gujarat(path: Path):
        wb = openpyxl.load_workbook(path, data_only=True)
        sheet = None
        for name in wb.sheetnames:
            if "statewise" in name.lower() or "collections" in name.lower():
                sheet = name
                break
        if not sheet:
            sheet = wb.sheetnames[0]
        ws = wb[sheet]
        as_of_txt = None
        for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
            for c in row:
                if isinstance(c, str) and "data upto" in c.lower():
                    as_of_txt = c
        # header months
        headers = None
        for i in range(1, 10):
            vals = list(next(ws.iter_rows(min_row=i, max_row=i, values_only=True)))
            if any(isinstance(v, datetime) for v in vals):
                headers = vals
                break
        months = []
        if headers:
            for i, h in enumerate(headers):
                if isinstance(h, datetime):
                    months.append((i, h))
        guj = None
        for row in ws.iter_rows(values_only=True):
            if row and any(
                isinstance(c, str) and c.strip().lower() == "gujarat" for c in row if c
            ):
                guj = list(row)
                break
        return months, guj, as_of_txt, sheet

    now = datetime.now(IST)
    fy_start = now.year if now.month >= 4 else now.year - 1
    years = [f"{fy_start}-{str(fy_start+1)[2:]}", f"{fy_start-1}-{str(fy_start)[2:]}"]
    parsed = {}
    for fy in years:
        url = GST_XLSX.format(fy=fy)
        local = Path(tempfile.gettempdir()) / f"gst_{fy}.xlsx"
        raw, err, code = http_get(url, timeout=60)
        if raw and raw[:2] == b"PK":
            local.write_bytes(raw)
            out["source_url"] = url
        elif not (local.exists() and local.stat().st_size > 1000):
            # alternate cached name from older probe path
            alt_local = Path(tempfile.gettempdir()) / f"gst_{fy}.xlsx"
            if code == 403:
                warnings.append(f"GST xlsx {fy}: HTTP 403")
            elif err:
                warnings.append(f"GST xlsx {fy}: {err}")
            if not alt_local.exists():
                continue
            local = alt_local
        if local.exists() and local.stat().st_size > 1000:
            try:
                months, guj, as_of_txt, sheet = parse_gujarat(local)
                if guj:
                    parsed[fy] = (months, guj, as_of_txt, url if raw else str(local), sheet)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"GST parse {fy}: {e}")

    if not parsed:
        out["error"] = "could not download/parse GSTN statewise xlsx or monthly PDF"
        warnings.append("GST: all sources failed — left null")
        return out

    ordered = sorted(parsed.keys(), key=lambda x: int(x.split("-")[0]), reverse=True)
    cur_fy = ordered[0]
    months, guj, as_of_txt, src, sheet = parsed[cur_fy]

    def month_totals(months_, guj_):
        rows = []
        for i, mdt in months_:
            # Collections-Statewise: TOTAL at i+3; other sheets may differ — try TOTAL-like
            total = None
            for off in (3, 0, 1, 2, 4):
                try:
                    v = guj_[i + off]
                except IndexError:
                    continue
                if isinstance(v, (int, float)):
                    total = float(v)
                    if off == 3:
                        break
            if total is not None:
                rows.append((mdt, total))
        return rows

    totals = month_totals(months, guj) if months else []
    if not totals:
        # fallback: last numeric in row as cumulative — still better than inventing
        out["error"] = "Gujarat row found but monthly totals unclear"
        warnings.append("GST: xlsx structure unexpected — left null")
        return out

    latest_m, latest_v = totals[-1]
    prior_v = None
    prior_fy = f"{int(cur_fy.split('-')[0]) - 1}-{str(int(cur_fy.split('-')[0]))[2:]}"
    if prior_fy in parsed:
        pm, pg, _, _, _ = parsed[prior_fy]
        for mdt, v in month_totals(pm, pg):
            if mdt.month == latest_m.month:
                prior_v = v
                break
    yoy = None
    if prior_v and prior_v != 0:
        yoy = round((latest_v - prior_v) / abs(prior_v) * 100.0, 2)
    mom = None
    if len(totals) >= 2 and totals[-2][1]:
        mom = round((latest_v - totals[-2][1]) / abs(totals[-2][1]) * 100.0, 2)

    display = f"₹{latest_v:,.1f} Cr ({latest_m.strftime('%b %Y')})"
    if yoy is not None:
        display += f" · YoY {yoy:+.2f}%"
    elif mom is not None:
        display += f" · MoM {mom:+.2f}%"

    out.update(
        {
            "value": yoy if yoy is not None else latest_v,
            "display": display,
            "unit": "% YoY" if yoy is not None else "INR Cr",
            "as_of": latest_m.strftime("%Y-%m"),
            "direction": _dir_from_pct(yoy if yoy is not None else mom),
            "source": f"GSTN statewise_GST_collection ({sheet})",
            "source_url": src if isinstance(src, str) and src.startswith("http") else GST_STATS,
            "error": None,
            "evidence": "fact",
            "note": as_of_txt,
            "raw": {
                "month_total_cr": round(latest_v, 2),
                "prior_year_same_month_cr": round(prior_v, 2) if prior_v else None,
                "yoy_pct": yoy,
                "mom_pct": mom,
                "fy": cur_fy,
            },
        }
    )
    return out


def fetch_ports(warnings: list[str]) -> dict[str, dict]:
    """Mundra/Hazira from Adani IR PDF; Kandla left null if DPA/IPA fail."""
    mundra = macro_shell(
        "Mundra port throughput",
        unit="MMT",
        source="Adani Ports operational highlights",
        source_url=ADANI_IR_INDEX,
    )
    hazira = macro_shell(
        "Hazira port throughput",
        unit="MMT",
        source="Adani Ports operational highlights",
        source_url=ADANI_IR_INDEX,
    )
    kandla = macro_shell(
        "Kandla (Deendayal) throughput",
        unit="MMT",
        source="DPA / IPA monthly traffic",
        source_url="https://www.deendayalport.gov.in/",
        error="DPA/IPA HTML shell or SSL fail — no published monthly tonnes scrapeable",
        note="manual paste from DPA/IPA bulletin if needed",
    )

    # Prefer latest ops PDF; fall back to discovering q*-fy*.pdf from IR index
    pdf_url = ADANI_OPS
    raw, err, code = http_get(pdf_url, timeout=90)
    if not raw or not raw.startswith(b"%PDF"):
        if code == 403:
            warnings.append("Ports: Adani Q1 PDF 403 — trying IR index")
        idx, ierr, _ = http_get(ADANI_IR_INDEX, timeout=40)
        if idx:
            html = idx.decode("utf-8", errors="replace")
            links = re.findall(
                r'href=["\']([^"\']*operational-highlights/q[^"\']+\.pdf)["\']',
                html,
                re.I,
            )
            if links:
                href = links[0]
                if href.startswith("/"):
                    pdf_url = "https://www.adaniports.com" + href
                else:
                    pdf_url = href
                raw, err, code = http_get(pdf_url, timeout=90)
        if not raw or not raw.startswith(b"%PDF"):
            warnings.append(f"Ports: Adani PDF unavailable ({err or code}) — Mundra/Hazira null")
            mundra["error"] = err or "pdf unavailable"
            hazira["error"] = err or "pdf unavailable"
            # Kandla probe
            dpa, derr, dcode = http_get("https://www.deendayalport.gov.in/en/cargo-traffic", timeout=20)
            if not dpa or (dpa and len(dpa) < 5000):
                warnings.append("Ports: Deendayal cargo page empty/JS — Kandla null")
            return {"port_mundra": mundra, "port_hazira": hazira, "port_kandla": kandla}

    pdf_path = Path(tempfile.gettempdir()) / "adani_ops.pdf"
    pdf_path.write_bytes(raw)
    text = ""
    try:
        import subprocess

        text = subprocess.check_output(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            stderr=subprocess.DEVNULL,
            timeout=60,
        ).decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Ports: pdftotext failed ({e})")
        mundra["error"] = "pdftotext failed"
        hazira["error"] = "pdftotext failed"
        return {"port_mundra": mundra, "port_hazira": hazira, "port_kandla": kandla}

    # Port volume table lines: Mundra1 51.2 48.0 7% ...
    m_m = re.search(
        r"Mundra\d*\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+([+\-]?[0-9]+)%",
        text,
    )
    h_m = re.search(
        r"Hazira\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+([+\-]?[0-9]+)%",
        text,
    )
    # Period from filename / body
    period = "Q1 FY27"
    if re.search(r"quarter ended June 30,\s*2026", text, re.I):
        as_of = "2026-06-30"
        period = "Q1 FY27 (Apr–Jun 2026)"
    else:
        as_of = None
        ym = re.search(r"quarter ended ([A-Za-z]+ \d{1,2}, \d{4})", text, re.I)
        if ym:
            as_of = ym.group(1)

    if m_m:
        cur, prior, yoy = float(m_m.group(1)), float(m_m.group(2)), float(m_m.group(3))
        mundra.update(
            {
                "value": cur,
                "display": f"{cur} MMT {period} (YoY {yoy:+.0f}% vs {prior})",
                "as_of": as_of or "2026-06-30",
                "direction": _dir_from_pct(yoy),
                "source": "Adani Ports Q1 FY27 operational highlights (port volume table)",
                "source_url": pdf_url,
                "error": None,
                "evidence": "fact",
                "raw": {"q_mmt": cur, "prior_q_mmt": prior, "yoy_pct": yoy, "period": period},
            }
        )
    else:
        mundra["error"] = "Mundra row not found in PDF"
        warnings.append("Ports: Mundra volume not parsed — null")

    if h_m:
        cur, prior, yoy = float(h_m.group(1)), float(h_m.group(2)), float(h_m.group(3))
        hazira.update(
            {
                "value": cur,
                "display": f"{cur} MMT {period} (YoY {yoy:+.0f}% vs {prior})",
                "as_of": as_of or "2026-06-30",
                "direction": _dir_from_pct(yoy),
                "source": "Adani Ports Q1 FY27 operational highlights (port volume table)",
                "source_url": pdf_url,
                "error": None,
                "evidence": "fact",
                "raw": {"q_mmt": cur, "prior_q_mmt": prior, "yoy_pct": yoy, "period": period},
            }
        )
    else:
        hazira["error"] = "Hazira row not found in PDF"
        warnings.append("Ports: Hazira volume not parsed — null")

    # Kandla: Deendayal / IPA — document failure
    dpa, derr, dcode = http_get("https://www.deendayalport.gov.in/", timeout=20)
    if derr or (dpa and len(dpa) < 5000):
        warnings.append(
            f"Ports: Kandla/Deendayal not scrapeable ({derr or 'thin HTML'}) — null"
        )
    else:
        warnings.append("Ports: Kandla page reachable but no monthly tonnes parser — null")
    return {"port_mundra": mundra, "port_hazira": hazira, "port_kandla": kandla}


def fetch_rainfall(warnings: list[str]) -> dict:
    """IMD state rainfall — prefer monthly (msg=M) departure % for Gujarat."""
    out = macro_shell(
        "Rainfall / agri (IMD Gujarat)",
        unit="% departure",
        source="IMD state-wise rainfall",
        source_url=IMD_STATE,
    )
    # M = monthly (labels show prior calendar month range)
    url = f"{IMD_STATE}?msg=M"
    raw, err, code = http_get(url, timeout=40)
    if not raw:
        if code == 403:
            warnings.append("Rainfall: IMD 403 — trying default state page")
            raw, err, code = http_get(IMD_STATE, timeout=40)
        if not raw:
            out["error"] = err or "IMD fetch failed"
            warnings.append(f"Rainfall: {out['error']} — null")
            return out
    text = raw.decode("utf-8", errors="replace")
    m = re.search(
        r'"GUJARAT[^"]*"[\s\S]{0,450}Departure\s*:\s*([+\-]?\d+%)'
        r"[\s\S]{0,120}Actual\s*:\s*([0-9.]+)\s*mm"
        r"[\s\S]{0,80}Normal\s*:\s*([0-9.]+)\s*mm",
        text,
        re.I,
    )
    period = None
    pm = re.search(
        r"Monthly\s*\(([^)]*From\s*[0-9]{2}-[0-9]{2}-[0-9]{4}\s*To\s*[0-9]{2}-[0-9]{2}-[0-9]{4}[^)]*)\)",
        text,
        re.I,
    )
    if pm:
        period = re.sub(r",+", "", pm.group(1)).strip()
    if not m:
        out["error"] = "Gujarat block not found in IMD HTML"
        warnings.append("Rainfall: parse miss — null")
        return out
    dep_s, actual_s, normal_s = m.group(1), m.group(2), m.group(3)
    dep = float(dep_s.replace("%", ""))
    actual = float(actual_s)
    normal = float(normal_s)
    # as_of from period end
    as_of = None
    if period:
        em = re.search(r"To\s*([0-9]{2})-([0-9]{2})-([0-9]{4})", period)
        if em:
            as_of = f"{em.group(3)}-{em.group(2)}"
    out.update(
        {
            "value": dep,
            "display": (
                f"Gujarat monthly departure {dep_s} "
                f"(actual {actual} mm vs normal {normal} mm"
                + (f"; {period}" if period else "")
                + ")"
            ),
            "as_of": as_of,
            "direction": _dir_from_pct(dep, thr=10.0),
            "source_url": url,
            "error": None,
            "evidence": "fact",
            "raw": {
                "departure_pct": dep,
                "actual_mm": actual,
                "normal_mm": normal,
                "period": period,
            },
        }
    )
    return out


def fetch_credit(warnings: list[str]) -> dict:
    """RBI Handbook Table 156 state-wise SCB credit — null if xlsx gated."""
    out = macro_shell(
        "RBI Gujarat bank credit",
        unit="% YoY",
        source="RBI Handbook of Statistics on Indian States — Table 156 (SCB credit)",
        source_url=RBI_HANDBOOK,
    )
    raw, err, code = http_get(
        RBI_CREDIT_XLSX,
        timeout=40,
        headers={
            "Referer": RBI_HANDBOOK,
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        },
    )
    if raw and raw[:2] == b"PK":
        try:
            import openpyxl

            p = Path(tempfile.gettempdir()) / "rbi_credit.xlsx"
            p.write_bytes(raw)
            wb = openpyxl.load_workbook(p, data_only=True)
            ws = wb.active
            guj_row = None
            header = None
            for i, row in enumerate(ws.iter_rows(values_only=True), 1):
                if i <= 5:
                    header = row
                if row and any(
                    isinstance(c, str) and c.strip().lower() == "gujarat" for c in row if c
                ):
                    guj_row = list(row)
                    break
            if guj_row and header:
                # find last two numeric year cols
                nums = [
                    (j, float(guj_row[j]))
                    for j, c in enumerate(guj_row)
                    if isinstance(c, (int, float)) and c is not None
                ]
                if len(nums) >= 2:
                    _, latest = nums[-1]
                    _, prior = nums[-2]
                    yoy = round((latest - prior) / abs(prior) * 100.0, 2) if prior else None
                    out.update(
                        {
                            "value": yoy,
                            "display": f"Gujarat SCB credit YoY {yoy:+.2f}% (levels {prior} → {latest})",
                            "direction": _dir_from_pct(yoy),
                            "source_url": RBI_CREDIT_XLSX,
                            "error": None,
                            "evidence": "fact",
                            "raw": {"latest": latest, "prior": prior, "yoy_pct": yoy},
                        }
                    )
                    return out
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Credit: parse error {e}")
            out["error"] = f"parse: {e}"
            return out
    # Blocked / HTML interstitial
    if code == 403 or (raw and b"<!DOCTYPE" in raw[:200]):
        out["error"] = "rbidocs xlsx gated/blocked (HTML challenge)"
        warnings.append("Credit: RBI docs xlsx blocked — null (paste from Handbook T156)")
    else:
        out["error"] = err or "RBI credit xlsx unavailable"
        warnings.append(f"Credit: {out['error']} — null")
    out["note"] = "Manual: RBI Handbook Table 156 State-wise Credit by SCBs"
    return out


def fetch_power(warnings: list[str]) -> dict[str, dict]:
    """GUVNL/DGVCL/MGVCL — PDF/dashboard heavy; leave null + manual paste note."""
    note = "manual paste"
    dgvcl = macro_shell(
        "DGVCL power demand / sales",
        unit="MU / %",
        source="DGVCL / GUVNL public disclosures",
        source_url="https://www.dgvcl.com/",
        error="PDF-only / no clean numeric feed",
        note=note,
        evidence="unknown",
    )
    mgvcl = macro_shell(
        "MGVCL power demand / sales",
        unit="MU / %",
        source="MGVCL / GUVNL public disclosures",
        source_url="https://www.mgvcl.com/",
        error="PDF-only / no clean numeric feed",
        note=note,
        evidence="unknown",
    )
    # Soft reachability check only
    for label, url, bucket in [
        ("GUVNL", "https://www.guvnl.com/", None),
        ("DGVCL", "https://www.dgvcl.com/", dgvcl),
        ("MGVCL", "https://www.mgvcl.com/", mgvcl),
    ]:
        raw, err, code = http_get(url, timeout=15)
        if err or code == 403:
            warnings.append(f"Power: {label} {err or code} — left null ({note})")
            if bucket is not None:
                bucket["error"] = f"{err or code}; {note}"
        else:
            warnings.append(f"Power: {label} reachable but no auto numeric extract — null ({note})")
    return {"power_dgvcl": dgvcl, "power_mgvcl": mgvcl}


def empty_gsdp_iip() -> dict[str, dict]:
    return {
        "gsdp_yoy": macro_shell(
            "Gujarat GSDP growth YoY",
            unit="%",
            source="MoSPI state accounts / PRS / state budget — soft hint only",
            source_url="https://www.mospi.gov.in/",
            error="not auto-fetched — do not invent; paste from MoSPI/PRS",
            note="Source hint: MoSPI / PRS India state finances",
            evidence="unknown",
        ),
        "iip_gujarat": macro_shell(
            "Gujarat IIP / industrial activity YoY",
            unit="%",
            source="State DES / MoSPI — soft hint only",
            source_url="https://www.mospi.gov.in/",
            error="not auto-fetched — do not invent; paste from MoSPI/DES",
            note="Source hint: MoSPI / Gujarat DES",
            evidence="unknown",
        ),
    }


def main() -> int:
    warnings: list[str] = []
    market = {}
    one_mo = {"inr_usd", "india_vix", "gold", "natgas", "cotton", "nifty_auto", "brent"}
    for k, sym in MARKET.items():
        print(f"market {k} ({sym})...", flush=True)
        market[k] = yahoo_chart(sym, "1mo" if k in one_mo else "5d")
        if market[k].get("value") is None:
            warnings.append(f"{k}: {market[k].get('error')}")

    proxies: dict[str, dict] = {}
    for cluster, syms in PROXIES.items():
        for sym in syms:
            print(f"proxy {cluster} {sym}...", flush=True)
            proxies[sym] = yahoo_chart(sym, "1mo")
            if proxies[sym].get("value") is None:
                warnings.append(f"{sym}: {proxies[sym].get('error')} — left null")

    print("macro GST...", flush=True)
    state_gst = fetch_gst(warnings)
    print("macro ports...", flush=True)
    ports = fetch_ports(warnings)
    print("macro rainfall...", flush=True)
    rainfall = fetch_rainfall(warnings)
    print("macro credit...", flush=True)
    credit = fetch_credit(warnings)
    print("macro power...", flush=True)
    power = fetch_power(warnings)
    gsdp_iip = empty_gsdp_iip()

    macros = {
        **gsdp_iip,
        "state_gst": state_gst,
        **power,
        **ports,
        "rbi_gujarat_credit": credit,
        "rainfall_agri": rainfall,
    }

    filled = [k for k, v in macros.items() if v.get("value") is not None]
    nulls = [k for k, v in macros.items() if v.get("value") is None]

    snapshot = {
        "generated_at_utc": now_iso(),
        "generated_at_ist": now_ist(),
        "disclaimer": (
            "Credit field aid for Gujarat industry health-check. Listed names are "
            "industry PROXIES, not a buy list. Not investment advice. Not an HDFC "
            "loan-advisory product. Failed fetches are null with warnings — never invented."
        ),
        "market": market,
        "leading": {k: market[k] for k in (
            "brent", "inr_usd", "gold", "natgas", "cotton", "nifty_auto", "nifty", "india_vix"
        ) if k in market},
        "indicator_map": INDICATOR_MAP,
        "proxies": proxies,
        "proxy_map": PROXIES,
        "listed_pulse_note": (
            "Listed NSE names are an optional secondary pulse (price/1m only). "
            "Not for credit decision. Do not invent company fundamentals."
        ),
        "macros": macros,
        "warnings": warnings,
        "fetch_notes": [
            f"Leading Yahoo series filled: {sum(1 for k in ('brent','inr_usd','gold','natgas','cotton','nifty_auto') if (market.get(k) or {}).get('value') is not None)}/6",
            f"Listed pulse prices: {sum(1 for v in proxies.values() if v.get('value') is not None)}/{len(proxies)} (secondary only)",
            f"Macros filled (fact): {filled}",
            f"Macros still null: {nulls}",
        ],
    }
    for w in warnings:
        snapshot["fetch_notes"].append("WARN: " + w)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}", flush=True)
    print(f"IST {snapshot['generated_at_ist']}", flush=True)
    print(f"FILLED {filled}", flush=True)
    print(f"NULL {nulls}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fetch Yahoo prices for cluster proxies + optional market overlays. Never invent."""
from __future__ import annotations

import json
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent / "data" / "snapshot.json"
IST = timezone(timedelta(hours=5, minutes=30), name="Asia/Calcutta")
UA = "Mozilla/5.0 (compatible; GujaratIndustryHealth/1.0)"

# Seed proxies — liquid NSE names that REPRESENT the industry for credit health-check (NOT a buy list).
# See AUDIT_LOGIC.md / PROXY_RATIONALE in app for why each was chosen.
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
}


def now_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S Asia/Calcutta")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def http_get(url: str, timeout: int = 20) -> tuple[bytes | None, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read(), None
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"


def yahoo_chart(symbol: str, range_: str = "1mo") -> dict:
    enc = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?range={range_}&interval=1d"
    raw, err = http_get(url)
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


def empty_macro(name: str, note: str, unit: str = "%") -> dict:
    return {
        "name": name,
        "value": None,
        "unit": unit,
        "as_of": None,
        "direction": "unknown",
        "source": note,
        "source_url": None,
        "error": "not auto-fetched — enter manually or AI-fill (tagged ai)",
        "evidence": "unknown",
    }


def main() -> int:
    warnings: list[str] = []
    market = {}
    for k, sym in MARKET.items():
        print(f"market {k} ({sym})...", flush=True)
        market[k] = yahoo_chart(sym, "1mo" if k in ("inr_usd", "india_vix") else "5d")
        if market[k].get("value") is None:
            warnings.append(f"{k}: {market[k].get('error')}")

    proxies: dict[str, dict] = {}
    for cluster, syms in PROXIES.items():
        for sym in syms:
            print(f"proxy {cluster} {sym}...", flush=True)
            proxies[sym] = yahoo_chart(sym, "1mo")
            if proxies[sym].get("value") is None:
                warnings.append(f"{sym}: {proxies[sym].get('error')} — left null")

    snapshot = {
        "generated_at_utc": now_iso(),
        "generated_at_ist": now_ist(),
        "disclaimer": (
            "Credit field aid for Gujarat industry health-check. Listed names are "
            "industry PROXIES, not a buy list. Not investment advice. Not an HDFC "
            "loan-advisory product. Failed fetches are null with warnings — never invented."
        ),
        "market": market,
        "proxies": proxies,
        "proxy_map": PROXIES,
        "macros": {
            "gsdp_yoy": empty_macro("Gujarat GSDP growth YoY", "State budget / MoSPI state accounts — manual"),
            "iip_gujarat": empty_macro("Gujarat IIP / industrial activity YoY", "State DES / MoSPI — manual"),
            "state_gst": empty_macro("Gujarat GST collections (₹ cr or YoY)", "State finance / GSTN releases — manual", "INR cr / %"),
            "power_dgvcl": empty_macro("DGVCL power demand / sales", "DGVCL / GUVNL disclosures — manual", "MU / %"),
            "power_mgvcl": empty_macro("MGVCL power demand / sales", "MGVCL / GUVNL disclosures — manual", "MU / %"),
            "port_mundra": empty_macro("Mundra port throughput", "Adani Ports / IPA — manual", "MT / %"),
            "port_hazira": empty_macro("Hazira port throughput", "Operator / IPA — manual", "MT / %"),
            "port_kandla": empty_macro("Kandla (Deendayal) throughput", "DPA / IPA — manual", "MT / %"),
            "rbi_gujarat_credit": empty_macro("RBI Gujarat bank credit growth", "RBI state-level banking stats — manual"),
            "rainfall_agri": empty_macro("Rainfall / agri note", "IMD / state agri — qualitative OK", "note"),
        },
        "warnings": warnings,
        "fetch_notes": [
            f"Proxies with prices: {sum(1 for v in proxies.values() if v.get('value') is not None)}/{len(proxies)}",
            "Gujarat macros left null for manual/AI — no free unauth state feed used.",
        ],
    }
    for w in warnings:
        snapshot["fetch_notes"].append("WARN: " + w)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}", flush=True)
    print(f"IST {snapshot['generated_at_ist']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

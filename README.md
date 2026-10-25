# Gujarat Industry Health Check

**Live:** https://cakashoza-cmyk.github.io/gujarat-industry-health/

Bank-analyst **credit field aid** for South Gujarat industry clusters (Surat textiles, Morbi ceramics, Vapi–Ankleshwar chemicals, etc.). Patterned on the India Regime Engine rejection-machine UX.

## What this is / is not

| Is | Is not |
|----|--------|
| Cluster health dials + listed **proxies** for credit context | Investment advice or a buy list |
| STOP / PROCEED health gates for field underwriting | An HDFC loan-advisory product |
| DeepSeek-assisted fill (tagged AI) | Authoritative MOSPI/RBI substitute |

Owner context: credit underwriting aid for Gujarat SME/mid-corporate field work. **No loan-advisory product claims.** Unclear / STOP is preferred over forced labels.

## Layers

1. **Gujarat macros** — GSDP/IIP, state GST, power (DGVCL/MGVCL), ports (Mundra/Hazira/Kandla), RBI Gujarat credit, rainfall/agri. Auto-fetch what Yahoo/public APIs allow; else null + warning.
2. **Industry clusters** — Demand / Cost / WC-receivables / Policy-export dials → Strong / Mixed / Weak / Unclear.
3. **Listed proxies** — 2–4 liquid NSE names per cluster (industry representation for credit health-check, **not** a buy list).
4. **Health gates** — Gate 1–5 rejection machine (question → regime → change → gap → conflict/divergence STOP).

## DeepSeek

Settings tab → paste API key (stays in `localStorage` only). Provider: `api.deepseek.com` only.

## Refresh

```bash
python3 refresh_data.py
```

Writes `data/snapshot.json`. Never invents numbers.

## Docs

- [AUDIT_LOGIC.md](./AUDIT_LOGIC.md) — scoring + Implemented vs manual

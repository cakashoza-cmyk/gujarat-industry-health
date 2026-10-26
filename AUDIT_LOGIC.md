# Gujarat Industry Health — Audit Logic (v2 credit rebuild)

| Field | Value |
|-------|-------|
| **Live** | https://cakashoza-cmyk.github.io/gujarat-industry-health/ |
| **As of** | 2026-10-26 Asia/Calcutta |
| **Owner** | Akash Oza (HDFC South Gujarat credit field) |

## Disclaimer

Credit **field aid** for Gujarat SME/mid-corporate health-check. **Not investment advice. Not an HDFC loan-advisory product.** Listed NSE names are an optional **Listed pulse** (price/1m only) and are **not for credit decision**. Prefer Unclear / STOP over invented numbers. DeepSeek is optional.

## Layers (priority order)

| Priority | Layer | Role |
|----------|-------|------|
| 1 | **Cluster dials** (Demand / Cost / WC / Policy) | Credit officer judgment |
| 1 | **Field notes** (per cluster, localStorage) | Site visit / borrower feedback — what you actually have |
| 1 | **Leading indicators** | Yahoo/public scrapes mapped → dial; null never invent |
| 1 | **Gujarat macros** | GST, ports, rainfall, etc. when scrapeable |
| 2 | **Listed pulse** | Optional price/1m secondary check — collapsed in UI; no fundie blanks |

## Leading indicators → dial map

| Cluster | Indicators | Dial |
|---------|------------|------|
| Surat textiles weave/process | Cotton (CT=F), Brent, USDINR; PSF/POY = manual in field notes | Cost (mostly) |
| Morbi ceramics | Natgas (NG=F), Brent, USDINR | Cost |
| Vapi–Ankleshwar chemicals | Brent (naphtha proxy), USDINR | Cost |
| Diamonds / jewellery | USDINR, Gold (GC=F) | Demand |
| Auto / ancillary | Nifty Auto (^CNXAUTO), USDINR | Demand / Cost |
| Ports / logistics | Mundra + Hazira macros, Brent | Demand / Cost |
| Renewables | USDINR only; mostly field notes | Cost |

## Health score

Weighted blend (listed pulse **excluded**):

- Each known dial signal ×2 (Cost & WC inverted: rising = unhealthy)
- Each known leading-indicator signal ×1 (same invert rules via mapped dial)
- Strong if score/weight ≥ 0.45; Weak if ≤ −0.45; else Mixed; Unclear if weight &lt; 2

Field notes do not numeric-score; they feed Gate 2/4 narrative and show on scorecards.

## Divergence STOP

**Primary:** leading indicators conflict with set dials on the same dial (≥50% of related indicators disagree) → Gate 5 STOP.

**Secondary (soft only):** listed pulse 1m disagrees with Strong/Weak — shown as note, not auto credit STOP.

## Macro auto-fetch

| Key | Auto | On failure |
|-----|------|------------|
| state_gst | GSTN monthly PDF | null + warning |
| port_mundra / port_hazira | Adani IR PDF | null |
| port_kandla | — | null (DPA/IPA) |
| rainfall_agri | IMD monthly departure | null |
| rbi_gujarat_credit | RBI Handbook T156 | null if gated |
| power_* | — | null + `manual paste` |
| gsdp_yoy / iip_gujarat | — | null + MoSPI/PRS hint |

Evidence: `fact` | `manual` | `ai` | `unknown`.

## DeepSeek

Optional. `api.deepseek.com` only. Must copy snapshot `fact` macros; must **not** invent company fundamentals or fill empty fundie grids (removed).

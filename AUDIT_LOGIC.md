# Gujarat Industry Health — Audit Logic (v1 scaffold)

| Field | Value |
|-------|-------|
| **Live** | https://cakashoza-cmyk.github.io/gujarat-industry-health/ |
| **As of** | 2026-10-26 Asia/Calcutta |
| **Owner** | Akash Oza (Surat; credit field context) |

## Disclaimer

Credit **field aid** for Gujarat industry health-check. Listed equities are **industry proxies for credit context**, not a buy list. Not investment advice. **Not an HDFC loan-advisory product.** Unclear / STOP preferred over forced labels. AI fills are tagged `ai` — verify primary sources.

## Implemented vs manual

| Layer | Auto | Manual / AI |
|-------|------|-------------|
| Proxy price, 1d/1m direction | Yahoo → `data/snapshot.json` | — |
| Gujarat macros (GSDP, GST, power, ports, credit, agri) | None trusted free feed | Manual or DeepSeek (tagged ai); null if unknown |
| Cluster dials (Demand, Cost, WC, Policy) | Majority score from user/AI dirs | User or AI |
| Proxy fundies (rev, EBITDA, debt/EBITDA, days) | — | Manual / AI from latest results |
| Health gates 1–5 | UI STOP/PROCEED rules | Judgment |

## Cluster health score

Each dial direction ∈ {rising, flat, falling, unknown}. Ignore unknown/flat for majority:

- ≥60% rising among known → dial Rising
- ≥60% falling → Falling
- else Unclear / Flat

Cluster health from four dials (Demand, Cost inverted for “health”, WC stress inverted, Policy/export):

- Cost Rising = negative for health; WC stress Rising = negative.
- Strong: ≥3 healthy signals, 0 conflicting weak
- Weak: ≥3 unhealthy
- Mixed: split
- Unclear: insufficient known dials

## Divergence flag

If cluster health Strong/Weak but ≥50% of proxies with known 1m direction disagree (Strong but proxies falling, or Weak but proxies rising) → **divergence** → Gate 5 can STOP.

## Proxy rationale (why these names)

| Cluster | Tickers | Why (credit proxy, not buy list) |
|---------|---------|----------------------------------|
| Surat textiles weaving | TRIDENT, ARVIND, KPRMILL, FILATEX | Liquid textile/filament names; FILATEX/ARVIND closer to yarn-fabric cycle Surat feels; no perfect pure-Surat liquid weave pure-play |
| Surat textiles processing | WELSPUNLIV, HIMATSEIDE, GOKEX, RAYMOND | Home-textile / processing / garment exporters as demand-cost proxies for process chain |
| Morbi ceramics | CERA, KAJARIACER, SOMANYCERA, ORIENTBELL | Liquid domestic tile/sanitary names standing in for Morbi cluster cycle |
| Vapi–Ankleshwar chemicals | DEEPAKNTR, AARTIIND, GUJALKALI, ATUL | Gujarat chemical specialty/commodity liquid names |
| Diamonds / jewellery | TITAN, KALYANKJIL, SENCO | Liquid jewellery retail as demand proxy; diamond manufacturing lacks clean liquid pure-plays — labeled as such |
| Auto / ancillary | MOTHERSON, BHARATFORG, ENDURANCE | Liquid auto-ancillary cycle proxies (Gujarat has auto footprint; not Surat-only) |
| Ports / logistics | ADANIPORTS, GPPL, JSWINFRA, GESHIP | Mundra/Pipavav/infra + shipping as Gujarat trade throughput proxies |
| Renewables | SUZLON, INOXWIND, WAAREEENER, KPIGREEN | Liquid wind/solar/module/IPP names; avoid illiquid / stressed microcaps |

## DeepSeek

`api.deepseek.com` only. Key in `localStorage`. Must not invent null macros/fundies — leave null + warn.

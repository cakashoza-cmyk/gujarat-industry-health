# Gujarat Industry Health Check

**Live:** https://cakashoza-cmyk.github.io/gujarat-industry-health/

HDFC South Gujarat **credit field aid** for industry clusters (Surat textiles, Morbi ceramics, Vapi–Ankleshwar chemicals, ports, etc.).

## What this is / is not

| Is | Is not |
|----|--------|
| Cluster scorecards + dials + **field notes** + leading indicators | Investment advice or buy list |
| Gujarat macros when scrapeable | Substitute for MOSPI/RBI filings |
| Optional DeepSeek (tagged AI) | Required to be useful |
| Listed pulse = secondary price/1m only | Company fundamentals / credit decision input |

## Landing UX

**Clusters** tab first: scorecards with health + indicator chips + field-note preview. Click to edit dials, leading-indicator table, and site/borrower notes.

## Refresh

```bash
python3 refresh_data.py
```

Writes `data/snapshot.json` (Yahoo leading series + listed pulse prices + macros). Never invents.

## Docs

- [AUDIT_LOGIC.md](./AUDIT_LOGIC.md)

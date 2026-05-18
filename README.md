# aci-bem-proxy

Cloudflare Worker proxy for **BEM — Biodiversity Endurance Monitor**  
Aether Continuity Institute · v0.1 · 2026

Bridges the FinBIF API (Finnish Biodiversity Information Facility) for use in  
ACI's BEM instrument and WEM/HEM dashboard pages.

---

## Routes

```
GET /status
GET /finbif/observations?taxon=MX.47169&bbox=26.5,62.55,27.25,63.3&years=2020-2026
GET /finbif/species?bbox=...&ref_years=2000-2010&cur_years=2020-2026
GET /finbif/taxon?id=MX.47169
```

---

## Deploy

```bash
npm install
wrangler secret put FINBIF_TOKEN   # paste FinBIF token when prompted
wrangler deploy
```

Worker URL: `https://aci-bem-proxy.ruotsalainen-marko.workers.dev`

---

## Indicator species (D_s component)

| MX ID | Species | Role |
|-------|---------|------|
| MX.47169 | Pteromys volans (liito-orava) | Forest connectivity |
| MX.37622 | Ficedula hypoleuca (kirjosieppo) | Old-growth forest |
| MX.37620 | Ficedula parva (pikkusieppo) | Riparian forest |
| MX.26969 | Gavia arctica (kuikka) | Lake water quality |
| MX.26966 | Mergus merganser (isokoskelo) | River/lake health |

---

## BEM instrument family

| Monitor | Domain | Index |
|---------|--------|-------|
| WEM | Energy system | EPP |
| HEM | Hydrology | HEPP |
| **BEM** | **Ecology** | **BEPP** |

---

## Reference

- [TN-015 — Biodiversity Endurance Monitor](https://aethercontinuity.org/supplements/tn-015-biodiversity-endurance-monitor.html)
- [FinBIF API](https://api.laji.fi)
- [ACI](https://aethercontinuity.org)

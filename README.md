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

| MX ID | Species | Group |
|-------|---------|-------|
| MX.47169 | Pteromys volans (liito-orava) | Forest |
| MX.73566 | Dryocopus martius (palokärki) | Forest |
| MX.27649 | Pandion haliaetus (kalasääski) | Forest/lake |
| MX.26928 | Tetrao urogallus (metso) | Forest |
| MX.26415 | Aythya fuligula (tukkasotka) | Waterfowl |
| MX.26435 | Bucephala clangula (telkkä) | Waterfowl |
| MX.26366 | Anas crecca (tavi) | Waterfowl |

### Normalisointi (2026-10-15)

`norm_ratio` = lajin osuus kaikista saman alueen ja jakson lintuhavainnoista (Aves, MX.37580),
nykyjakso jaettuna viitejaksolla. Korvasi kiinteän kertoimen 1,8: Rautalammin reitillä
lintuhavaintoja on 2000–2010 noin 86 600 ja 2020–2026 noin 86 100. Jos Aves-haku epäonnistuu,
`D_s` on `null` (ei kiinteää 0,5-varaa).

`D_s_validated: false` ja `huomiot` kertovat, miksi D_s ei ole validoitu (Lintuatlas 3
viitejaksolla, aineistolähteiden hypyt metsolla ja tavilla, liito-oravan sijaintien karkeistus).

Testit: `node test/test.mjs` (FinBIF mockattu).

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

/**
 * aci-bem-proxy — Cloudflare Worker
 * BEM (Biodiversity Endurance Monitor) data proxy
 * Aether Continuity Institute · v0.1 · 2026
 *
 * Routes:
 *   GET /status
 *   GET /finbif/observations?taxon=MX.47169&bbox=26.5,62.55,27.25,63.3&years=2020-2026
 *   GET /finbif/species?bbox=...&ref_years=2000-2010&cur_years=2020-2026
 *   GET /finbif/taxon?id=MX.47169
 *
 * Secrets:
 *   FINBIF_TOKEN — set via: wrangler secret put FINBIF_TOKEN
 *
 * Reference:
 *   https://aethercontinuity.org/supplements/tn-015-biodiversity-endurance-monitor.html
 */

const FINBIF_BASE = "https://api.laji.fi";

// Default pilot area: Rautalammin reitti
const DEFAULT_BBOX = "26.00,62.40,27.50,63.50"; // wider for better coverage

// BEM indicator species for boreal forest/lake ecosystem
// Verified against FinBIF warehouse for Rautalammin reitti
// Groups: forest connectivity, old-growth, water quality
const INDICATOR_SPECIES = {
  // Forest connectivity (confirmed working)
  "MX.47169": "Pteromys volans (liito-orava / Siberian flying squirrel)",
  
  // Old-growth forest indicators
  "MX.73566": "Dryocopus martius (palokärki / black woodpecker)",
  "MX.37153": "Tetrao urogallus (metso / western capercaillie)",
  
  // Riparian / water indicators
  "MX.27649": "Pandion haliaetus (kalasääski / osprey)",
  "MX.26935": "Cygnus cygnus (laulujoutsen / whooper swan)",
  
  // Broad landscape indicators
  "MX.36617": "Cuculus canorus (käki / common cuckoo)",
};

// Years per observer normalization factor (approximate FinBIF growth)
// Corrects for increasing observer effort over time
const OBSERVER_GROWTH = {
  "2000/2010": 1.0,   // reference baseline
  "2020/2026": 1.8,   // ~1.8x more observers (conservative estimate, time-normalized)
};

// CORS headers — open for WEM/HEM/BEM instrument pages
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

function err(msg, status = 500) {
  return json({ error: msg, status }, status);
}

// "26.5,62.55,27.25,63.3" → "62.55:63.3:26.5:27.25:WGS84"
function bboxToFinBif(bbox) {
  const [lng1, lat1, lng2, lat2] = bbox.split(",").map(Number);
  return `${lat1}:${lat2}:${lng1}:${lng2}:WGS84`;
}

// "2020-2026" → "2020/2026"
function parseYears(y) {
  if (!y) return null;
  return y.includes("-") ? y.replace("-", "/") : y;
}

async function finbif(path, params, token) {
  const url = new URL(`${FINBIF_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, v);
  }
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`FinBIF ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleStatus() {
  return json({
    proxy: "aci-bem-proxy",
    version: "0.1",
    instrument: "BEM — Biodiversity Endurance Monitor",
    pilot: "Rautalammin reitti",
    default_bbox: DEFAULT_BBOX,
    routes: {
      "/status": "Proxy status",
      "/finbif/observations": "Single species count · ?taxon=MX.47169&bbox=...&years=2020-2026",
      "/finbif/species": "All indicator species · ?bbox=...&ref_years=2000-2010&cur_years=2020-2026",
      "/finbif/taxon": "Taxon info · ?id=MX.47169",
    },
    indicator_species: INDICATOR_SPECIES,
    bepp_components: {
      D_f: "Fragmentation (Sentinel-2 / CORINE — planned)",
      D_s: "Species stress (FinBIF — THIS proxy)",
      D_c: "Cumulative disturbance (YVA database — planned)",
      R:   "Recovery capacity (SYKE protected areas — planned)",
    },
    reference: "https://aethercontinuity.org/supplements/tn-015-biodiversity-endurance-monitor.html",
  });
}

async function handleObservations(url, token) {
  const taxon = url.searchParams.get("taxon") || "MX.47169";
  const bbox  = url.searchParams.get("bbox")  || DEFAULT_BBOX;
  const years = parseYears(url.searchParams.get("years")) || "2020/2026";

  const data = await finbif("/warehouse/query/unit/list", {
    taxonId: taxon,
    coordinates: bboxToFinBif(bbox),
    time: years,
    pageSize: 1,
    cache: "true",
  }, token);

  return json({
    taxon,
    name: INDICATOR_SPECIES[taxon] || taxon,
    bbox,
    years,
    total: data.total ?? 0,
    source: "FinBIF warehouse",
  });
}

async function handleSpecies(url, token) {
  const bbox      = url.searchParams.get("bbox")      || DEFAULT_BBOX;
  const refYears  = parseYears(url.searchParams.get("ref_years")) || "2000/2010";
  const curYears  = parseYears(url.searchParams.get("cur_years")) || "2020/2026";
  const coords    = bboxToFinBif(bbox);

  const results = {};

  await Promise.allSettled(
    Object.entries(INDICATOR_SPECIES).map(async ([id, name]) => {
      const [ref, cur] = await Promise.all([
        finbif("/warehouse/query/unit/list", {
          taxonId: id, coordinates: coords,
          time: refYears, pageSize: 1, cache: "true",
        }, token),
        finbif("/warehouse/query/unit/list", {
          taxonId: id, coordinates: coords,
          time: curYears, pageSize: 1, cache: "true",
        }, token),
      ]);

      const refTotal = ref.total ?? 0;
      const curTotal = cur.total ?? 0;
      const ratio = refTotal > 0 ? curTotal / refTotal : null;
      const trend =
        ratio === null   ? "no_data" :
        ratio >= 1.2     ? "increasing" :
        ratio >= 0.8     ? "stable" :
        ratio >= 0.5     ? "declining" :
                           "strongly_declining";

      results[id] = {
        name,
        ref_total: refTotal, ref_annual: Math.round(refAnnual * 10) / 10,
        cur_total: curTotal, cur_annual: Math.round(curAnnual * 10) / 10,
        ratio: ratio ? Math.round(ratio * 1000) / 1000 : null,
        trend
      };
    })
  );

  // Compute D_s from results
  // Normalize for observer effort growth (FinBIF/iNaturalist ~3.5x more users 2020s vs 2000s)
  // Prevents "increasing" bias from reporting growth rather than real population change
  const obsGrowth = OBSERVER_GROWTH[curYears] || OBSERVER_GROWTH["2020/2026"];

  const stressValues = Object.values(results)
    .filter(r => r.ratio !== null)
    .map(r => {
      // Normalize ratio by observer growth factor
      const normRatio = r.ratio / obsGrowth;
      // Update trend with normalized ratio
      r.norm_ratio = Math.round(normRatio * 1000) / 1000;
      r.norm_trend =
        normRatio >= 1.2 ? "increasing" :
        normRatio >= 0.8 ? "stable" :
        normRatio >= 0.5 ? "declining" :
                           "strongly_declining";
      if (normRatio >= 1.2) return 0.1;
      if (normRatio >= 0.8) return 0.3;
      if (normRatio >= 0.5) return 0.6;
      return 0.9;
    });

  const D_s = stressValues.length > 0
    ? stressValues.reduce((a, b) => a + b, 0) / stressValues.length
    : 0.5;

  return json({
    bbox,
    ref_years: refYears,
    cur_years: curYears,
    D_s: Math.round(D_s * 1000) / 1000,
    D_s_classification: D_s < 0.25 ? "Normal" : D_s < 0.5 ? "Elevated" : "Critical",
    species: results,
    source: "FinBIF warehouse",
  });
}

async function handleTaxon(url, token) {
  const id = url.searchParams.get("id");
  if (!id) return err("Missing ?id= parameter", 400);

  const data = await finbif(`/taxa/${id}`, {
    lang: "fi",
    fields: "id,scientificName,vernacularName,threatened,redListStatus",
  }, token);

  return json(data);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "GET") {
      return err("Method not allowed", 405);
    }

    // Token from secret (wrangler secret put FINBIF_TOKEN)
    const token = env.FINBIF_TOKEN;
    if (!token && path !== "/status") {
      return err("FINBIF_TOKEN secret not configured", 503);
    }

    try {
      switch (path) {
        case "/":
        case "/status":
          return handleStatus();
        case "/finbif/observations":
          return await handleObservations(url, token);
        case "/finbif/species":
          return await handleSpecies(url, token);
        case "/finbif/taxon":
          return await handleTaxon(url, token);
        default:
          return err(`Unknown route: ${path}`, 404);
      }
    } catch (e) {
      return err(e.message);
    }
  },
};

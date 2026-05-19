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
  // Metsälajit / Forest species
  "MX.47169": "Pteromys volans (liito-orava / Siberian flying squirrel)",
  "MX.73566": "Dryocopus martius (palokärki / black woodpecker)",
  "MX.27649": "Pandion haliaetus (kalasääski / osprey)",
  "MX.37153": "Tetrao urogallus (metso / western capercaillie)",
  // Sorsalinnut / Waterfowl — vesistöekosysteemin indikaattorit
  "MX.26620": "Aythya fuligula (tukkasotka / tufted duck)",
  "MX.26738": "Bucephala clangula (telkkä / common goldeneye)",
  "MX.26407": "Anas crecca (tavi / Eurasian teal)",
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

async function finbif(path, params, token, signal) {
  const url = new URL(`${FINBIF_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8s timeout per request
  let r;
  try {
    r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
  const bbox     = url.searchParams.get("bbox")      || DEFAULT_BBOX;
  const refYears = parseYears(url.searchParams.get("ref_years")) || "2000/2010";
  const curYears = parseYears(url.searchParams.get("cur_years")) || "2020/2026";
  const coords   = bboxToFinBif(bbox);

  const results = {};

  await Promise.allSettled(
    Object.entries(INDICATOR_SPECIES).map(async ([id, name]) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const [ref, cur] = await Promise.all([
          finbif("/warehouse/query/unit/list",
            { taxonId: id, coordinates: coords, time: refYears, pageSize: 1, cache: "true" },
            token, ctrl.signal),
          finbif("/warehouse/query/unit/list",
            { taxonId: id, coordinates: coords, time: curYears, pageSize: 1, cache: "true" },
            token, ctrl.signal),
        ]);

        const refTotal = ref.total ?? 0;
        const curTotal = cur.total ?? 0;
        const ratio    = refTotal > 0 ? curTotal / refTotal : null;

        const trend =
          ratio === null ? "no_data" :
          ratio >= 1.2   ? "increasing" :
          ratio >= 0.8   ? "stable" :
          ratio >= 0.5   ? "declining" :
                           "strongly_declining";

        const obsGrowth = OBSERVER_GROWTH[curYears] || 1.8;
        const normRatio = ratio !== null ? ratio / obsGrowth : null;
        const normTrend =
          normRatio === null  ? "no_data" :
          normRatio >= 1.2    ? "increasing" :
          normRatio >= 0.8    ? "stable" :
          normRatio >= 0.5    ? "declining" :
                                "strongly_declining";

        results[id] = {
          name,
          ref_total: refTotal,
          cur_total: curTotal,
          ratio:      ratio     !== null ? Math.round(ratio     * 1000) / 1000 : null,
          norm_ratio: normRatio !== null ? Math.round(normRatio * 1000) / 1000 : null,
          trend,
          norm_trend: normTrend,
        };
      } catch(e) {
        results[id] = { name, error: e.message, ref_total: 0, cur_total: 0, ratio: null, trend: "no_data" };
      } finally {
        clearTimeout(timer);
      }
    })
  );

  const stressValues = Object.values(results)
    .filter(r => r.norm_ratio !== null)
    .map(r => {
      if (r.norm_ratio >= 1.2) return 0.1;
      if (r.norm_ratio >= 0.8) return 0.3;
      if (r.norm_ratio >= 0.5) return 0.6;
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


// ── Copernicus STAC ───────────────────────────────────────────────────────────

const COPERNICUS_ODATA = "https://catalogue.dataspace.copernicus.eu/odata/v1";
const COPERNICUS_STAC  = "https://catalogue.dataspace.copernicus.eu/stac/v1";

async function handleCopernicusNDVI(url) {
  const bbox  = url.searchParams.get("bbox") || DEFAULT_BBOX;
  const date  = url.searchParams.get("date") || "2024-07-01/2024-09-30";
  const cloud = parseFloat(url.searchParams.get("cloud") || "20");

  const [lng1, lat1, lng2, lat2] = bbox.split(",").map(Number);
  const [dateStart, dateEnd] = date.split("/");

  // Copernicus OData API — no auth required for catalogue search
  const filter = [
    `Collection/Name eq 'SENTINEL-2'`,
    `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${lng1} ${lat1},${lng2} ${lat1},${lng2} ${lat2},${lng1} ${lat2},${lng1} ${lat1}))')`,
    `ContentDate/Start gt ${dateStart}T00:00:00.000Z`,
    `ContentDate/Start lt ${dateEnd}T23:59:59.000Z`,
    `Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value le ${cloud})`,
    `Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A')`
  ].join(' and ');

  const odataUrl = `${COPERNICUS_ODATA}/Products?\$filter=${encodeURIComponent(filter)}&\$top=5&\$orderby=ContentDate/Start desc`;

  const r = await fetch(odataUrl, {
    headers: { "Accept": "application/json" }
  });

  if (!r.ok) throw new Error(`Copernicus OData ${r.status}`);
  const data = await r.json();

  const scenes = (data.value || []).map(p => ({
    id: p.Id,
    name: p.Name,
    date: p.ContentDate?.Start?.slice(0,10),
    cloud_pct: ((p.Attributes||[]).find(a => a.Name==='cloudCover' || a.Name==='Cloud cover')?.Value) ?? null,
    tile: p.Name?.match(/T\d+[A-Z]+/)?.[0] || null,
    size_mb: p.ContentLength ? Math.round(p.ContentLength/1048576) : null,
  }));

  return json({
    bbox,
    date_range: date,
    max_cloud_pct: cloud,
    scene_count: scenes.length,
    scenes,
    note: "Download full scene for B04+B08 NDVI calculation",
    bem_component: "D_f fragmentation",
    source: "Copernicus Data Space · OData · Sentinel-2 L2A"
  });
}

async function handleCopernicusCorine(url) {
  // GET /copernicus/corine?bbox=26.0,62.4,27.5,63.5&year=2018
  const bbox = url.searchParams.get("bbox") || DEFAULT_BBOX;
  const year = url.searchParams.get("year") || "2018";

  const [lng1, lat1, lng2, lat2] = bbox.split(",").map(Number);

  const query = {
    bbox: [lng1, lat1, lng2, lat2],
    collections: ["CORINE-LAND-COVER"],
    limit: 3,
    query: { "year": { "eq": parseInt(year) } }
  };

  const r = await fetch(`${COPERNICUS_STAC}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  });

  if (!r.ok) throw new Error(`Copernicus STAC ${r.status}: ${await r.text()}`);
  const data = await r.json();

  return json({
    bbox,
    year,
    features: data.features?.length || 0,
    items: (data.features || []).map(f => ({
      id: f.id,
      assets: Object.keys(f.assets || {}),
      download: f.assets?.data?.href
    })),
    bem_component: "D_f fragmentation baseline",
    note: "CORINE classes 311-313 = forest, 324 = transitional shrub (recent clearcut)",
    source: "Copernicus Land Service · CORINE Land Cover"
  });
}


// ── Element84 STAC + NDVI ────────────────────────────────────────────────────

const E84_STAC = "https://earth-search.aws.element84.com/v1";

async function handleNDVI(url) {
  const bbox  = url.searchParams.get("bbox") || DEFAULT_BBOX;
  const date  = url.searchParams.get("date") || "2023-07-01/2023-08-31";
  const cloud = parseFloat(url.searchParams.get("cloud") || "20");
  const download = url.searchParams.get("download") === "true";

  const [lng1, lat1, lng2, lat2] = bbox.split(",").map(Number);

  // 1. STAC search
  const query = {
    collections: ["sentinel-2-l2a"],
    bbox: [lng1, lat1, lng2, lat2],
    datetime: date,
    query: { "eo:cloud_cover": { lt: cloud } },
    limit: 3,
    sortby: [{ field: "datetime", direction: "desc" }]
  };

  const sr = await fetch(`${E84_STAC}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  });
  if (!sr.ok) throw new Error(`E84 STAC ${sr.status}`);
  const stac = await sr.json();
  const features = stac.features || [];

  if (features.length === 0) {
    return json({ error: "No scenes found", bbox, date, cloud_max: cloud });
  }

  // Best scene (lowest cloud cover)
  const best = features.sort((a, b) =>
    (a.properties?.["eo:cloud_cover"] || 99) - (b.properties?.["eo:cloud_cover"] || 99)
  )[0];

  const assets = best.assets || {};
  const b04url = assets.red?.href || assets.B04?.href;
  const b08url = assets.nir?.href || assets.B08?.href;

  const meta = {
    scene_id: best.id,
    date: best.properties?.datetime?.slice(0, 10),
    cloud_pct: best.properties?.["eo:cloud_cover"],
    b04_url: b04url,
    b08_url: b08url,
    all_scenes: features.length,
    note: "NDVI = (B08 - B04) / (B08 + B04)"
  };

  // If download=true, fetch a small COG window for NDVI estimation
  if (download && b04url && b08url) {
    // COG range request — first 16KB = header + overview
    const [r04, r08] = await Promise.all([
      fetch(b04url, { headers: { Range: "bytes=0-16383" } }),
      fetch(b08url, { headers: { Range: "bytes=0-16383" } })
    ]);
    meta.cog_b04_bytes = r04.headers.get("content-range");
    meta.cog_b08_bytes = r08.headers.get("content-range");
    meta.cog_status = `B04: ${r04.status} B08: ${r08.status}`;
    meta.cog_note = "Full NDVI requires rasterio + COG window read — run locally";
  }

  return json({ bbox, date_range: date, ...meta, source: "Element84 Earth Search · Sentinel-2 L2A" });
}


async function handleDebug(url, token) {
  const taxon = url.searchParams.get("taxon") || "MX.47169";
  const coords = bboxToFinBif("26.00,62.40,27.50,63.50");
  const log = [];

  log.push({ step: "start", taxon, coords, token_set: !!token });

  try {
    const r = await finbif("/warehouse/query/unit/list", {
      taxonId: taxon, coordinates: coords,
      time: "2000/2010", pageSize: 1, cache: "true",
    }, token);
    log.push({ step: "ref_ok", total: r.total });
  } catch(e) {
    log.push({ step: "ref_error", error: e.message });
  }

  return json({ debug: log });
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
        case "/finbif/debug":
          return await handleDebug(url, token);
        case "/finbif/species":
          return await handleSpecies(url, token);
        case "/finbif/taxon":
          return await handleTaxon(url, token);
        case "/copernicus/ndvi":
          return await handleCopernicusNDVI(url);
        case "/copernicus/corine":
          return await handleCopernicusCorine(url);
        case "/ndvi":
          return json({
            status: "disabled",
            reason: "Element84 STAC blocks Cloudflare Workers. Use locally: https://earth-search.aws.element84.com/v1",
            alternative: "Download CORINE GeoTIFF from EEA for D_f calculation",
            bem_component: "D_f (planned)"
          });
        default:
          return err(`Unknown route: ${path}`, 404);
      }
    } catch (e) {
      return err(e.message);
    }
  },
};
// ── This block is a documentation comment only — see handleCopernicus below ──

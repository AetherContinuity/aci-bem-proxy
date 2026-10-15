// Ajo: node test/test.mjs  (FinBIF-vastaukset mockattu, luvut mitattu 2026-10-15)
import worker from "../src/index.js";
const TOTALS = {
  "MX.37580": { "2000/2010": 87200, "2020/2026": 86091 },
  "MX.47169": { "2000/2010": 12,   "2020/2026": 32 },
  "MX.73566": { "2000/2010": 1222, "2020/2026": 580 },
  "MX.27649": { "2000/2010": 181,  "2020/2026": 303 },
  "MX.26928": { "2000/2010": 75,   "2020/2026": 333 },
  "MX.26415": { "2000/2010": 82,   "2020/2026": 128 },
  "MX.26435": { "2000/2010": 8659, "2020/2026": 6328 },
  "MX.26366": { "2000/2010": 196,  "2020/2026": 751 },
};
let failAves = false;
globalThis.fetch = async (u) => {
  const url = new URL(u);
  const t = url.searchParams.get("taxonId"), y = url.searchParams.get("time");
  if (failAves && t === "MX.37580") return new Response("boom", { status: 500 });
  return new Response(JSON.stringify({ total: TOTALS[t]?.[y] ?? 0 }), { status: 200 });
};
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("FAIL", m)); };
const call = async () => (await worker.fetch(new Request(
  "https://x/finbif/species?bbox=26.00,62.40,27.50,63.50&ref_years=2000-2010&cur_years=2020-2026"),
  { FINBIF_TOKEN: "t" }, {})).json();

let d = await call();
ok(Object.keys(d.species).length === 7, "7 lajia");
ok(d.effort.ratio === 0.987, "effort ratio " + d.effort.ratio);
const pk = d.species["MX.73566"];
ok(Math.abs(pk.norm_ratio - 0.482) < 0.002, "palokarki " + pk.norm_ratio);
ok(Math.abs(d.species["MX.26435"].norm_ratio - 0.741) < 0.002, "telkka " + d.species["MX.26435"].norm_ratio);
ok(d.D_s === 0.286, "D_s " + d.D_s);
ok(d.D_s_validated === false && d.huomiot.length >= 3, "validointilippu");
ok(Object.values(d.species).every(s => s.ref_total > 0), "kaikilla lajeilla viitehavaintoja (tunnisteet oikein)");

failAves = true;
d = await call();
ok(d.D_s === null, "D_s null kun Aves puuttuu: " + d.D_s);
ok(d.effort.error, "effort.error raportoitu");
console.log(`${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);

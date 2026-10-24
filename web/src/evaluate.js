// node web/src/evaluate.js [storms]   Both planners, the same storms, side by side.
//   committed  each drone flies the whole flight it took off with
//   replan     drones in the air re-plan whenever the probability map changes
// The scenarios show one reaction each. The sampled storms are the fair test: drawn from our
// own prior, so a report is true only as often as its confidence says.

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULTS, simulate } from "./engine.js";
import { SCENARIOS, sampleStorm } from "./scenarios.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url)));
const spans = read("spans.geojson").features.map((f) => ({ ...f.properties, lonlat: f.geometry.coordinates }));
const wind = read("wind.json");
const END = DEFAULTS.startMin + DEFAULTS.hoursAhead * 60 + DEFAULTS.flightMin;

function score(events, truth) {
  const real = new Set(truth.faults.map((f) => f.span));
  const crews = events.filter((e) => e.kind === "decision" && e.action === "dispatch");
  const hits = crews.filter((e) => real.has(e.span));
  const hitAt = new Map(hits.map((e) => [e.span, e.t]));
  // a fault never found costs the whole window, so missing it is worse than finding it late
  const minutes = [...real].map((span) => (hitAt.get(span) ?? END) - DEFAULTS.startMin);
  const back = events.find((e) => e.kind === "switch" && e.line === "LINE_024");
  return {
    faults: real.size,
    found: hitAt.size,
    firstWave: hits.filter((e) => e.t <= DEFAULTS.startMin + 60).length,
    wrong: crews.length - hits.length,
    minutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
    line024: back ? `${back.outcome} ${Math.round(back.t - DEFAULTS.startMin)} min` : "off",
    flights: events.filter((e) => e.kind === "flight" && !e.retask).length,
    retasks: events.filter((e) => e.kind === "flight" && e.retask).length,
    stranded: events.filter((e) => e.kind === "stranded").length,
  };
}

const run = (truth, replan) => score(simulate({ spans, wind }, { ...DEFAULTS, replan }, truth).events, truth);
const pad = (v, n) => String(v ?? "").padEnd(n);

console.log("Scenarios: faults found, minutes from T+2:00 to the crew (a miss counts as the whole window), LINE_024");
console.log(pad("", 24), pad("committed", 30), "replan");
const scenarioRows = SCENARIOS.map((s) => {
  const a = run(s.truth, false);
  const b = run(s.truth, true);
  const cell = (r) => `${r.found}/${r.faults} found${r.faults ? `, ${Math.round(r.minutes)} min` : ""}, 024 ${r.line024}`;
  console.log(pad(s.tab, 24), pad(cell(a), 30), cell(b));
  return { id: s.id, name: s.name, committed: a, replan: b };
});

const storms = Number(process.argv[2] ?? 200);
const totals = { committed: [], replan: [] };
for (let seed = 1; seed <= storms; seed++) {
  const truth = sampleStorm(spans, wind, DEFAULTS, seed);
  totals.committed.push(run(truth, false));
  totals.replan.push(run(truth, true));
}
const sum = (list, key) => list.reduce((a, r) => a + (r[key] ?? 0), 0);
const summary = Object.fromEntries(Object.entries(totals).map(([name, list]) => {
  const withFaults = list.filter((r) => r.faults);
  return [name, {
    storms: list.length,
    faults: sum(list, "faults"),
    found: sum(list, "found"),
    firstWave: sum(list, "firstWave"),
    wrong: sum(list, "wrong"),
    meanMinutes: sum(withFaults, "minutes") / withFaults.length,
    stranded: sum(list, "stranded"),
    flights: sum(list, "flights") / list.length,
    retasks: sum(list, "retasks") / list.length,
    line024Back: list.filter((r) => r.line024.startsWith("live")).length,
  }];
}));
const better = totals.replan.filter((r, i) => r.faults && r.minutes < totals.committed[i].minutes - 0.5).length;
const worse = totals.replan.filter((r, i) => r.faults && r.minutes > totals.committed[i].minutes + 0.5).length;

console.log(`\n${storms} storms sampled from the prior`);
for (const [name, s] of Object.entries(summary)) {
  console.log(`${pad(name, 10)} found ${s.found}/${s.faults} (${(100 * s.found / s.faults).toFixed(0)} %), in the first hour ${s.firstWave},`
    + ` mean ${s.meanMinutes.toFixed(0)} min to a crew, wrong crews ${s.wrong}, stranded ${s.stranded},`
    + ` ${s.flights.toFixed(1)} take-offs and ${s.retasks.toFixed(1)} re-plans a storm, LINE_024 back in ${s.line024Back}`);
}
console.log(`re-planning was faster in ${better} storms, slower in ${worse}, the same in the rest`);
writeFileSync(new URL("../public/data/evaluation.json", import.meta.url),
  JSON.stringify({ scenarios: scenarioRows, storms: summary, better, worse }, null, 1));

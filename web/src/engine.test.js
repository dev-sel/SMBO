// node --test web/src/engine.test.js   The planner on the real package, against the fictional truth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULTS, TRUTH, fallDirections, simulate, standby } from "./engine.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url)));
const spans = read("spans.geojson").features.map((f) => ({ ...f.properties, lonlat: f.geometry.coordinates }));
const wind = read("wind.json");
const run = (truth = TRUTH, params = DEFAULTS) => simulate({ spans, wind }, params, truth);
const decisions = (events, action) => events.filter((e) => e.kind === "decision" && e.action === action);

test("trees fall downwind", () => {
  const fall = fallDirections([[225, 1]], 25);
  const peak = fall.indexOf(Math.max(...fall));
  assert.equal(peak * 10 + 5, 45);           // from 225, so falling towards 45
  assert.ok(fall[22] < 1e-4);                // practically nothing falls back into the wind
});

test("the walk-through finds both faults and gives LINE_024 back", () => {
  const { events } = run();
  assert.deepEqual(decisions(events, "dispatch").map((e) => e.span), ["LINE_026/3", "LINE_036/14"]);
  assert.equal(decisions(events, "reenergize")[0]?.line, "LINE_024");
  assert.equal(events.find((e) => e.kind === "switch")?.outcome, "live");
});

test("flights keep the reserve and wait for the charge", () => {
  const { events } = run();
  const ready = {};
  for (const e of events) {
    if (e.kind === "flight") {
      assert.ok(e.arrive - e.depart <= DEFAULTS.flightMin - DEFAULTS.reserveMin + 1e-9, `${e.pkg} flew ${e.arrive - e.depart} min`);
      assert.ok((ready[e.pkg] ?? DEFAULTS.startMin) <= e.depart, `${e.pkg} left before its charge`);
    }
    if (e.kind === "land") ready[e.pkg] = e.readyAt;
    if (e.kind === "switch") for (const k of e.witnesses) ready[k] = e.t + DEFAULTS.chargeMin;
    assert.notEqual(e.kind, "stranded");
  }
});

test("no tree on LINE_026: no crew there, and the line only comes back once it's searched", () => {
  const truth = { ...TRUTH, faults: TRUTH.faults.map((f) => (f.id === "tree" ? { ...f, on: false } : f)) };
  const { events } = run(truth);
  assert.ok(!decisions(events, "dispatch").some((e) => e.line === "LINE_026"));
  const back = decisions(events, "reenergize").find((e) => e.line === "LINE_026");
  const looked = events.filter((e) => e.kind === "look" && e.span.startsWith("LINE_026/") && e.mode === "patrol");
  assert.ok(looked.length > 0, "a locked out line gets searched");
  if (back) assert.ok(looked.every((e) => e.t <= back.t), "never switched on before it's searched");
});

test("a fault left on LINE_024 trips the test energization", () => {
  const truth = { ...TRUTH, faults: [...TRUTH.faults, { id: "hidden", span: "LINE_024/70", kind: "tree", on: true }] };
  const { events } = run(truth);
  const switched = events.find((e) => e.kind === "switch");
  if (switched) assert.equal(switched.outcome, "tripped");
});

test("PAM finds the best five substations, checked against all 3,003 choices", () => {
  const placed = standby(spans, wind, DEFAULTS);
  const n = spans.length;
  const mid = spans.map((s) => [(s.xy[0][0] + s.xy[1][0]) / 2, (s.xy[0][1] + s.xy[1][1]) / 2]);
  const cost = (set) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += placed.weight[i] * Math.min(...set.map((c) => Math.hypot(mid[i][0] - mid[c][0], mid[i][1] - mid[c][1])));
    return total / (DEFAULTS.speedMs * 60);
  };
  let best = Infinity;
  const pick = (from, set) => {
    if (set.length === 5) return void (best = Math.min(best, cost(set)));
    for (let k = from; k < placed.sites.length; k++) pick(k + 1, [...set, placed.sites[k]]);
  };
  pick(0, []);
  assert.equal(placed.sites.length, 15);
  assert.ok(Math.abs(placed.cost - best) < 1e-6, `PAM ${placed.cost}, best ${best}`);
});

test("re-planning in the air reaches the joint in the first wave, committing waits for the recharge", () => {
  const crewAt = (replan) => decisions(run(TRUTH, { ...DEFAULTS, replan }).events, "dispatch").find((e) => e.span === "LINE_036/14")?.t;
  assert.ok(crewAt(true) < DEFAULTS.startMin + 60, `re-planning: ${crewAt(true)}`);
  assert.ok(crewAt(false) > DEFAULTS.startMin + DEFAULTS.chargeMin, `committed: ${crewAt(false)}`);
});

// The fictional truths the planner plays against, one tab each. None of this is in the
// organisers' package: it's how we show, and measure, what the plan does when the reports are
// right, wrong or incomplete.

import { KINDS, prior } from "./engine.js";

const fault = (span, kind) => ({ id: `${span}|${kind}`, span, kind, on: true });

// One tab per report, played as if it were the only one that came in, plus the walk-through
// and two that test the edges with all six. report: the report this tab plays. name: what's really out there, which the planner never
// sees. shows: what to watch for, as a sentence.
export const SCENARIOS = [
  { id: "walkthrough", tab: "Walk-through",
    name: "A spruce lies on LINE_026 span 3 and tripped the line, and a cracked joint is heating up on LINE_036 span 14.",
    shows: "Watch for a finding, an unclear reading, and a switched-off line given back.",
    truth: { faults: [fault("LINE_026/3", "tree"), fault("LINE_036/14", "damage")], deadLines: { LINE_024: true, LINE_026: true }, call: "generator" } },
  { id: "r02", tab: "R02 Fallen branch", report: "SYN_REPORT_02",
    name: "The caller was right: a spruce leans on LINE_026 span 3. The line stayed live.",
    shows: "Watch the drones search the trees under the report, and the crew go once one is seen.",
    truth: { faults: [fault("LINE_026/3", "tree")], deadLines: {}, reports: ["SYN_REPORT_02"] } },
  { id: "r03", tab: "R03 Protection trip", report: "SYN_REPORT_03",
    name: "The line switched off as a precaution really has a tree on it, on span 45.",
    shows: "Watch LINE_024 stay off while a crew goes instead.",
    truth: { faults: [fault("LINE_024/45", "tree")], deadLines: { LINE_024: true }, reports: ["SYN_REPORT_03"] } },
  { id: "r04", tab: "R04 Orange flash", report: "SYN_REPORT_04",
    name: "The flash was a damaged wire on LINE_037 span 13. The site's log shows no generator test.",
    shows: "Watch the phone call find nothing in the log, which makes the flash worth a flight.",
    truth: { faults: [fault("LINE_037/13", "damage")], deadLines: {}, call: "nothing", reports: ["SYN_REPORT_04"] } },
  { id: "r05", tab: "R05 Ticking and warmth", report: "SYN_REPORT_05",
    name: "A cracked joint is heating up on LINE_036 span 14. Nothing else is broken.",
    shows: "Watch a vague report over 24 km of line get searched, and an unclear reading confirmed.",
    truth: { faults: [fault("LINE_036/14", "damage")], deadLines: {}, reports: ["SYN_REPORT_05"] } },
  { id: "r06", tab: "R06 Swinging span", report: "SYN_REPORT_06",
    name: "The span that swung, LINE_054 span 26, really hangs too low.",
    shows: "Watch the weakest report turn out right.",
    truth: { faults: [fault("LINE_054/26", "clearance")], deadLines: {}, reports: ["SYN_REPORT_06"] } },
  { id: "nothing", tab: "False alarm",
    name: "Nothing is broken. Every report was a false alarm.",
    shows: "Watch how fast the reports close and LINE_024 comes back on.",
    truth: { faults: [], deadLines: { LINE_024: true }, call: "generator" } },
  { id: "unreported", tab: "Unreported tree",
    name: "A tree nobody reported lies on LINE_064 span 16, where this storm pushed trees away from the wire.",
    shows: "Watch what the plan misses: a fault away from every report and every likely tree.",
    truth: { faults: [fault("LINE_064/16", "tree")], deadLines: { LINE_024: true }, call: "generator" } },
];

// mulberry32, a seeded generator, so a sampled storm is the same storm on every machine
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A storm drawn from our own prior: every report is true only as often as its confidence says,
// and faults fall where the trees and the background put them. A tree or damage inside the
// protection trip's area (R03) locks its line out. R04's site log shows a generator test unless
// R04 really holds a fault.
export function sampleStorm(spans, wind, params, seed) {
  const draw = random(seed);
  const { lam } = prior(spans, wind, params);
  const faults = [];
  const deadLines = { LINE_024: true };
  let call = "generator";
  spans.forEach((s, i) => {
    KINDS.forEach((kind, t) => {
      const expected = Object.values(lam).reduce((a, l) => a + l[i * 3 + t], 0);
      if (draw() >= 1 - Math.exp(-expected)) return;
      faults.push(fault(s.id, kind));
      if (kind !== "clearance" && s.reports.includes("SYN_REPORT_03")) deadLines[s.line] = true;
      if (kind !== "tree" && s.reports.includes("SYN_REPORT_04")) call = "nothing";
    });
  });
  return { faults, deadLines, call };
}

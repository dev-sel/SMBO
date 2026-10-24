// Over the map: which chapter of the story this is, and at the end, what the four hours came to.

import { clock } from "../engine.js";
import { airborne } from "../playback.js";

const CHAPTERS = [
  ["The storm passes", "Real gusts from the Augsburg weather station. The drones wait it out on substations."],
  ["Reports come in", "Vague and maybe wrong. They say where to look first, not what is broken."],
  ["Where we look first", "Every span ranked by tall trees, the storm's wind and the reports."],
  ["Search, find, adapt", "Each reading updates every span. Drones in the air change plan."],
  ["Charging, ready for the next call", "Three hours on a live line, spread out over what's left."],
];

export function chapter(e, flights, t) {
  if (e.kind === "end") return null;
  if (t < 12) return 0;
  if (t < 120) return 1;
  if (t <= 125) return 2;
  return airborne(flights, t).length ? 3 : 4;
}

export function Chapter({ index }) {
  if (index === null) return null;
  const [title, line] = CHAPTERS[index];
  return (
    <div className="chapter" key={index}>
      <span className="chapter-n num">{index + 1}</span>
      <div><b>{title}</b><span>{line}</span></div>
    </div>
  );
}

// km between two lon/lat points, flat earth is plenty at this scale
const km = ([x0, y0], [x1, y1]) => Math.hypot((x1 - x0) * 111.32 * Math.cos((y0 * Math.PI) / 180), (y1 - y0) * 110.57);

export function Summary({ run, truth, onReplay, onNext, next }) {
  const ev = run.events;
  const real = new Set(truth.faults.map((f) => f.span));
  const crews = ev.filter((e) => e.kind === "decision" && e.action === "dispatch");
  const right = crews.filter((e) => real.has(e.span));
  const back = ev.filter((e) => e.kind === "switch" && e.outcome === "live").map((e) => e.line);
  const still = Object.keys(ev.at(-1).state.lines).filter((l) => ev.at(-1).state.lines[l] === "dead");
  const reports = Object.keys(ev.at(-1).state.reports);
  const closed = ev.filter((e) => e.action === "standdown").length;
  const flights = ev.filter((e) => e.kind === "flight" && !e.retask).length;
  const replans = ev.filter((e) => e.kind === "flight" && e.retask && !e.sameRun).length;
  const at = ev.at(-1).state.packages.map((k) => k.lonlat);
  let apart = Infinity;
  for (let a = 0; a < at.length; a++) for (let b = a + 1; b < at.length; b++) apart = Math.min(apart, km(at[a], at[b]));

  const rows = [
    [real.size ? `${right.length} of ${real.size}` : "none to find", "faults found", "against the made-up truth"],
    [right.length ? clock(right[0].t) : "none", "first crew sent", right.length ? `${Math.round(right[0].t - 120)} min after the drones could fly` : ""],
    [String(crews.length - right.length), "crews sent to nothing", ""],
    [back.length ? back.join(", ") : still.length ? "still off" : "none off", "back on", still.length ? `off at the end: ${still.join(", ")}` : ""],
    [`${closed} of ${reports.length}`, "reports closed", ""],
    [`${flights} and ${replans}`, "take-offs and re-plans in the air", ""],
    [`${apart.toFixed(1)} km`, "between the closest two drones at the end", "spread out for the next call"],
  ];

  return (
    <div className="summary-card" role="dialog" aria-label="What the four hours came to">
      <p className="eyebrow">Four hours later</p>
      <div className="summary-grid">
        {rows.map(([big, label, sub]) => (
          <div key={label}><b className="num">{big}</b><span>{label}</span>{sub && <span className="sub">{sub}</span>}</div>
        ))}
      </div>
      <div className="actions">
        <button className="play" onClick={onReplay}>Watch again</button>
        {next && <button className="quiet" onClick={onNext}>Next: {next.tab}</button>}
      </div>
    </div>
  );
}

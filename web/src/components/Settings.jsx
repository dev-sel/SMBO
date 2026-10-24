// The numbers we chose rather than measured. Changing one replays the four hours. The rest are
// fixed for every run and listed underneath with the reason for each.

import { useState } from "react";
import { DEFAULTS } from "../engine.js";
import { REPORT, pct } from "../words.js";

// re-plans when you let go, not on every pixel
function Slider({ label, why, value, min, max, step, show, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { if (draft !== null) { onCommit(draft); setDraft(null); } };
  const shown = draft ?? value;
  return (
    <label className="slider">
      <span className="slider-head"><span>{label}</span><span className="num">{show(shown)}</span></span>
      <input type="range" min={min} max={max} step={step} value={shown}
             onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      {why && <span className="sub">{why}</span>}
    </label>
  );
}

const FIXED = [
  ["30 min flight, 3 h charge, only on a live line", "the brief"],
  ["16 m/s, full batteries at T+2:00", "ours. The last report came in at T+1:51"],
  ["No flying in gusts over 10 m/s", "the NOMAD's 36 km/h. Gusts dropped under it 50 minutes after the peak"],
  ["Lowest wire 12 m up mid span, 20 m at a tower", "usual for 110 kV. Tower drawings would replace it"],
  ["A camera sees a tree on the wire 9 times in 10, thermal a hot joint 6 in 10", "assumed. On a dead line thermal sees less: no current, no heat"],
];

export default function Settings({ params, setParams, onClose }) {
  const set = (key) => (value) => setParams({ ...params, [key]: value });
  const believe = (rid) => (value) => setParams({ ...params, confidence: { ...params.confidence, [rid]: value } });
  return (
    <div className="drawer" role="dialog" aria-label="Settings">
      <div className="drawer-head">
        <h2>Settings</h2>
        <button className="quiet small" onClick={onClose}>Close</button>
      </div>
      <p>Numbers we chose ourselves. Change one and the four hours replay.</p>

      <h3>How much we believe each report</h3>
      {Object.keys(REPORT).map((rid) => (
        <Slider key={rid} label={REPORT[rid]} value={params.confidence[rid]} min={0} max={1} step={0.05} show={pct} onCommit={believe(rid)} />
      ))}

      <h3>Trees</h3>
      <Slider label="Chance a tree that could reach a wire falls" value={params.treeFallChance} min={0.005} max={0.1} step={0.005} show={pct}
              onCommit={set("treeFallChance")} why="The survey gives every tree's height, not whether it falls. 2 % puts about one tree on a wire across the network." />

      <h3>When we act</h3>
      <Slider label="Send a crew at" value={params.dispatchAt} min={0.5} max={0.99} step={0.01} show={pct} onCommit={set("dispatchAt")} />
      <Slider label="Switch a line back on below" value={params.reenergizeBelow} min={0.05} max={0.5} step={0.05} show={pct} onCommit={set("reenergizeBelow")}
              why="If it trips, the protection cuts it within a fraction of a second." />
      <Slider label="A line back on is worth" value={params.restoreValue} min={0} max={3} step={0.25} show={(v) => `${v} ${v === 1 ? "fault" : "faults"} found`}
              onCommit={set("restoreValue")} why="A flight that clears a switched-off line gets this much credit for the power it brings back." />
      <Slider label="Close a report below" value={params.standDownBelow} min={0.01} max={0.2} step={0.01} show={pct} onCommit={set("standDownBelow")} />

      <h3>Battery</h3>
      <Slider label="Kept spare on every flight" value={params.reserveMin} min={0} max={12} step={1} show={(v) => `${v} min`} onCommit={set("reserveMin")}
              why="To reach another line if the one it lands on won't charge." />
      <button className="quiet small" onClick={() => setParams(DEFAULTS)}>Put them all back</button>

      <h3>The same in every run</h3>
      <dl className="fixed">
        {FIXED.map(([what, why]) => <div key={what}><dt>{what}</dt><dd className="sub">{why}</dd></div>)}
      </dl>
    </div>
  );
}

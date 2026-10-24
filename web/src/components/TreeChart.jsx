// The span from above, tower to tower, with every surveyed tree within 50 m where it stands.
// The across axis is to scale, the along axis is squeezed to fit, so distances to the wire
// read true and long spans still fit the panel.

import { pct } from "../words.js";

const W = 340, H = 200, PAD = 8, TOP = 20, BOTTOM = 18, REACH = 50, STRIP = 15;
const SIDES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const side = (bearing) => SIDES[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
const rad = (deg) => (deg * Math.PI) / 180;

// the share of this tree's falls that land on the wire, given where the storm threw trees
const windShare = (mask, fall) => {
  let share = 0;
  for (let k = 0, m = parseInt(mask, 16); m > 0; k++, m = Math.floor(m / 2)) if (m % 2) share += fall[k];
  return share;
};

export default function TreeChart({ span, trees, fall, from, treeFallChance }) {
  const length = span.length_m;
  const [[ax, ay], [bx, by]] = span.xy;
  const heading = (Math.atan2(bx - ax, by - ay) * 180) / Math.PI;
  const kx = (W - 2 * PAD) / (length + 2 * REACH);
  const ky = (H - TOP - BOTTOM) / (2 * REACH);
  const x = (u) => PAD + (u + REACH) * kx;
  const y = (v) => TOP + (REACH - v) * ky;
  const r = (h, reach) => (reach ? 2 + h / 9 : 1 + h / 18);

  const scored = trees.map(([u, v, h, m]) => ({ u, v, h, reach: m !== "0", share: m === "0" ? 0 : windShare(m, fall) }));
  const reaching = scored.filter((t) => t.reach);
  // under 2 % of its falls land on the wire: tall enough, but the storm pushed it the other way
  const towards = reaching.filter((t) => t.share >= 0.02);
  const landing = reaching.reduce((a, t) => a + t.share, 0);
  const chance = 1 - Math.exp(-treeFallChance * landing);

  // which side the danger is on, by the trees the storm pushed towards the wire
  const left = towards.filter((t) => t.v > 0).reduce((a, t) => a + t.share, 0);
  const right = landing - left;
  const leftSide = side(heading - 90), rightSide = side(heading + 90);
  let story;
  if (!trees.length) story = "The survey shows no trees within 50 m of this span.";
  else if (!reaching.length) story = `None of them is tall enough to reach the wire. The tallest is ${Math.max(...scored.map((t) => t.h)).toFixed(0)} m.`;
  else if (!towards.length) story = `${reaching.length === 1 ? "One could" : `${reaching.length} could`} reach the wire, but this storm pushed ${reaching.length === 1 ? "it" : "them"} away from it.`;
  else if (Math.min(left, right) > 0.35 * landing) story = `Trees on both sides could land on it, the ${leftSide} and the ${rightSide}.`;
  else story = `The danger is on the ${left > right ? leftSide : rightSide} side, where the storm pushed trees towards the wire.`;

  // the storm's push, drawn in the chart's frame: along the span is right, its left side is up
  const push = rad(from + 180 - heading);
  const [cx, cy] = [W - PAD - 22, TOP + 16];

  return (
    <figure className="tree-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label={`${trees.length} trees within 50 m of the span, ${reaching.length} tall enough to reach the wire`}>
        <rect x={PAD} y={TOP} width={W - 2 * PAD} height={H - TOP - BOTTOM} className="plot" />
        <rect x={PAD} y={y(STRIP)} width={W - 2 * PAD} height={y(-STRIP) - y(STRIP)} className="strip" />
        <text x={PAD + 4} y={y(STRIP) + 10} className="note">no survey data within 15 m</text>
        <text x={PAD} y={TOP - 6} className="note">{leftSide} side</text>
        <text x={PAD} y={H - 4} className="note">{rightSide} side</text>
        <text x={W - PAD} y={H - 4} textAnchor="end" className="note">{Math.round(length)} m tower to tower</text>

        <line x1={x(0)} x2={x(length)} y1={y(0)} y2={y(0)} className="wire" />
        {[0, length].map((u) => <rect key={u} x={x(u) - 3.5} y={y(0) - 3.5} width="7" height="7" className="tower" />)}

        {scored.filter((t) => !t.reach).map((t, i) => <circle key={`g${i}`} cx={x(t.u)} cy={y(t.v)} r={r(t.h, false)} className="tree short" />)}
        {reaching.map((t, i) => (
          <circle key={`t${i}`} cx={x(t.u)} cy={y(t.v)} r={r(t.h, true)} className={`tree ${t.share >= 0.02 ? "towards" : "away"}`}>
            <title>{`${t.h.toFixed(0)} m tall, ${Math.abs(t.v).toFixed(0)} m to the ${t.v > 0 ? leftSide : rightSide}`}</title>
          </circle>
        ))}

        <g transform={`translate(${cx} ${cy})`}>
          <line x1={-11 * Math.cos(push)} y1={-11 * Math.sin(push)} x2={11 * Math.cos(push)} y2={11 * Math.sin(push)}
                className="wind" markerEnd="url(#tree-chart-head)" />
          <text y="26" textAnchor="middle" className="note">storm</text>
        </g>
        <defs>
          <marker id="tree-chart-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text)" />
          </marker>
        </defs>
      </svg>

      <div className="tree-legend sub">
        <span><i className="dot-key towards" />can reach the wire, and the storm pushed it this way</span>
        <span><i className="dot-key away" />tall enough, pushed away</span>
        <span><i className="dot-key short" />too short to reach. Size is height.</span>
      </div>

      {reaching.length > 0 && (
        <div className="figures">
          <div><b className="num">{reaching.length}</b><span>of {trees.length} trees could reach it</span></div>
          <div><b className="num">{landing.toFixed(1)}</b><span>would land on it if all fell</span></div>
          <div><b className="num">{pct(chance)}</b><span>chance of a tree on it, trees alone</span></div>
        </div>
      )}
      <p>{story}</p>
    </figure>
  );
}

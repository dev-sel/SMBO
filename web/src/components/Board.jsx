// The right panel: where things stand at the step the timeline is on. A one-line summary, then
// the packages, what we've decided, lines that are off, where to look next, and each report.

import { memo } from "react";
import { KINDS, clock } from "../engine.js";
import { FAULT, REPORT, describe, pct, spanName } from "../words.js";
import TreeChart from "./TreeChart.jsx";
import Profile from "./Profile.jsx";

const lineLeft = (data, state, line) =>
  1 - data.list.reduce((a, s, i) => (s.line === line ? a * (1 - state.p[i]) : a), 1);

function packageRow(k, data, past, now) {
  const here = spanName(data.list[k.span].id);
  if (k.stranded) return ["urgent", "Stuck, no live line within reach", here];
  if (k.flying) {
    const f = past.findLast((e) => e.kind === "flight" && e.pkg === k.id);
    return ["move", `In the air, lands at ${clock(f.arrive)}`, `heading for ${spanName(f.landing)}`];
  }
  if (k.witness) return ["witness", `Waiting on ${k.witness} for it to come back on`, here];
  if (k.readyAt > now) return ["charging", k.flights ? `Charging, ready at ${clock(k.readyAt)}` : `Waiting out the storm, flies at ${clock(k.readyAt)}`, here];
  return ["ready", k.holding ? "Ready, waiting for a reason to fly" : "Ready", here];
}

// why a report was closed, in words
function closedBecause(e, past, data) {
  const dispatch = past.find((d) => d.kind === "decision" && d.action === "dispatch" && d.t <= e.t
    && data.list[data.index.get(d.span)].reports.includes(e.report));
  if (dispatch) return `explained by the ${FAULT[dispatch.fault]} on ${spanName(dispatch.span)}`;
  if (past.some((c) => c.kind === "call" && c.report === e.report)) return "the phone call cleared it";
  return "we looked and found nothing";
}

// memo: the clock ticks every frame while playing, this only changes at a step
export default memo(function Board({ data, run, event, picked, onPick, params }) {
  const { state } = event;
  const step = run.events.indexOf(event);
  const past = run.events.slice(0, step + 1);
  if (picked) return <SpanDetail data={data} run={run} event={event} id={picked} onClose={() => onPick(null)} params={params} />;

  const decisions = past.filter((e) => e.kind === "decision");
  const crews = decisions.filter((e) => e.action === "dispatch").length;
  const closed = decisions.filter((e) => e.action === "standdown");
  const dead = Object.entries(state.lines).filter(([, s]) => s === "dead").map(([line]) => line);
  const next = data.list.map((s, i) => [s, i, state.p[i]])
    .filter(([, i]) => !state.dispatched.includes(i))
    .sort((a, b) => b[2] - a[2]).slice(0, 5);

  return (
    <aside className="board" aria-label="Where things stand">
      <p className="summary">
        {crews ? `${crews} ${crews === 1 ? "crew" : "crews"} sent` : "No crews sent yet"}
        {" · "}{dead.length ? `${dead.length} ${dead.length === 1 ? "line" : "lines"} off` : "every line back on"}
        {" · "}{Object.keys(state.reports).length - closed.length} of {Object.keys(state.reports).length} {Object.keys(state.reports).length === 1 ? "report" : "reports"} still open
      </p>

      <section>
        <h2>The drones</h2>
        <table className="rows fleet">
          <tbody>
            {state.packages.map((k) => {
              const [cls, what, where] = packageRow(k, data, past, event.t);
              return (
                <tr key={k.id}>
                  <th className="mono">{k.id}</th>
                  <td><span className={`chip ${cls}`}><span className="dot" aria-hidden="true" />{what}</span>
                    <div className="sub">{where}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>What we've decided</h2>
        {decisions.length === 0
          ? <p className="sub">Nothing yet. We send a crew once we're {pct(params.dispatchAt)} sure of a fault.</p>
          : <ol className="decisions">
              {decisions.map((e, i) => (
                <li key={i}>
                  <span className="t num">{clock(e.t)}</span> {describe(e, data, params).title}
                  {e.span && <button className="link" onClick={() => onPick(e.span)}>see why</button>}
                </li>
              ))}
            </ol>}
      </section>

      {dead.length > 0 && (
        <section>
          <h2>Lines that are off</h2>
          {dead.map((line) => {
            const left = lineLeft(data, state, line);
            const blocked = data.list.some((s, i) => s.line === line && state.dispatched.includes(i));
            return (
              <div className="meter" key={line}>
                <div className="meter-head"><span className="mono">{line}</span>
                  <span>{blocked ? "fault found, crew on the way" : `${pct(left)} chance of a fault`}</span></div>
                {!blocked && <Bar value={left} mark={params.reenergizeBelow} />}
                {!blocked && <div className="sub">We switch it back on once this drops below the line at {pct(params.reenergizeBelow)}.</div>}
              </div>
            );
          })}
        </section>
      )}

      <section>
        <h2>Where we'd look next</h2>
        <ol className="next">
          {next.map(([s, i, p]) => (
            <li key={s.id}>
              <button className="link" onClick={() => onPick(s.id)}>{spanName(s.id)}</button>
              <span className="num">{pct(p)}</span>
              <span className="sub">{[
                s.trees_reaching ? `${s.trees_reaching} trees could hit it` : null,
                s.reports.length ? `in ${s.reports.map((r) => r.replace("SYN_REPORT_", "R")).join(" and ")}` : null,
                state.lines[s.line] === "dead" ? "line is off" : null,
              ].filter(Boolean).join(", ") || "no particular reason, just the storm"}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>{Object.keys(state.reports).length === 1 ? "The report" : "The reports"}</h2>
        {Object.keys(state.reports).map((rid) => {
          const down = closed.find((e) => e.report === rid);
          return (
            <div className="meter" key={rid}>
              <div className="meter-head"><span>{REPORT[rid]}</span>
                <span className={down ? "done-word" : ""}>{down ? `closed at ${clock(down.t)}` : "open"}</span></div>
              <div className="sub">{down ? closedBecause(down, past, data)
                : `${pct(state.reports[rid])} chance it points to a fault we haven't found`}</div>
            </div>
          );
        })}
      </section>
    </aside>
  );
});

function Bar({ value, mark }) {
  const scale = Math.max(1, mark ?? 0);
  return (
    <div className="bar" role="img" aria-label={pct(value)}>
      <span style={{ width: `${Math.min(100, (100 * value) / scale)}%` }} />
      {mark !== undefined && <i style={{ left: `${(100 * mark) / scale}%` }} />}
    </div>
  );
}

const LINE_STATE = { dead: "off", live: "live", assumed: "probably live, nobody has checked yet", doubt: "in question, it's inside the protection trip area" };

function SpanDetail({ data, run, event, id, onClose, params }) {
  const i = data.index.get(id);
  const s = data.list[i];
  const { state } = event;
  const step = run.events.indexOf(event);
  const history = run.events.slice(0, step + 1).filter((e) => e.span === id || (e.line === s.line && e.kind === "line"));
  return (
    <aside className="board" aria-label={spanName(id)}>
      <div className="detail-head">
        <h2>{spanName(id)}</h2>
        <button className="quiet small" onClick={onClose}>Back to the overview</button>
      </div>
      <p className="sub">A {s.kv} kV span, {Math.round(s.length_m)} m long, number {s.k} of {s.n} on {s.line}. The line is {LINE_STATE[state.lines[s.line]]}.</p>

      <section>
        <h3>How likely is a fault here?</h3>
        <table className="rows">
          <tbody>
            {KINDS.map((kind, t) => (
              <tr key={kind}><th>{FAULT[kind]}</th><td className="num">{pct(state.byKind[i * 3 + t])}</td>
                <td className="sub num">was {pct(run.events[0].state.byKind[i * 3 + t])}</td></tr>
            ))}
          </tbody>
        </table>
        {state.dispatched.includes(i) && <p className="notice decision">A crew is on its way.</p>}
      </section>

      <section>
        <h3>Trees around it</h3>
        <TreeChart span={s} trees={data.nearby[id] ?? []} fall={run.prior.fall} from={run.prior.from}
                   treeFallChance={params.treeFallChance * (s.storm ? 1 : params.outsideStorm)} />
      </section>

      {data.spotcheck[id] && <SpotCheck check={data.spotcheck[id]} />}

      <section>
        <h3>Reports that cover it</h3>
        {s.reports.length ? <ul>{s.reports.map((r) => <li key={r}>{REPORT[r]}</li>)}</ul> : <p className="sub">None. Its risk comes from the storm alone.</p>}
      </section>

      <section>
        <h3>What's happened here</h3>
        {history.length
          ? <ol className="decisions">{history.map((e, k) => <li key={k}><span className="t num">{clock(e.t)}</span> {describe(e, data, params).title}</li>)}</ol>
          : <p className="sub">Nobody has looked at it yet.</p>}
      </section>
    </aside>
  );
}

const m2 = (v) => `${v.toLocaleString("en-GB")} m²`;

function SpotCheck({ check }) {
  return (
    <section>
      <h3>What the tree survey can't see</h3>
      <p>The survey has no trees within 15 m of the line, so we built our own height model for this span. It finds trees up to {check.strip_max_m} m
        in that strip, and {m2(check.strip_reach_m2)} of canopy there could hit the wire. Further out there's another {m2(check.beyond_reach_m2)}.</p>
      <Profile profile={check.profile} />
      <p className="sub">The mapped line can be a few metres off the real one, so treat the strip as rough. A drone with LiDAR would settle it on the first pass.</p>
    </section>
  );
}

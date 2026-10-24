// The story so far. The current event sits in a card that stays put; underneath, every event
// is one short row to click back or forward to. A long quiet gap is the charging.

import { memo, useEffect, useRef } from "react";
import { clock } from "../engine.js";
import { describe } from "../words.js";

const LABEL = { report: "Report", move: "Drone", finding: "Finding", unclear: "Unclear", decision: "Decision", clear: "All clear", info: "Status" };

// memo: the clock ticks every frame while playing, this only changes at a step
export default memo(function Timeline({ events, step, onStep, data, params, everything, onEverything }) {
  const current = useRef(null);
  // braces: scrollIntoView returns a promise in new Chromium, and React would call it on cleanup
  useEffect(() => { current.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [step]);
  // a shorter list (Key moments) can arrive one render before the step is moved back into it
  const now = events[Math.min(step, events.length - 1)];
  const d = describe(now, data, params);

  return (
    <nav className="timeline" aria-label="The story, event by event">
      <section className={`now-card ${d.tone}`} aria-live="polite">
        <div className="now-head">
          <span className="badge">{LABEL[d.tone]}</span>
          <span className="num">{clock(now.t)}</span>
          {now.hypothetical && <span className="tag">Made up</span>}
        </div>
        <h2>{d.title}</h2>
        {d.detail && <p>{d.detail}</p>}
      </section>

      <div className="timeline-filter segmented" role="group" aria-label="Show">
        <button aria-pressed={!everything} onClick={() => onEverything(false)}>Key moments</button>
        <button aria-pressed={everything} onClick={() => onEverything(true)}>Everything</button>
      </div>

      <ol className="events">
        {events.map((e, i) => {
          const tone = describe(e, data, params).tone;
          const gap = i > 0 ? e.t - events[i - 1].t : 0;
          return [
            gap >= 60 && e.t > 120 && (
              <li key={`gap${i}`} className="gap" aria-hidden="true">{Math.round(gap / 60)} quiet hours: charging, then waiting</li>
            ),
            <li key={i} ref={i === step ? current : null} className={`ev ${tone}${i === step ? " now" : ""}${i > step ? " later" : ""}`}>
              <button onClick={() => onStep(i)} aria-current={i === step ? "step" : undefined}>
                <span className="t num">{clock(e.t)}</span>
                <i className="mark" aria-hidden="true" />
                <span className="title">{describe(e, data, params).title}</span>
              </button>
            </li>,
          ];
        })}
      </ol>
    </nav>
  );
});

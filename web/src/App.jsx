import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULTS, clock, simulate } from "./engine.js";
import Board from "./components/Board.jsx";
import Intro from "./components/Intro.jsx";
import Settings from "./components/Settings.jsx";
import StormMap from "./components/StormMap.jsx";
import { Chapter, Summary, chapter } from "./components/Story.jsx";
import Timeline from "./components/Timeline.jsx";
import { airborne, flightsOf } from "./playback.js";
import { SCENARIOS } from "./scenarios.js";
import { REPORT, routine } from "./words.js";

const FILES = ["spans.geojson", "nodes.geojson", "areas.geojson", "trees.geojson", "wind.json", "nearby.json"];

async function load() {
  const [spans, nodes, areas, trees, wind, nearby] = await Promise.all(FILES.map(async (name) => {
    const response = await fetch(`/data/${name}`);
    if (!response.ok) throw new Error(`${name}: ${response.status}. Run python -m vigi.build first.`);
    return response.json();
  }));
  const list = spans.features.map((f) => ({ ...f.properties, lonlat: f.geometry.coordinates }));
  // only there once python -m vigi.canopy has run over the DOM20 spot tiles
  const spot = await fetch("/data/spotcheck.json");
  const spotcheck = spot.ok ? await spot.json() : {};
  return { spans, list, index: new Map(list.map((s, i) => [s.id, i])), nodes, areas, trees, wind, nearby, spotcheck };
}

// Minutes of the storm per second on screen: a flight plays out in about ten seconds, a three
// hour charge in a few. The clock stops on a decision or a finding long enough to read it.
const FLYING = 1.5;
const QUIET = 40;
const SPEEDS = [1, 2, 4];
const holdMs = (e) => (e.kind === "decision" || e.kind === "report" || e.kind === "storm" || e.outcome === "found" || e.outcome === "unclear" || e.kind === "switch"
  || (e.kind === "line" && e.outcome === "dead") ? 1800 : e.kind === "flight" || e.kind === "land" || e.kind === "call" ? 500 : 0);

// The two hours before anything can fly: the storm, then the reports as they came in. The
// planner only starts at T+2:00, so these carry its first state.
const minutesOf = (time) => { const [, h, m] = time.match(/T\+(\d+):(\d+)/); return 60 * Number(h) + Number(m); };
function story(data, run, only) {
  const reports = data.areas.features.filter((f) => f.properties.kind !== "storm")
    .filter((f) => !only || only.includes(f.properties.id) || f.properties.id === "SYN_REPORT_01")
    .map((f) => ({ t: minutesOf(f.properties.time), kind: "report", report: f.properties.id, hypothetical: true }));
  return [{ t: 0, kind: "storm" }, ...reports].sort((a, b) => a.t - b.t).map((e) => ({ ...e, state: run.events[0].state }));
}

export default function App() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [params, setParams] = useState(DEFAULTS);
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [step, setStep] = useState(0);
  const [t, setT] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [picked, setPicked] = useState(null);
  const [settings, setSettings] = useState(false);
  const [intro, setIntro] = useState(true);
  const [everything, setEverything] = useState(false);
  const now = useRef(null);
  const stepNow = useRef(0);
  stepNow.current = step;

  useEffect(() => { load().then(setData, setFailed); }, []);

  const run = useMemo(() => data && simulate({ spans: data.list, wind: data.wind }, params, scenario.truth), [data, params, scenario]);
  const flights = useMemo(() => (run ? flightsOf(run.events) : []), [run]);
  // the steps: the moments that matter, or every reading when asked for
  const events = useMemo(() => (run ? [...story(data, run, scenario.truth.reports), ...run.events] : []).filter((e) => everything || !routine(e)), [data, run, everything, scenario]);

  // a new run or a new filter keeps the minute on screen, a new tab starts at the beginning
  useEffect(() => {
    if (!events.length) return;
    if (now.current === null) {
      now.current = events[0].t;
      setT(events[0].t);
    }
    setStep(Math.max(events.findLastIndex((e) => e.t <= now.current), 0));
  }, [events]);

  const goTo = useCallback((i) => {
    setPlaying(false);
    setStep(i);
    now.current = events[i].t;
    setT(events[i].t);
  }, [events]);

  const togglePlay = useCallback(() => {
    if (!playing && now.current >= events.at(-1).t) goTo(0);
    setPlaying((p) => !p);
  }, [playing, events, goTo]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let holdUntil = 0;
    let frame;
    const tick = (time) => {
      const dt = Math.min(time - last, 100) / 1000;
      last = time;
      if (time >= holdUntil) {
        const rate = airborne(flights, now.current).length ? FLYING : QUIET;
        let next = Math.min(now.current + dt * speed * rate, events.at(-1).t);
        let s = stepNow.current;
        while (s + 1 < events.length && events[s + 1].t <= next) {
          s += 1;
          const hold = holdMs(events[s]);
          if (hold) { holdUntil = time + hold / speed; next = events[s].t; break; }
        }
        now.current = next;
        setT(next);
        if (s !== stepNow.current) setStep(s);
        if (next >= events.at(-1).t && s === events.length - 1) { setPlaying(false); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, events, flights]);

  useEffect(() => {
    const key = (e) => {
      if (intro || e.target.closest("input, select, textarea")) return;
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goTo(Math.min(stepNow.current + 1, events.length - 1));
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goTo(Math.max(stepNow.current - 1, 0));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [events.length, intro, goTo, togglePlay]);

  const open = (s, play = false) => {
    now.current = null;
    setStep(0);
    setPicked(null);
    setScenario(s);
    setPlaying(play);
  };

  if (failed) return <p className="notice error">The data didn't load. {failed.message}</p>;
  if (!run || t === null) return <p className="notice">Loading the grid and running the plan.</p>;

  const event = events[Math.min(step, events.length - 1)];
  const report = scenario.report && data.areas.features.find((f) => f.properties.id === scenario.report).properties;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">SMBO</span>
        <div className="player">
          <button className="quiet small" onClick={() => goTo(Math.max(step - 1, 0))} disabled={step === 0} aria-label="Previous step">‹</button>
          <button className="play" onClick={togglePlay} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
          <button className="quiet small" onClick={() => goTo(Math.min(step + 1, events.length - 1))} disabled={step >= events.length - 1} aria-label="Next step">›</button>
          <span className="clock"><span className="num">{clock(t)}</span><span className="step-count num">step {step + 1} of {events.length}</span></span>
          <div className="segmented" role="group" aria-label="Speed">
            {SPEEDS.map((v) => <button key={v} aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}×</button>)}
          </div>
        </div>
        <span className="synthetic">Real grid, trees and wind. Made-up storm.</span>
        <button className="quiet small" onClick={() => { setPlaying(false); setIntro(true); }}>About</button>
        <button className="quiet small" aria-pressed={settings} onClick={() => setSettings(!settings)}>Settings</button>
      </header>
      <div className="scenarios">
        <div className="tabs" role="tablist" aria-label="What's really out there">
          {SCENARIOS.map((s) => (
            <button key={s.id} role="tab" aria-selected={s === scenario} className="tab" onClick={() => open(s, playing)}>{s.tab}</button>
          ))}
        </div>
        {report && (
          <p className="report-quote" title={report.text.replace(/^SYNTHETIC /, "")}><b>{REPORT[scenario.report]}, {report.time}, rated {report.confidence}.</b>{" "}
            {report.text.replace(/^SYNTHETIC (.)/, (_, c) => c.toUpperCase())}</p>
        )}
        <p className="scenario-note"><span className="tag">Hidden truth</span> {scenario.name} <span className="sub">{scenario.shows}</span></p>
      </div>
      <main className="layout">
        <Timeline events={events} step={step} onStep={goTo} data={data} params={params}
                  everything={everything} onEverything={setEverything} />
        <StormMap data={data} event={event} t={t} flights={flights} log={run.events} only={scenario.truth.reports} dispatchAt={params.dispatchAt} picked={picked} onPick={setPicked} standby={run.standby} />
        <Board data={data} run={run} event={event} picked={picked} onPick={setPicked} params={params} />
        <Chapter index={chapter(event, flights, t)} />
        {event.kind === "end" && (
          <Summary run={run} truth={scenario.truth} next={SCENARIOS[SCENARIOS.indexOf(scenario) + 1]}
                   onReplay={() => { goTo(0); setPlaying(true); }}
                   onNext={() => open(SCENARIOS[SCENARIOS.indexOf(scenario) + 1], true)} />
        )}
        {settings && <Settings params={params} setParams={setParams} onClose={() => setSettings(false)} />}
      </main>
      {intro && <Intro onPlay={() => { setIntro(false); open(SCENARIOS[0], true); }}
                       onExplore={() => { setIntro(false); open(SCENARIOS[0]); }} />}
    </div>
  );
}

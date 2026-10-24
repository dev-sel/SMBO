// MapLibre over the Bavarian survey's own web map, aerial photos or colour infrared, where
// leaves show red. Spans are coloured by the chance of a fault on them at the current step.

import { useEffect, useMemo, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { airborne, at, progress, rest, trail } from "../playback.js";
import { FAULT, pct, spanName } from "../words.js";

const BAYERN = (layer) => `https://wmtsod1.bayernwolke.de/wmts/${layer}/smerc/{z}/{x}/{y}`;
const BASEMAPS = [["by_webkarte_grau", "Map"], ["by_dop", "Aerial"], ["by_dop_cir", "Infrared"]];
const ATTRIBUTION = '<a href="https://geodaten.bayern.de/opengeodata/">Bayerische Vermessungsverwaltung</a>, CC BY 4.0. Grid © OpenStreetMap contributors, ODbL';

// Chance of a fault, pale to deep red, and a red halo round the likely spans, so the risk reads
// at a glance on the grey map and on the aerial photos alike. Not green: it would vanish in forest.
const BREAKS = [[0, "#9aa3ae"], [0.02, "#ffb3a6"], [0.06, "#ff8a75"], [0.15, "#ff4433"], [0.35, "#e3001b"], [0.7, "#9e0016"]];
const COLOUR = ["interpolate", ["linear"], ["get", "p"], ...BREAKS.flat()];
// zoom has to be the outermost input, so a wider casing is its own expression, not WIDTH + 2
const width = (extra = 0) => ["interpolate", ["linear"], ["zoom"],
  9, ["interpolate", ["linear"], ["get", "p"], 0, 1.8 + extra, 0.06, 3.5 + extra, 0.3, 6 + extra],
  14, ["interpolate", ["linear"], ["get", "p"], 0, 3 + extra, 0.06, 7 + extra, 0.3, 12 + extra]];
// the halo grows with the chance, from 2 % up, so a risky stretch reads as a zone
const BUFFER_WIDTH = ["interpolate", ["linear"], ["zoom"],
  9, ["interpolate", ["linear"], ["get", "p"], 0.02, 10, 0.1, 30, 0.3, 46],
  14, ["interpolate", ["linear"], ["get", "p"], 0.02, 22, 0.1, 50, 0.3, 80]];
const LEGEND = BREAKS.map(([, c]) => c);

const STYLE = {
  version: 8,
  sources: Object.fromEntries(BASEMAPS.map(([id]) => [id, { type: "raster", tiles: [BAYERN(id)], tileSize: 256, maxzoom: 19, attribution: ATTRIBUTION }])),
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#262626" } },
    // the grey map dimmed to the app's dark, so the lines carry the colour
    ...BASEMAPS.map(([id], i) => ({ id, type: "raster", source: id, layout: { visibility: i ? "none" : "visible" },
                                    paint: { "raster-opacity": 0.9, "raster-brightness-max": i ? 0.85 : 0.5 } })),
  ],
};

const empty = { type: "FeatureCollection", features: [] };

// the inspection view: what's been flown, what has power. Teal is flown, so it can't mix with
// the risk blues, and only the crew is red.
const CHECKED = "#2fb3a3";
const UNCHECKED = "#8796ab";
const STATUS = ["case", ["get", "checked"], CHECKED, UNCHECKED];
const statusWidth = ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "checked"], 3.5, 1.4], 14, ["case", ["get", "checked"], 7, 2.5]];
const VIEWS = [["inspection", "Inspection"], ["risk", "Chance of a fault"], ["cover", "Who covers what"]];

// who covers what: one colour per package, none of them the risk blues or the decision orange
export const COVER = ["#2fb3a3", "#e9c46a", "#e47fae", "#7cc4f0", "#a7d37f"];
const COVER_COLOUR = ["match", ["get", "owner"], ...COVER.flatMap((c, k) => [k, c]), "#9aa1ac"];

// What's on the ground by minute t: a ring where a package saw something, solid once a crew is
// on the way, amber while one reading isn't enough.
function incidents(log, t, dispatchAt) {
  const out = new Map();
  for (const e of log) {
    if (e.t > t) break;
    if (e.kind === "look" && e.outcome === "found" && out.get(e.span)?.kind !== "crew") {
      const sure = e.after >= dispatchAt;
      out.set(e.span, { kind: sure ? "found" : "unclear", label: sure ? FAULT[e.fault] : `${FAULT[e.fault]}?` });
    }
    if (e.kind === "decision" && e.action === "dispatch") out.set(e.span, { kind: "crew", label: `Crew: ${FAULT[e.fault]}` });
  }
  return out;
}

const AREA = [[10.45, 48.09], [10.88, 48.38]];

// Where the story is at this step: a report's area, a finding's span, a switched line. Take-offs,
// landings and the start and end pull back to the whole network so every drone is in view.
function focus(e, data) {
  const area = (id) => data.areas.features.find((f) => f.properties.id === id)?.geometry.coordinates[0];
  const span = (id) => data.list[data.index.get(id)]?.lonlat;
  const line = (id) => data.list.filter((s) => s.line === id).flatMap((s) => s.lonlat);
  if (e.kind === "report" && e.report !== "SYN_REPORT_01") return [area(e.report), 11.5];
  if (e.kind === "decision" && e.action === "standdown") return [area(e.report), 11.5];
  if ((e.kind === "look" && e.outcome === "found") || (e.kind === "decision" && e.action === "dispatch")) return [span(e.span), 13.5];
  if (e.kind === "switch" || (e.kind === "decision" && e.action === "reenergize") || (e.kind === "line" && e.outcome === "dead")) return [line(e.line), 12];
  if (["storm", "start", "end", "land", "call"].includes(e.kind) || (e.kind === "flight" && !e.retask)) return [AREA, 11];
  return null;
}

const minutesOf = (time) => { const [, h, m] = time.match(/T\+(\d+):(\d+)/); return 60 * Number(h) + Number(m); };

export default function StormMap({ data, event, t, flights, log, only, dispatchAt, picked, onPick, standby }) {
  const holder = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const pins = useRef({});
  const labels = useRef({});
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState("by_webkarte_grau");
  const [view, setView] = useState("inspection");
  const [follow, setFollow] = useState(true);
  const cover = view === "cover";

  useEffect(() => {
    // its own node: React runs effects twice in dev, and a shared container loses the canvas
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0";
    holder.current.appendChild(container);
    const m = new MapLibreMap({ container, style: STYLE, bounds: AREA,
                                fitBoundsOptions: { padding: 30 }, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("error", (e) => console.error("map:", e.error?.message ?? e));
    m.on("load", () => {
      m.addSource("areas", { type: "geojson", data: data.areas });
      m.addLayer({ id: "storm", type: "fill", source: "areas", filter: ["==", ["get", "kind"], "storm"], paint: { "fill-color": "#f4f4f3", "fill-opacity": 0.06 } });
      // a report shows from the minute it came in, amber while open, grey once closed
      const report = ["all", ["!=", ["get", "kind"], "storm"], ["!=", ["get", "id"], "SYN_REPORT_01"], ["get", "shown"]];
      m.addLayer({ id: "reports-fill", type: "fill", source: "areas", filter: report,
                   paint: { "fill-color": ["case", ["get", "closed"], "#9aa1ac", "#e9c46a"], "fill-opacity": ["case", ["get", "closed"], 0.03, 0.08] } });
      m.addLayer({ id: "reports", type: "line", source: "areas", filter: report,
                   paint: { "line-color": ["case", ["get", "closed"], "#9aa1ac", "#e9c46a"], "line-width": 1.5, "line-dasharray": [3, 2] } });

      m.addSource("trees", { type: "geojson", data: data.trees });
      m.addLayer({ id: "trees", type: "circle", source: "trees", minzoom: 11,
                   paint: { "circle-color": "#5fae58", "circle-stroke-color": "#1d3a1a", "circle-stroke-width": 0.8,
                            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["/", ["get", "h"], 14], 16, ["/", ["get", "h"], 3]] } });

      m.addSource("spans", { type: "geojson", data: empty });
      m.addLayer({ id: "risk-buffer", type: "line", source: "spans", filter: [">=", ["get", "p"], 0.02], layout: { "line-cap": "round" },
                   paint: { "line-color": "#ff2d20", "line-width": BUFFER_WIDTH, "line-blur": 10,
                            "line-opacity": ["interpolate", ["linear"], ["get", "p"], 0.02, 0.22, 0.1, 0.45, 0.3, 0.65] } });
      // a dark edge under every line, so it holds against a bright field on the photos
      m.addLayer({ id: "spans-casing", type: "line", source: "spans", layout: { "line-cap": "round" },
                   paint: { "line-color": "#111111", "line-opacity": 0.75, "line-width": width(3) } });
      m.addLayer({ id: "spans", type: "line", source: "spans", filter: ["!", ["get", "dead"]], layout: { "line-cap": "round" },
                   paint: { "line-color": COLOUR, "line-width": width() } });
      // a line that's off is dashed, whatever its chance
      m.addLayer({ id: "spans-dead", type: "line", source: "spans", filter: ["get", "dead"],
                   paint: { "line-color": COLOUR, "line-width": width(), "line-dasharray": [3, 1] } });
      m.addLayer({ id: "status-on", type: "line", source: "spans", filter: ["==", ["get", "power"], "on"], layout: { "line-cap": "round" },
                   paint: { "line-color": STATUS, "line-width": statusWidth } });
      m.addLayer({ id: "status-off", type: "line", source: "spans", filter: ["==", ["get", "power"], "off"],
                   paint: { "line-color": STATUS, "line-width": statusWidth, "line-dasharray": [1.5, 1] } });
      m.addLayer({ id: "status-unknown", type: "line", source: "spans", filter: ["==", ["get", "power"], "unknown"], layout: { "line-cap": "round" },
                   paint: { "line-color": STATUS, "line-width": statusWidth, "line-dasharray": [0.1, 2] } });
      // a crew's span in white on black, so it can't be mistaken for risk red
      m.addLayer({ id: "crew-casing", type: "line", source: "spans", filter: ["get", "crew"], layout: { "line-cap": "round" },
                   paint: { "line-color": "#111111", "line-width": width(7) } });
      m.addLayer({ id: "crew", type: "line", source: "spans", filter: ["get", "crew"], layout: { "line-cap": "round" },
                   paint: { "line-color": "#ffffff", "line-width": width(3) } });
      m.addLayer({ id: "spans-hit", type: "line", source: "spans", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 14 } });

      m.addSource("trail", { type: "geojson", data: empty });
      m.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-join": "round", "line-cap": "round" },
                   paint: { "line-color": "#f4f4f3", "line-width": 2.5, "line-opacity": 0.85 } });
      m.addSource("path", { type: "geojson", data: empty });
      // dark on a white casing reads on the grey map and on the photos alike
      m.addLayer({ id: "path-casing", type: "line", source: "path", layout: { "line-join": "round" },
                   paint: { "line-color": "#f4f4f3", "line-width": ["case", ["get", "chosen"], 8, 6] } });
      m.addLayer({ id: "path", type: "line", source: "path", layout: { "line-join": "round" },
                   paint: { "line-color": ["case", ["get", "chosen"], "#6fa8dc", "#262626"], "line-width": ["case", ["get", "chosen"], 3.5, 2.5], "line-dasharray": [2, 1.5] } });

      m.addSource("nodes", { type: "geojson", data: data.nodes });
      m.addLayer({ id: "substations", type: "circle", source: "nodes", filter: ["==", ["get", "type"], "abstract_substation"],
                   paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 6], "circle-color": "#f4f4f3",
                            "circle-stroke-color": "#262626", "circle-stroke-width": 1.5 } });

      // report labels as plain markers, the map style has no fonts
      for (const f of data.areas.features) {
        if (f.properties.kind === "storm" || f.properties.id === "SYN_REPORT_01") continue;
        const el = Object.assign(document.createElement("div"), { className: "area-label hidden", textContent: f.properties.id.replace("SYN_REPORT_", "R") });
        const outer = document.createElement("div");
        outer.appendChild(el);
        labels.current[f.properties.id] = new Marker({ element: outer, anchor: "top-left" }).setLngLat(f.geometry.coordinates[0][3]).addTo(m);
      }

      const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "popup hover" });
      m.on("mousemove", (e) => {
        const hit = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ["substations", "spans-hit"] })[0];
        m.getCanvas().style.cursor = hit ? "pointer" : "";
        if (!hit) return hover.remove();
        const p = hit.properties;
        const node = document.createElement("div");
        const head = Object.assign(document.createElement("div"), { className: "mono", textContent: p.type ? p.id : spanName(p.id) });
        const sub = Object.assign(document.createElement("div"), { className: "sub",
          textContent: p.type ? (p.name || "name not recorded") : `${pct(p.p)} chance of a fault${p.trees ? `, ${p.trees} trees can reach` : ""}${p.dead ? ", line off" : ""}` });
        node.append(head, sub);
        hover.setLngLat(e.lngLat).setDOMContent(node).addTo(m);
      });
      m.getCanvas().addEventListener("mouseleave", () => hover.remove());
      m.on("click", (e) => {
        const hit = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ["spans-hit"] })[0];
        pick.current(hit ? hit.properties.id : null);
      });
      setReady(true);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(holder.current);
    return () => {
      ro.disconnect();
      m.remove();
      container.remove();
      markers.current = {};
      pins.current = {};
      labels.current = {};
      setReady(false);
    };
  }, [data]);

  useEffect(() => {
    if (!ready) return;
    for (const [id] of BASEMAPS) map.current.setLayoutProperty(id, "visibility", id === base ? "visible" : "none");
  }, [ready, base]);

  const { done, ahead } = useMemo(() => progress(flights, t), [flights, t]);
  const doneKey = `${done.size}|${ahead.size}`;
  const POWER = { live: "on", assumed: "on", dead: "off", doubt: "unknown" };

  // the spans change at an event or when a package finishes one
  useEffect(() => {
    if (!ready || !event) return;
    const { state } = event;
    map.current.getSource("spans").setData({
      type: "FeatureCollection",
      features: data.spans.features.map((f, i) => ({
        type: "Feature", geometry: f.geometry,
        properties: { id: f.properties.id, p: state.p[i], trees: f.properties.trees_reaching, owner: standby.owner[i],
                      dead: state.lines[f.properties.line] === "dead", crew: state.dispatched.includes(i),
                      power: POWER[state.lines[f.properties.line]], checked: done.has(f.properties.id) },
      })),
    });
  }, [ready, event, data, standby, doneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // reports by the minute they came in, closed once the planner stood them down
  const closed = useMemo(() => new Set(log.filter((e) => e.t <= t && e.action === "standdown").map((e) => e.report)), [log, t]);
  const shownKey = data.areas.features.filter((f) => f.properties.time && minutesOf(f.properties.time) <= t).length;
  const closedKey = [...closed].join();
  useEffect(() => {
    if (!ready) return;
    map.current.getSource("areas").setData({ ...data.areas, features: data.areas.features.map((f) => {
      const since = f.properties.time ? minutesOf(f.properties.time) : 0;
      const mine = !only || only.includes(f.properties.id);
      return { ...f, properties: { ...f.properties, shown: mine && since <= t, closed: closed.has(f.properties.id) } };
    }) });
    for (const [id, marker] of Object.entries(labels.current)) {
      const props = data.areas.features.find((f) => f.properties.id === id).properties;
      const since = minutesOf(props.time);
      const el = marker.getElement().firstChild;
      el.className = `area-label${since > t || (only && !only.includes(id)) ? " hidden" : ""}${closed.has(id) ? " closed" : ""}${since <= t && t - since < 15 ? " fresh" : ""}`;
      el.textContent = `${id.replace("SYN_REPORT_", "R")}${closed.has(id) ? " ✓" : ""}`;
    }
  }, [ready, data, only, shownKey, closedKey, Math.floor(t / 15)]); // eslint-disable-line react-hooks/exhaustive-deps

  const found = useMemo(() => incidents(log, t, dispatchAt), [log, t, dispatchAt]);
  const foundKey = [...found].map(([k, v]) => k + v.kind).join();
  useEffect(() => {
    if (!ready) return;
    const live = new Set();
    for (const [id, { kind, label }] of found) {
      live.add(id);
      const s = data.list[data.index.get(id)];
      if (!pins.current[id]) {
        const outer = document.createElement("div");
        outer.appendChild(document.createElement("div"));
        pins.current[id] = new Marker({ element: outer }).setLngLat([(s.lonlat[0][0] + s.lonlat[1][0]) / 2, (s.lonlat[0][1] + s.lonlat[1][1]) / 2]).addTo(map.current);
      }
      const el = pins.current[id].getElement().firstChild;
      el.className = `incident ${kind}`;
      el.innerHTML = `<i></i><span>${label}</span>`;
    }
    for (const id of Object.keys(pins.current)) if (!live.has(id)) { pins.current[id].remove(); delete pins.current[id]; }
  }, [ready, data, foundKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the packages move every frame
  useEffect(() => {
    const m = map.current;
    if (!ready || !event) return;
    const flying = Object.fromEntries(airborne(flights, t).map((f) => [f.pkg, f]));
    const line = (coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
    m.getSource("trail").setData({ type: "FeatureCollection", features: Object.values(flying).map((f) => line(trail(flights, f, t))) });
    // the package taking off at this step stands out, with its route
    const chosen = event.kind === "flight" ? event.pkg : null;
    m.getSource("path").setData({ type: "FeatureCollection", features: Object.values(flying)
      .map((f) => ({ ...line(rest(f, t)), properties: { chosen: f.pkg === chosen } })) });

    // each package in the air marks the span it's mainly after, until it gets there
    const aims = {};
    for (const f of Object.values(flying)) {
      const aim = f.why[0];
      const j = f.run.indexOf(aim?.span);
      if (aim && aim.value >= 0.02 && j >= 0 && f.track[j + 2][2] > t) aims[f.pkg] = aim.span;
    }
    for (const [pkg, span] of Object.entries(aims)) {
      const key = `aim-${pkg}`;
      const s = data.list[data.index.get(span)];
      const at2 = [(s.lonlat[0][0] + s.lonlat[1][0]) / 2, (s.lonlat[0][1] + s.lonlat[1][1]) / 2];
      if (!pins.current[key]) {
        const outer = document.createElement("div");
        outer.appendChild(Object.assign(document.createElement("div"), { className: "aim" }));
        pins.current[key] = new Marker({ element: outer }).setLngLat(at2).addTo(m);
      }
      pins.current[key].setLngLat(at2);
      pins.current[key].getElement().firstChild.innerHTML = `<i></i><span>${pkg} heading here</span>`;
    }
    for (const key of Object.keys(pins.current)) if (key.startsWith("aim-") && !aims[key.slice(4)]) { pins.current[key].remove(); delete pins.current[key]; }

    for (const k of event.state.packages) {
      // style the inner dot only: MapLibre positions the outer element with its own classes,
      // and overwriting those drops the markers into page flow, where they drift on zoom
      if (!markers.current[k.id]) {
        const outer = document.createElement("div");
        outer.appendChild(Object.assign(document.createElement("div"), { textContent: k.id, title: k.id }));
        markers.current[k.id] = new Marker({ element: outer }).setLngLat(k.lonlat).addTo(m);
      }
      const f = flying[k.id];
      markers.current[k.id].setLngLat(f ? at(f, t) : k.lonlat);
      const dot = markers.current[k.id].getElement().firstChild;
      dot.className = `drone ${k.stranded ? "stranded" : f ? "flying" : k.witness ? "witness" : k.readyAt > t ? "charging" : "ready"}${k.id === chosen ? " chosen" : ""}`;
      dot.style.boxShadow = cover ? `0 0 0 4px ${COVER[Number(k.id.slice(1)) - 1]}` : "";
    }
  }, [ready, event, t, flights, cover]);

  useEffect(() => {
    if (!ready) return;
    const m = map.current;
    for (const id of ["spans", "spans-dead"]) {
      m.setPaintProperty(id, "line-color", cover ? COVER_COLOUR : COLOUR);
      m.setLayoutProperty(id, "visibility", view === "inspection" ? "none" : "visible");
    }
    // the red halo stays on in the inspection view too: where the risk is, whatever else is shown
    m.setLayoutProperty("risk-buffer", "visibility", cover ? "none" : "visible");
    for (const id of ["status-on", "status-off", "status-unknown"]) m.setLayoutProperty(id, "visibility", view === "inspection" ? "visible" : "none");
    // the risk view is about the lines: the report areas keep their outline, not their fill
    m.setLayoutProperty("reports-fill", "visibility", view === "risk" ? "none" : "visible");
  }, [ready, view, cover]);

  // the camera follows the story, unless someone has picked a span to look at
  useEffect(() => {
    if (!ready || !follow || picked || !event) return;
    const target = focus(event, data);
    if (!target?.[0]) return;
    const [coords, maxZoom] = target;
    const bounds = coords.reduce((b, c) => b.extend(c), new LngLatBounds(coords[0], coords[0]));
    map.current.fitBounds(bounds, { padding: 70, maxZoom, duration: 1400 });
  }, [ready, follow, picked, event, data]);

  useEffect(() => {
    if (!ready || !picked) return;
    const s = data.list[data.index.get(picked)];
    const b = new LngLatBounds(s.lonlat[0], s.lonlat[0]).extend(s.lonlat[1]);
    map.current.fitBounds(b, { padding: 140, maxZoom: 15, duration: 700 });
  }, [ready, picked, data]);

  return (
    <div className="map-holder" ref={holder}>
      <div className="map-controls">
        <div className="segmented" role="group" aria-label="Colour the lines by">
          {VIEWS.map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </div>
        <div className="segmented" role="group" aria-label="Background">
          {BASEMAPS.map(([id, label]) => <button key={id} aria-pressed={base === id} onClick={() => setBase(id)}>{label}</button>)}
        </div>
        <div className="segmented">
          <button aria-pressed={follow} onClick={() => setFollow(!follow)}>Follow the action</button>
        </div>
      </div>
      <div className="legend">
        {view === "inspection" && <>
          <div className="item"><span className="swatch" style={{ background: CHECKED }} />checked by a drone</div>
          <div className="item"><span className="swatch route" />route ahead</div>
          <div className="item"><span className="swatch" style={{ background: UNCHECKED }} />live, not checked yet</div>
          <div className="item"><span className="swatch dashed" />no power</div>
          <div className="item"><span className="swatch dotted" />power not known yet</div>
          <div className="item"><span className="swatch halo" />likely fault</div>
        </>}
        {view === "risk" && <>
          <div className="legend-title">Chance of a fault</div>
          <div className="ramp" style={{ background: `linear-gradient(90deg, ${LEGEND.join(", ")})` }} />
          <div className="ramp-ends">{BREAKS.map(([v]) => <span key={v}>{Math.round(v * 100)}</span>)}</div>
          <div className="ramp-unit">per cent</div>
          <div className="item"><span className="swatch dashed" />no power</div>
          <div className="item"><span className="swatch round" style={{ background: "#5fae58" }} />tree that could hit it</div>
        </>}
        {cover && <>
          <div className="cover-row">
            {COVER.map((c, k) => <span className="item" key={c}><span className="swatch" style={{ background: c }} />D{k + 1}</span>)}
          </div>
          <p className="legend-note">Each line goes to the drone that reaches it fastest from its k-medoids
            standby. Average flight {standby.avgMinutes.toFixed(1)} min.</p>
        </>}
        <div className="item"><span className="swatch crew" />crew sent</div>
      </div>
    </div>
  );
}

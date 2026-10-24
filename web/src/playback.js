// Between two events the map still has to move the packages and fill in the spans they've
// flown. Both come from each flight's timed track, [lon, lat, minute] per waypoint.

// every flight with the minute it stopped counting: a re-plan in the air replaces it
export function flightsOf(events) {
  const out = [];
  const last = {};
  for (const e of events) {
    if (e.kind !== "flight") continue;
    const f = { ...e, until: Infinity };
    if (last[e.pkg]) last[e.pkg].until = e.t;
    last[e.pkg] = f;
    out.push(f);
  }
  return out;
}

// the track gives the run's start, then the end of each span flown, then the landing
const spanTimes = (f) => (f.run.length ? f.track.slice(2, 2 + f.run.length).map((p) => p[2]) : []);
const landsAt = (f) => f.track.at(-1)[2];

export function at(f, t) {
  const tr = f.track;
  if (t <= tr[0][2]) return tr[0].slice(0, 2);
  for (let j = 1; j < tr.length; j++) {
    if (t > tr[j][2]) continue;
    const [x0, y0, t0] = tr[j - 1];
    const [x1, y1, t1] = tr[j];
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    return [x0 + k * (x1 - x0), y0 + k * (y1 - y0)];
  }
  return tr.at(-1).slice(0, 2);
}

// the flights in the air at minute t, one per package at most
export const airborne = (flights, t) => flights.filter((f) => f.t <= t && t < f.until && t < landsAt(f));

// spans flown over by minute t, and the ones still ahead of a package in the air
export function progress(flights, t) {
  const done = new Set();
  const ahead = new Set();
  for (const f of flights) {
    if (f.t > t) break;
    const times = spanTimes(f);
    f.run.forEach((id, j) => {
      if (times[j] <= Math.min(t, f.until)) done.add(id);
      else if (t < f.until) ahead.add(id);
    });
  }
  return { done, ahead };
}

// the rest of a flight from where the package is now, for the dashed line ahead of it
export const rest = (f, t) => [at(f, t), ...f.track.filter((p) => p[2] > t).map((p) => p.slice(0, 2))];

// everything a package has flown since it last took off: re-plans in the air chain flights
export function trail(flights, f, t) {
  const chain = [f];
  for (let i = flights.indexOf(f) - 1; i >= 0; i--) {
    const g = flights[i];
    if (g.pkg !== chain[0].pkg) continue;
    if (g.until !== chain[0].t) break;
    chain.unshift(g);
  }
  return [...chain.flatMap((g) => g.track.filter((p) => p[2] <= Math.min(t, g.until)).map((p) => p.slice(0, 2))), at(f, t)];
}

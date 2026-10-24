// The planner. It runs in the browser on the files in public/data, so the demo can change an
// assumption and re-plan on the spot.
//
// Time is minutes after the storm's peak gust (T+0), distances are metres in UTM 32.
// Every span carries an expected number of faults per kind, kept per source (the background,
// each report) so a finding can explain a report away. A probability is 1 - exp(-expected).

export const KINDS = ["tree", "damage", "clearance"];
export const KIND_WORD = { tree: "tree on the wire", damage: "damaged wire or joint", clearance: "wire too low or swinging" };

export const DEFAULTS = {
  // the brief gives flight and charge, the rest is assumed
  fleet: 5,
  flightMin: 30,
  chargeMin: 180,
  reserveMin: 6,           // kept back for an alternate landing if the planned line won't charge
  overheadMin: 2,          // take off, clamp on
  speedMs: 16,             // our assumption, one speed whether it's getting somewhere or inspecting
  startMin: 120,           // T+2:00, the sixth report came in at T+1:51
  hoursAhead: 4,

  windFrom: null,          // null replays the measured gust front, a bearing overrides it
  fallSpreadDeg: 25,
  treeFallChance: 0.02,    // that one tree able to reach a wire falls in this storm
  backgroundPerKm: 0.003,  // faults that no report and no tree points at
  outsideStorm: 0.3,       // risk outside the storm footprint, relative to inside

  // that the report describes a real fault inside its area
  confidence: { SYN_REPORT_02: 0.35, SYN_REPORT_03: 0.6, SYN_REPORT_04: 0.15, SYN_REPORT_05: 0.3, SYN_REPORT_06: 0.2 },

  dispatchAt: 0.8,
  // a failed test energization is cleared by the protection in a fraction of a second, with a
  // witness on the line to say what happened, so it can take more doubt than sending a crew
  reenergizeBelow: 0.25,
  standDownBelow: 0.05,
  replan: true,            // false: a package keeps the flight it took off with, as the first version did
  restoreValue: 1,         // a flight that clears a switched-off line for switching back on: worth one fault found
  minFlightValue: 0.1,     // below this a package holds: a flight costs three hours of charging, and a
                           // package with a full battery can answer the next finding
};

// what each report could be describing
export const REPORT_MIX = {
  SYN_REPORT_02: { tree: 1 },
  SYN_REPORT_03: { tree: 0.5, damage: 0.3, clearance: 0.2 },
  SYN_REPORT_04: { damage: 0.6, clearance: 0.4 },
  SYN_REPORT_05: { damage: 1 },
  SYN_REPORT_06: { clearance: 1 },
};
const SOURCES = ["background", ...Object.keys(REPORT_MIX)];

// how often a look finds a fault that is there, assumed
export const POD = {
  patrol: { tree: 0.9, damage: 0.6, clearance: 0.7 },   // flying along the span
  perch: { tree: 0.6, damage: 0.6, clearance: 0.85 },   // clamped on the span: camera, thermal, IMU
  next: { tree: 0.3, damage: 0.2, clearance: 0.1 },     // the spans either side, seen from a perch
  listen: 0.4,         // arcing anywhere on the line, as pulses in the current while perched
  deadDamage: 0.35,    // no current, no heat: thermal finds nothing on a dead line
};
const FALSE_ALARM = { patrol: 0.01, perch: 0.05, next: 0.05 };
const EXPLAINED = 0.2;     // what's left of a report's weight elsewhere once a finding explains it
const LOCKOUT = 0.85;      // a line the protection locked out has a permanent fault on it
const LIVE_AFTER_EVENT = 0.5;
// Pulses in the current say something on the line is arcing, but corona on wet insulators
// sounds alike, and the pulses don't say where. Unclear: it raises the odds, it doesn't decide.
const ARCING_RATIO = 8;
// parked on a dead line a package gives up its next flight until the line is back, about what
// one flight finds. It has to be worth that.
const WITNESS_VALUE = -0.15;
// no two packages wait closer than this: the second would cover what the first already does
const SPACING_M = 2000;

// The walk-through's fictional truth. None of it is in the package, it's here to show how the
// plan adapts, and the demo can switch each part.
export const TRUTH = {
  faults: [
    { id: "tree", span: "LINE_026/3", kind: "tree", on: true, label: "A spruce lies on LINE_026 span 3" },
    { id: "joint", span: "LINE_036/14", kind: "damage", on: true, label: "A cracked joint arcs on LINE_036 span 14" },
  ],
  deadLines: { LINE_024: true, LINE_026: true },   // 024 the operator's switching, 026 locked out
  call: "generator",                              // the site's log for the R04 flash
};

const rad = (deg) => (deg * Math.PI) / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sum = (list) => list.reduce((a, b) => a + b, 0);
export const clock = (min) => {
  const m = Math.round(min);
  return `T+${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

// where trees fall, 36 bins of 10 degrees: downwind of each damaging gust, spread by a von Mises bell
export function fallDirections(gusts, spreadDeg) {
  const kappa = 1 / rad(spreadDeg) ** 2;
  const out = new Array(36).fill(0);
  for (const [from, weight] of gusts) {
    for (let k = 0; k < 36; k++) out[k] += weight * Math.exp(kappa * (Math.cos(rad(k * 10 + 5 - from - 180)) - 1));
  }
  const total = sum(out);
  return out.map((v) => v / total);
}

const gustsOf = (wind, params) => (params.windFrom == null ? wind.damaging : [[params.windFrom, 1]]);

// where the storm came from, a circular mean, so 350 and 10 average to 0 and not 180
export function windFrom(gusts) {
  const x = sum(gusts.map(([d, w]) => w * Math.sin(rad(d))));
  const y = sum(gusts.map(([d, w]) => w * Math.cos(rad(d))));
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

const treesLanding = (span, fall) => sum(span.hits.map((h, k) => h * fall[k]));

function reportWeight(span, kind, fall, from) {
  const km = span.length_m / 1000;
  if (kind === "tree") return treesLanding(span, fall) + 0.1 * km;
  if (kind === "damage") return km;
  // long spans across the wind swing furthest
  return km * (span.length_m / 300) ** 2 * (0.3 + Math.abs(Math.sin(rad(from - span.azimuth))));
}

export function prior(spans, wind, params) {
  const gusts = gustsOf(wind, params);
  const fall = fallDirections(gusts, params.fallSpreadDeg);
  const from = windFrom(gusts);
  const lam = Object.fromEntries(SOURCES.map((s) => [s, new Float64Array(spans.length * 3)]));
  spans.forEach((s, i) => {
    const where = s.storm ? 1 : params.outsideStorm;
    const base = (params.backgroundPerKm / 3) * (s.length_m / 1000) * where;
    lam.background.set([base + params.treeFallChance * treesLanding(s, fall) * where, base, base], i * 3);
  });
  for (const [rid, mix] of Object.entries(REPORT_MIX)) {
    const members = spans.flatMap((s, i) => (s.reports.includes(rid) ? [i] : []));
    for (const [kind, share] of Object.entries(mix)) {
      const t = KINDS.indexOf(kind);
      const weights = members.map((i) => reportWeight(spans[i], kind, fall, from));
      const total = sum(weights) || 1;
      members.forEach((i, j) => { lam[rid][i * 3 + t] += (params.confidence[rid] * share * weights[j]) / total; });
    }
  }
  return { lam, fall, from };
}

// Where the five wait out a storm: the p-median problem (Hakimi 1964), solved with PAM, the
// k-medoids algorithm (Kaufman and Rousseeuw 1987). k-means, except every centre has to be a
// real place, here a substation a crew can get to.
//
// Each span is weighted by the faults a typical storm here leaves on it: trees that could reach
// its wire, falling the way the 15 worst storms since 1996 blew, plus the background. Not this
// storm, it hasn't happened yet. A set of substations costs every span's weight times its flight
// time to the nearest one. PAM builds a set by adding the substation that cuts the cost most,
// five times, then swaps a chosen one for an unchosen one while any swap cuts it further.
export function standby(spans, wind, params) {
  const n = spans.length;
  const mid = spans.map((s) => [(s.xy[0][0] + s.xy[1][0]) / 2, (s.xy[0][1] + s.xy[1][1]) / 2]);
  const climate = fallDirections(wind.strongest_days.map((d) => [d.from, 1]), params.fallSpreadDeg);
  const weight = spans.map((s) => params.treeFallChance * treesLanding(s, climate) + (params.backgroundPerKm * s.length_m) / 1000);
  const minutes = (i, j) => dist(mid[i], mid[j]) / (params.speedMs * 60);

  // one perch per substation: of its spans, the one closest to the risk on its own
  const best = {};
  spans.forEach((s, c) => {
    const station = s.nodes.find((id) => id.startsWith("SUBSTATION"));
    if (!station || s.operator === "DB Energie") return;   // 16.7 Hz, can't charge
    let cost = 0;
    for (let i = 0; i < n; i++) cost += weight[i] * minutes(i, c);
    if (!best[station] || cost < best[station].cost) best[station] = { c, cost };
  });
  const sites = Object.values(best).map((b) => b.c);
  const far = sites.map((c) => Float64Array.from({ length: n }, (_, i) => minutes(i, c)));
  const cost = (set) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += weight[i] * Math.min(...set.map((k) => far[k][i]));
    return total;
  };

  const chosen = [];
  while (chosen.length < params.fleet) {
    const add = sites.map((_, k) => k).filter((k) => !chosen.includes(k))
      .reduce((a, k) => (cost([...chosen, k]) < cost([...chosen, a]) ? k : a));
    chosen.push(add);
  }
  let swaps = 0;
  for (let better = true; better;) {
    better = false;
    for (let a = 0; a < chosen.length; a++) {
      for (let k = 0; k < sites.length; k++) {
        if (chosen.includes(k)) continue;
        const trial = chosen.map((x, j) => (j === a ? k : x));
        if (cost(trial) < cost(chosen) - 1e-9) {
          chosen.splice(0, chosen.length, ...trial);
          better = true;
          swaps += 1;
        }
      }
    }
  }

  const owner = new Int8Array(n);
  const reach = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let o = 0;
    chosen.forEach((k, j) => { if (far[k][i] < far[chosen[o]][i]) o = j; });
    owner[i] = o;
    reach[i] = far[chosen[o]][i];
  }
  const total = sum(weight);
  return {
    chosen: chosen.map((k) => sites[k]),
    sites,
    owner,
    swaps,
    cost: cost(chosen),
    avgMinutes: cost(chosen) / total,
    within10: sum(weight.filter((_, i) => reach[i] <= 10)) / total,
    weight,
  };
}

// the whole walk-through, as an event log with the state after each event
export function simulate({ spans: all, wind }, params = DEFAULTS, truth = TRUTH) {
  // the reports that came in: all six unless a tab plays one on its own
  const active = truth.reports ?? Object.keys(REPORT_MIX);
  const spans = all.map((s) => ({ ...s, reports: s.reports.filter((r) => active.includes(r)) }));
  const n = spans.length;
  const byLine = {};
  spans.forEach((s, i) => (byLine[s.line] ??= []).push(i));
  const ends = spans.map((s) => s.xy);
  const mid = spans.map((s) => [(s.xy[0][0] + s.xy[1][0]) / 2, (s.xy[0][1] + s.xy[1][1]) / 2]);
  const midLonLat = spans.map((s) => [(s.lonlat[0][0] + s.lonlat[1][0]) / 2, (s.lonlat[0][1] + s.lonlat[1][1]) / 2]);
  const neighbours = spans.map((s) => byLine[s.line].filter((j) => Math.abs(spans[j].k - s.k) === 1));
  const speed = params.speedMs * 60;    // metres a minute
  const budget = params.flightMin - params.reserveMin - params.overheadMin;
  // other lines the reserve can reach, for the alternate landing
  const reserveM = params.reserveMin * speed;
  const nearby = mid.map((m, i) => mid.flatMap((o, j) => (spans[j].line !== spans[i].line && dist(m, o) <= reserveM ? [j] : [])));
  const far = Float32Array.from({ length: n * n }, (_, k) => dist(mid[Math.floor(k / n)], mid[k % n]) / speed);
  const minutes = (i, j) => far[i * n + j];

  const { lam, fall, from } = prior(spans, wind, params);
  const faults = new Set(truth.faults.filter((f) => f.on).map((f) => `${f.span}|${f.kind}`));
  const dispatched = new Set();
  const announced = new Set();
  const lockedOut = new Set();

  // what the operator knows about each line. "doubt": mostly inside the protection event's sector.
  const lineState = {};
  for (const [line, list] of Object.entries(byLine)) {
    const km = sum(list.map((i) => spans[i].length_m));
    const inR03 = sum(list.filter((i) => spans[i].reports.includes("SYN_REPORT_03")).map((i) => spans[i].length_m));
    lineState[line] = inR03 / km >= 0.5 ? "doubt" : "assumed";
  }
  if (active.includes("SYN_REPORT_03")) lineState.LINE_024 = "dead";   // switched off as a precaution
  // railway power is 16.7 Hz and the harvester is built for 50
  const railway = (line) => spans[byLine[line][0]].operator === "DB Energie";
  const chargeable = (line) => !railway(line) && (lineState[line] === "live" || lineState[line] === "assumed");
  const canLand = (i) => chargeable(spans[i].line)
    && (lineState[spans[i].line] === "live" || nearby[i].some((j) => chargeable(spans[j].line)));
  // once the operator has switched a line back on it is live, whatever the truth started with
  const truthDead = (line) => lineState[line] !== "live" && !!truth.deadLines[line];

  const total = (i, t) => SOURCES.reduce((a, s) => a + lam[s][i * 3 + t], 0);
  const p = (i, t) => 1 - Math.exp(-total(i, t));
  const pSpan = (i) => 1 - KINDS.reduce((a, _, t) => a * (1 - p(i, t)), 1);
  const scale = (i, t, factor) => { for (const s of SOURCES) lam[s][i * 3 + t] *= factor; };
  const setP = (i, t, value) => {
    const before = total(i, t);
    const after = -Math.log(1 - Math.min(value, 0.999));
    if (before > 0) scale(i, t, after / before);
    else lam.background[i * 3 + t] = after;
  };
  const raise = (i, t, ratio) => {
    const odds = p(i, t) / (1 - p(i, t));
    setP(i, t, (odds * ratio) / (1 + odds * ratio));
  };
  // what's left of a report: its own weight that no look has searched away and no finding explained
  const reportLeft = (rid) => {
    let expected = 0;
    for (let i = 0; i < n; i++) if (!dispatched.has(i)) for (let t = 0; t < 3; t++) expected += lam[rid][i * 3 + t];
    return 1 - Math.exp(-expected);
  };
  // Evidence about a whole line moves each span on it by one factor: the line comes out at `to`
  // and every span keeps its share of it.
  const lineExpected = (line, kinds) => sum(byLine[line].flatMap((i) => kinds.map((t) => total(i, t))));
  const lineTo = (line, kinds, to) => {
    const factor = -Math.log(1 - to) / lineExpected(line, kinds);
    for (const i of byLine[line]) for (const t of kinds) scale(i, t, factor);
    return factor;
  };
  const arcing = {};   // how far heard arcing has raised each line, undone once its source is found

  const events = [];
  const packages = [];
  let news = 0;   // goes up whenever the probability map changes enough to re-plan for
  let latest = null;   // the news itself, so a change of plan can say what prompted it
  const log = (event) => {
    // only what moves the probability map: a find, an unclear reading, a line found dead or
    // cleared after the trip, a switching. A decision or a line that was live as assumed isn't.
    if (event.outcome === "found" || event.outcome === "unclear" || event.kind === "switch"
        || (event.kind === "line" && (event.outcome === "dead" || event.was === "doubt"))) {
      news += 1;
      latest = { kind: event.kind, outcome: event.outcome, span: event.span, line: event.line, fault: event.fault, after: event.after };
    }
    events.push({
      ...event,
      state: {
        p: Float32Array.from({ length: n }, (_, i) => pSpan(i)),
        byKind: Float32Array.from({ length: n * 3 }, (_, j) => p(Math.floor(j / 3), j % 3)),
        packages: packages.map((k) => ({ id: k.id, span: k.span, lonlat: k.lonlat, flying: k.flying, stranded: k.stranded,
                                         readyAt: k.readyAt, flights: k.flights, witness: k.witness, holding: k.holding, standby: k.standby,
                                         at: k.flying ? k.at : k.lonlat, path: k.flying ? k.path : null })),
        lines: { ...lineState },
        dispatched: [...dispatched],
        reports: Object.fromEntries(active.map((rid) => [rid, reportLeft(rid)])),
      },
    });
  };

  // one look at one span for one kind of fault, answered by the fictional truth
  function look(i, t, mode, pod, when, pkg) {
    // A look under 50 % detection misses and one over it finds, every time, so a run repeats
    // exactly. A random draw per look would show the spread, and isn't done yet.
    const outcome = faults.has(`${spans[i].id}|${KINDS[t]}`) && pod >= 0.5 ? "found" : "clear";
    const before = p(i, t);
    if (outcome === "clear") scale(i, t, 1 - pod);
    else raise(i, t, pod / FALSE_ALARM[mode]);
    if (outcome === "found" || before >= 0.05) {
      log({ t: when, kind: "look", pkg, span: spans[i].id, fault: KINDS[t], mode, outcome, before, after: p(i, t), hypothetical: true });
    }
  }

  // A confirmed fault is the likeliest thing its reports saw, and the likeliest reason its line
  // tripped. Only once a crew is sent: a first sighting can still be wrong.
  function explain(i, t) {
    for (const rid of spans[i].reports) {
      if (!REPORT_MIX[rid]?.[KINDS[t]]) continue;
      for (let j = 0; j < n; j++) {
        if (j !== i && spans[j].reports.includes(rid)) for (let u = 0; u < 3; u++) lam[rid][j * 3 + u] *= EXPLAINED;
      }
    }
    const line = spans[i].line;
    if (lockedOut.has(line)) for (const j of byLine[line]) if (j !== i) { scale(j, 0, EXPLAINED); scale(j, 1, EXPLAINED); }
    if (t === 1 && arcing[line]) {
      for (const j of byLine[line]) if (j !== i) scale(j, 1, 1 / arcing[line]);
      delete arcing[line];
    }
  }

  function reveal(line, when, pkg, how) {
    const was = lineState[line];
    if (was === "live" || was === "dead") return;
    const dead = truthDead(line);
    lineState[line] = dead ? "dead" : "live";
    if (was === "doubt" && !dead) for (const i of byLine[line]) { scale(i, 0, LIVE_AFTER_EVENT); scale(i, 1, LIVE_AFTER_EVENT); }
    if (dead) {
      // nobody switched it off, so the protection locked it out: a span on it holds a tree or damage
      lockedOut.add(line);
      lineTo(line, [0, 1], LOCKOUT);
    }
    log({ t: when, kind: "line", pkg, line, outcome: lineState[line], how, was, hypothetical: true });
  }

  function perch(pkg, i, when) {
    const line = spans[i].line;
    reveal(line, when, pkg.id, "clamped on");
    const live = lineState[line] === "live";
    KINDS.forEach((kind, t) => look(i, t, "perch", t === 1 && !live ? POD.deadDamage * POD.perch.damage : POD.perch[kind], when, pkg.id));
    for (const j of neighbours[i]) KINDS.forEach((kind, t) => look(j, t, "next", POD.next[kind], when, pkg.id));
    if (!live) return;
    // listening to the whole line: arcing shows in the current, but not where it is
    const heard = byLine[line].some((j) => faults.has(`${spans[j].id}|damage`) && !dispatched.has(j));
    const before = 1 - Math.exp(-lineExpected(line, [1]));
    if (heard) {
      const odds = (before / (1 - before)) * ARCING_RATIO;
      arcing[line] = (arcing[line] ?? 1) * lineTo(line, [1], odds / (1 + odds));
    } else for (const j of byLine[line]) scale(j, 1, 1 - POD.listen);
    log({ t: when, kind: "listen", pkg: pkg.id, line, outcome: heard ? "unclear" : "clear",
          before, after: 1 - Math.exp(-lineExpected(line, [1])), hypothetical: true });
  }

  // What flights are worth before they're flown, on a copy of the expected faults. The spans
  // other packages are about to fly over count as searched, and their landings are taken.
  let plan = null;
  const freshPlan = (self) => {
    plan = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) plan[i] = SOURCES.reduce((a, s) => a + lam[s][i], 0);
    listened.clear();
    for (const k of packages) if (!k.flying && !k.stranded && lineState[spans[k.span].line] === "live") listened.add(spans[k.span].line);
    const others = packages.filter((k) => k.flying && k !== self);
    for (const k of others) for (const i of k.run.slice(k.done)) KINDS.forEach((_, t) => discount(i, t, 1));
    // where the rest of the fleet is, or will be once landed: nobody lands on a span that's held
    return new Set(packages.filter((k) => k !== self && !k.stranded).map((k) => (k.flying ? k.landing : k.span)));
  };
  const pp = (i, t) => 1 - Math.exp(-plan[i * 3 + t]);
  const patrolValue = (i) => (dispatched.has(i) ? 0 : KINDS.reduce((a, kind, t) =>
    a + pp(i, t) * (t === 1 && lineState[spans[i].line] === "dead" ? POD.deadDamage : POD.patrol[kind]), 0));
  // A span's chance of a fault before and after a patrol looks at it, for a switched-off line's
  // doubt as a run goes along it. A run that takes the doubt under the bar for switching the
  // line back on earns the power it brings back, once.
  const spanP = (i, searched) => 1 - Math.exp(-KINDS.reduce((a, kind, t) =>
    a + plan[i * 3 + t] * (searched ? 1 - (t === 1 ? POD.deadDamage : POD.patrol[kind]) : 1), 0));
  const restorable = (line) => lineState[line] === "dead" && !lockedOut.has(line) && !byLine[line].some((i) => dispatched.has(i));
  const listened = new Set();    // lines a perched package already hears
  // a span with a crew on the way has nothing left to find
  const open = (i) => !dispatched.has(i);
  const perchValue = (i) => (open(i) ? KINDS.reduce((a, kind, t) => a + pp(i, t) * POD.perch[kind], 0) : 0)
    + sum(neighbours[i].filter(open).map((j) => KINDS.reduce((a, kind, t) => a + pp(j, t) * POD.next[kind], 0)))
    + (listened.has(spans[i].line) ? 0 : POD.listen * sum(byLine[spans[i].line].filter(open).map((j) => pp(j, 1))));
  const discount = (i, t, pod) => { plan[i * 3 + t] *= 1 - pod; };
  // A line switched off as a precaution can't charge anyone, but one package parked on it on
  // purpose sees the switching back: the current returns and it charges, or the fault current
  // shows the fault is still there.
  const witnessLine = (line) => lineState[line] === "dead" && !lockedOut.has(line)
    && !byLine[line].some((i) => dispatched.has(i))
    && !packages.some((k) => k.witness === line || (k.flying && spans[k.landing].line === line));

  // A landing is also where the package waits out three hours of charging, so it's a standby
  // choice as much as the k-medoids one before the storm. Gradual covering (Berman, Krass and
  // Drezner 2003): a package m minutes from a span covers it by 1 - m / budget, the share of a
  // flight it would have left once there. A landing is worth the risk it covers that the rest of
  // the fleet, where it is or will land, doesn't cover already. So packages spread out over what
  // hasn't been ruled out yet, and two never wait side by side. The risk includes what a typical
  // storm here brings, the k-medoids weights, so once this storm is cleared they still spread out
  // ready for the next one.
  function readiness(taken) {
    const risk = [];
    for (let i = 0; i < n; i++) { const w = patrolValue(i) + placed.weight[i]; if (w > 1e-4) risk.push([i, w]); }
    const covered = new Float64Array(n);
    for (const k of taken) for (const [i] of risk) covered[i] = Math.max(covered[i], 1 - minutes(k, i) / budget);
    return (l) => {
      let gain = 0;
      for (const [i, w] of risk) gain += w * Math.max(0, 1 - minutes(l, i) / budget - covered[i]);
      return gain;
    };
  }

  function bestFlight(pkg, taken, left = budget, from = pkg.xy) {
    const values = Float64Array.from({ length: n }, (_, i) => patrolValue(i));
    const ready = readiness(taken);
    const landings = [];
    // perchVal ranks the landings, cover included, so each run ends at the best place to wait.
    // find is what the perch itself sees: runs are compared on what they find, never on cover.
    const perchVal = new Float64Array(n);
    const find = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (taken.has(i) || (!pkg.flying && i === pkg.span) || !(canLand(i) || witnessLine(spans[i].line))) continue;
      if ([...taken].some((k) => minutes(k, i) * speed < SPACING_M)) continue;
      landings.push(i);
      find[i] = perchValue(i) + (canLand(i) ? 0 : WITNESS_VALUE);
      perchVal[i] = find[i] + ready(i);
    }
    landings.sort((a, b) => perchVal[b] - perchVal[a]);
    // The best landing within reach of a point. Per point, keep only the landings closer than
    // every better one: the first of those in reach is the best in reach, whatever the battery.
    const frontier = new Map();
    const landFrom = (key, point, minutes) => {
      if (!frontier.has(key)) {
        const list = [];
        let closest = Infinity;
        for (const i of landings) {
          const m = dist(point, mid[i]) / speed;
          if (m < closest) { list.push([i, m]); closest = m; }
        }
        frontier.set(key, list);
      }
      for (const [i, m] of frontier.get(key)) if (m <= minutes) return i;
      return -1;
    };

    let best = null;
    const stay = landFrom("here", from, left);
    if (stay >= 0) best = { value: find[stay], found: find[stay], run: [], dir: 1, start: from, end: from, landing: stay, minutes: dist(from, mid[stay]) / speed };
    for (const [line, list] of Object.entries(byLine)) {
      const off = restorable(line);
      const survive0 = off ? sum(list.map((i) => Math.log(1 - spanP(i, false)))) : 0;
      const doubtful = off && 1 - Math.exp(survive0) > params.reenergizeBelow;
      for (let a = 0; a < list.length; a++) {
        for (const dir of [1, -1]) {
          let survive = survive0;
          let restored = 0;
          const start = ends[list[a]][dir > 0 ? 0 : 1];
          const reach = dist(from, start) / speed;
          if (reach > left) continue;
          let length = 0;
          let value = 0;
          let found = 0;    // the same without the discount: what the flight finds, whenever
          for (let b = a; b >= 0 && b < list.length; b += dir) {
            const i = list[b];
            length += spans[i].length_m;
            const minutes = reach + length / speed;
            if (minutes > left) break;
            // the sooner a fault is seen, the sooner the crew goes: a look at the end of the
            // battery is worth half one at the start, as search theory scores time to detection
            value += values[i] * (1 - minutes / (2 * budget));
            found += values[i];
            if (doubtful && !restored) {
              survive += Math.log(1 - spanP(i, true)) - Math.log(1 - spanP(i, false));
              if (1 - Math.exp(survive) <= params.reenergizeBelow) {
                restored = params.restoreValue;
                value += restored * (1 - minutes / (2 * budget));
                found += restored;
              }
            }
            const end = ends[i][dir > 0 ? 1 : 0];
            const l = landFrom(`${i}:${dir}`, end, left - minutes);
            if (l < 0) continue;
            const total = minutes + dist(end, mid[l]) / speed;
            // equal value, the shorter flight: a span already flown is worth nothing, not a detour
            if (best && (value + find[l] < best.value || (value + find[l] === best.value && total >= best.minutes))) continue;
            best = { value: value + find[l], found: found + find[l], line, a, b, dir, start, end, landing: l, minutes: total };
          }
        }
      }
    }
    if (best?.line) {
      const list = byLine[best.line];
      best.run = [];
      for (let b = best.a; b !== best.b + best.dir; b += best.dir) best.run.push(list[b]);
    }
    return best && { ...best, runValues: best.run.map((i) => [i, values[i]]), landingValue: perchVal[best.landing],
                     cover: ready(best.landing), search: best.found, witness: !canLand(best.landing) };
  }

  function planRound(when) {
    const ready = packages.filter((k) => !k.stranded && !k.flying && k.readyAt <= when);
    if (!ready.length) return;
    const taken = freshPlan();
    const left = [...ready];
    while (left.length) {
      const options = left.map((k) => ({ pkg: k, flight: bestFlight(k, new Set([...taken].filter((i) => i !== k.span))) }))
        .filter((o) => o.flight);
      // Cover picks where a package waits, not whether it goes: whether a flight is worth three
      // hours of charging, and who goes first, is down to what it can find.
      const pick = options.sort((a, b) => b.flight.search - a.flight.search)[0];
      if (!pick || pick.flight.search < params.minFlightValue) {
        for (const k of left) {
          if (!k.holding) log({ t: when, kind: "hold", pkg: k.id, span: spans[k.span].id, value: pick?.flight.search ?? 0 });
          k.holding = true;
        }
        return;
      }
      left.splice(left.indexOf(pick.pkg), 1);
      const { flight } = pick;
      taken.delete(pick.pkg.span);
      taken.add(flight.landing);
      // the others it was weighed against, for the timeline to say why this one
      flight.rivals = options.filter((o) => o !== pick).map((o) => ({ pkg: o.pkg.id, value: o.flight.search }));
      listened.add(spans[flight.landing].line);
      // one look per span per round: two packages over the same span at once see the same thing
      for (const i of flight.run) KINDS.forEach((_, t) => discount(i, t, 1));
      KINDS.forEach((kind, t) => discount(flight.landing, t, POD.perch[kind]));
      fly(pick.pkg, flight, when);
    }
  }

  const queue = [];
  const at = (t, run) => { queue.push({ t, run }); queue.sort((a, b) => a.t - b.t); };

  // Receding horizon: a flight is planned whole, but after each span the drone checks whether the
  // map has changed since it last planned, and if so plans again from where it is with the
  // battery it has left. With no news it carries on as planned.
  function retask(pkg, when) {
    pkg.planNews = news;
    const left = budget - (when - pkg.departed - params.overheadMin / 2);
    const taken = freshPlan(pkg);
    // what it has already flown over on this flight isn't worth turning back for
    for (const i of pkg.covered) KINDS.forEach((_, t) => discount(i, t, 1));
    const flight = bestFlight(pkg, taken, left, pkg.pos);
    const ahead = pkg.run.slice(pkg.done);
    // no plan reachable, or the best plan is the one it's on: keep going
    if (!flight || (flight.landing === pkg.landing && flight.run.join() === ahead.join())) return;
    fly(pkg, flight, when, left, flight.run.join() === ahead.join());
  }

  function fly(pkg, flight, when, left, sameRun = false) {
    const airborne = left !== undefined;
    const id = (pkg.flightId ?? 0) + 1;
    const depart = airborne ? pkg.departed : when;
    const from = airborne ? pkg.pos : pkg.xy;
    const flown = airborne ? pkg.flown : [pkg.lonlat];
    const off = airborne ? when : when + params.overheadMin / 2;
    let t = off + dist(from, flight.start) / speed;
    const path = [...flown];
    const looks = [];
    // where it will be and when, for the map to move it between events: [lon, lat, minute]
    const track = [[...(airborne ? pkg.at : pkg.lonlat), off]];
    flight.run.forEach((i, j) => {
      const s = spans[i];
      if (j === 0) { path.push(flight.dir > 0 ? s.lonlat[0] : s.lonlat[1]); track.push([...path.at(-1), t]); }
      t += s.length_m / speed;
      looks.push([i, t]);
      path.push(flight.dir > 0 ? s.lonlat[1] : s.lonlat[0]);
      track.push([...path.at(-1), t]);
    });
    const arrive = (airborne ? when + params.overheadMin / 2 : depart + params.overheadMin) + flight.minutes;
    path.push(midLonLat[flight.landing]);
    track.push([...midLonLat[flight.landing], arrive - params.overheadMin / 2]);
    Object.assign(pkg, { flying: true, holding: false, landing: flight.landing, run: flight.run, done: 0, readyAt: Infinity,
                         path, flown, at: airborne ? pkg.at : pkg.lonlat, pos: from, flightId: id, departed: depart, planNews: news,
                         covered: airborne ? pkg.covered : new Set() });
    const why = [...flight.runValues].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i, v]) => ({ span: spans[i].id, value: v }));
    log({ t: when, kind: "flight", retask: airborne, sameRun, left, because: airborne ? latest : null, pkg: pkg.id, from: spans[pkg.span].id, run: flight.run.map((i) => spans[i].id),
          landing: spans[flight.landing].id, depart, arrive, value: flight.value, why, path, track,
          runValue: sum(flight.runValues.map(([, v]) => v)), landingValue: flight.landingValue, cover: flight.cover, search: flight.search,
          rivals: flight.rivals ?? [], witness: flight.witness });
    const seen = new Set();
    for (const [i, time] of looks) {
      at(time, () => {
        if (pkg.flightId !== id) return;   // replaced by a newer plan
        const line = spans[i].line;
        const end = flight.dir > 0 ? 1 : 0;
        Object.assign(pkg, { at: spans[i].lonlat[end], pos: ends[i][end], done: pkg.done + 1 });
        pkg.flown.push(pkg.at);
        if (!seen.has(line)) { seen.add(line); reveal(line, time, pkg.id, "passed close"); }
        const live = lineState[line] === "live";
        const before = pSpan(i);
        KINDS.forEach((kind, t2) => look(i, t2, "patrol", t2 === 1 && !live ? POD.deadDamage : POD.patrol[kind], time, pkg.id));
        // done unless it saw something: an unclear span is worth turning back for
        if (pSpan(i) <= before) pkg.covered.add(i);
        decide(time);
        if (pkg.planNews === news) return;
        // news: whoever is holding reacts, and this drone reconsiders its own flight
        if (params.replan) retask(pkg, time);
        planRound(time);
      });
    }
    at(arrive, () => { if (pkg.flightId === id) land(pkg, flight.landing, arrive, path, flight.witness); });
  }

  function land(pkg, i, when, path, witness) {
    // the line may have come back on while it was in the air, then it just charges
    if (witness && lineState[spans[i].line] !== "dead") witness = false;
    if (witness) {
      Object.assign(pkg, { flying: false, span: i, xy: mid[i], lonlat: midLonLat[i], witness: spans[i].line, flights: pkg.flights + 1 });
      log({ t: when, kind: "land", pkg: pkg.id, span: spans[i].id, witness: spans[i].line, readyAt: Infinity });
      perch(pkg, i, when);
      decide(when);
      planRound(when);
      return;
    }
    let spot = i;
    if (truthDead(spans[i].line)) {
      // charging didn't start, so the reserve takes it to the nearest line that's live
      reveal(spans[i].line, when, pkg.id, "charging didn't start");
      const alternate = nearby[i].filter((j) => !truthDead(spans[j].line) && !railway(spans[j].line))
        .sort((a, b) => dist(mid[i], mid[a]) - dist(mid[i], mid[b]))[0];
      if (alternate === undefined) {
        Object.assign(pkg, { flying: false, stranded: true, span: i, xy: mid[i], lonlat: midLonLat[i] });
        log({ t: when, kind: "stranded", pkg: pkg.id, span: spans[i].id });
        return;
      }
      spot = alternate;
      when += dist(mid[i], mid[spot]) / speed;
      path.push(midLonLat[spot]);
    }
    Object.assign(pkg, { flying: false, span: spot, xy: mid[spot], lonlat: midLonLat[spot], readyAt: when + params.chargeMin, flights: pkg.flights + 1 });
    log({ t: when, kind: "land", pkg: pkg.id, span: spans[spot].id, readyAt: pkg.readyAt });
    perch(pkg, spot, when);
    decide(when);
    planRound(when);
    at(pkg.readyAt, () => planRound(pkg.readyAt));
  }

  // In the walk-through the operator takes the advice. A fault still on the line trips it again,
  // and the witness logs the fault current, so the line is known to hold one.
  function switchOn(line, when) {
    const witnesses = packages.filter((k) => k.witness === line).map((k) => k.id);
    if ([...faults.keys()].some((key) => key.startsWith(`${line}/`))) {
      lockedOut.add(line);
      lineTo(line, [0, 1], LOCKOUT);
      log({ t: when, kind: "switch", line, outcome: "tripped", witnesses, hypothetical: true });
      return;
    }
    lineState[line] = "live";
    for (const k of packages.filter((q) => q.witness === line)) {
      Object.assign(k, { witness: null, readyAt: when + params.chargeMin });
      at(k.readyAt, () => planRound(k.readyAt));
    }
    log({ t: when, kind: "switch", line, outcome: "live", witnesses, hypothetical: true });
  }

  function decide(when) {
    for (let i = 0; i < n; i++) {
      if (dispatched.has(i) || pSpan(i) < params.dispatchAt) continue;
      dispatched.add(i);
      const t = [0, 1, 2].sort((a, b) => p(i, b) - p(i, a))[0];
      explain(i, t);
      log({ t: when, kind: "decision", action: "dispatch", span: spans[i].id, line: spans[i].line, fault: KINDS[t], p: pSpan(i) });
    }
    for (const [line, list] of Object.entries(byLine)) {
      if (lineState[line] !== "dead") continue;
      const blocked = list.some((i) => dispatched.has(i));
      const left = 1 - list.reduce((a, i) => a * (1 - pSpan(i)), 1);
      const key = `${line}|${blocked ? "repair" : "energize"}`;
      if (announced.has(key) || (!blocked && left > params.reenergizeBelow)) continue;
      announced.add(key);
      log({ t: when, kind: "decision", action: blocked ? "repair" : "reenergize", line, p: left });
      if (!blocked) at(when + 5, () => switchOn(line, when + 5));
    }
    for (const rid of active) {
      const left = reportLeft(rid);
      if (announced.has(rid) || left > params.standDownBelow) continue;
      announced.add(rid);
      log({ t: when, kind: "decision", action: "standdown", report: rid, p: left });
    }
  }

  // Before the storm the five wait at substations, placed by standby() below.
  const placed = standby(spans, wind, params);
  placed.chosen.forEach((c, k) => {
    packages.push({ id: `D${k + 1}`, span: c, xy: mid[c], lonlat: midLonLat[c], readyAt: params.startMin,
                    flying: false, stranded: false, flights: 0, standby: spans[c].nodes.find((id) => id.startsWith("SUBSTATION")) });
  });

  const start = params.startMin;
  log({ t: start, kind: "start", standby: packages.map((k) => ({ pkg: k.id, span: spans[k.span].id, substation: k.standby })),
        sites: placed.sites.length, avgMinutes: placed.avgMinutes });
  for (const k of packages) perch(k, k.span, start);
  // the cheapest sensor there is: a phone call to the site with the generator
  if (truth.call && active.includes("SYN_REPORT_04")) {
    const generator = truth.call === "generator";
    for (let i = 0; i < n; i++) if (spans[i].reports.includes("SYN_REPORT_04")) for (const t of [1, 2]) scale(i, t, generator ? 0.1 : 4);
    log({ t: start + 5, kind: "call", report: "SYN_REPORT_04", outcome: truth.call, hypothetical: true });
  }
  decide(start + 5);
  at(start + 5, () => planRound(start + 5));

  const end = start + params.hoursAhead * 60 + params.flightMin;
  while (queue.length && queue[0].t <= end) queue.shift().run();
  log({ t: end, kind: "end" });

  return { events, prior: { fall, from }, byLine, standby: placed };
}

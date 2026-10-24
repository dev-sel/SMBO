# SMBO

Our entry to the Nomadic challenge "Keeping the Power Flowing". A storm has passed over a real
section of the high-voltage grid south-west of Augsburg, six vague reports are in, one line is
switched off, and five sensor packages can perch on the wires and fly between them: 30 minutes
of flight, then 3 hours on a live line to charge. This repository decides where they go, what
they look for, and when the evidence is enough to act.

The storm, the reports and every observation marked hypothetical are made up. The grid, the
trees and the wind are real.

## The answer in four lines

- **What we measure.** On the wire: voltage and current, motion and sag, temperature. Along it:
  camera, thermal, LiDAR. Charging is itself a measurement: a package that lands knows whether
  the line is live.
- **Where we look first.** Where trees tall enough to reach a wire stand on the side this storm
  threw them, weighted by what each report could mean. The five wait out a storm at substations.
- **What happens next.** Every look updates the chance of a fault on every span (Bayes, the way
  search and rescue plans a search), and every package that can fly takes the flight that
  finds the most for its 30 minutes, or holds with a full battery to answer the next finding.
- **When we act.** A crew at 80 % sure. A line back on under 25 % doubt, with a package on it
  as a witness. A report stood down under 5 % of its weight. Between those, more evidence.

## Run it

```bash
pip install -r requirements.txt
npm --prefix web ci
npm --prefix web run dev
```

Open http://localhost:5173. The app reads static files in `web/public/data`, which are in git,
so this is all it needs. It opens on a short intro to the problem. Step through with the arrow
keys or the timeline. The tabs replay the four hours against a different made-up truth each, and
**Settings** has every number we chose.

To rebuild the data from the sources (about 2 GB, a few minutes):

```bash
python -m vigi.fetch
python -m vigi.build
python -m vigi.canopy
```

For a presentation, serve the production build rather than the dev server:

```bash
npm --prefix web run build
npm --prefix web run preview -- --port 5173
```

`web/src/tokens.css` has a `zoom` knob for the whole UI, 1.5 now for a 14 inch laptop. Lower it on a projector.

## What's where

| path | what it is |
|---|---|
| `nomadic_folder/participant_package/` | the organisers' grid, nodes and reports, untouched |
| `vigi/grid.py` | the package as 744 spans, tower to tower, in UTM 32 |
| `vigi/trees.py` | which surveyed trees can fall onto which span, per fall direction |
| `vigi/wind.py` | DWD's 10 minute gusts at Augsburg, and the gust front we borrow |
| `vigi/elevation.py`, `vigi/canopy.py` | DOM20 minus DGM1 on the ten riskiest spans |
| `vigi/build.py` | writes `web/public/data` |
| `vigi/fetch.py` | downloads everything under `data/` |
| `web/src/engine.js` | the planner: prior, sensors, Bayes, flights, decisions |
| `web/src/words.js` | every event as a sentence |
| `web/src/components/` | map, timeline, board, drawers |

## The data

| source | what we use it for | licence |
|---|---|---|
| participant package | 64 lines, 59 nodes, six reports, the storm footprint | ODbL (grid), organisers (scenario) |
| [Bavarian survey, Einzelbäume](https://geodaten.bayern.de/opengeodata/) | every tree with its height, 6 lots, 2.1 GB, every line covered | CC BY 4.0 |
| Bavarian survey, DOM20 and DGM1 | our own canopy model on the ten riskiest spans, 9 tiles, 455 MB | CC BY 4.0 |
| Bavarian survey, web map and photos | the map background: grey map, aerial, colour infrared | CC BY 4.0 |
| [DWD](https://opendata.dwd.de/) station 232 Augsburg | 10 minute gusts and directions, 1996 to 2025 | CC BY 4.0 |

The first tile we downloaded, `636_5344.tif`, is DGM1 at 1 m, south-west corner 636000 E,
5344000 N in EPSG:25832. It sits on SUBSTATION_07, Oberottmarshausen, the dense knot in the
package's detail map. Any DGM1 tile is `download1.bayernwolke.de/a/dgm/dgm1/{E}_{N}.tif`, with
E and N the corner in km. A 50 m corridor around all 64 lines touches 254 of them.

## What the data says

Measured, not assumed.

- **744 spans.** OSM puts a vertex at every tower, a median 274 m apart.
- **268 trees can reach a wire**, from 15 m out, on 57 spans. **197 of them stand along
  LINE_024**, the line switched off "as a precaution". It runs through the Westliche Wälder
  forest. The data explains the operator's caution.
- **LINE_024 is hard to reach.** 15 km of it is more than 3 km from any other line, the worst
  point 5.9 km. A package can't charge on it, so a patrol there has to end on another line, or
  stay as a witness.
- **Two weak reports overlap on LINE_026**: inside R02 (6.4 of its 10.8 km) and R03 (all of it).
  Its span 3 has 8 trees that can reach the wire.
- **The survey leaves out 15 m either side of every high-voltage line.** No tree point closer
  than 15.0 m to any of the 64 lines, then three times the usual density between 15 and 16 m:
  the survey masked the corridor before it looked for trees, and crowns cut by the mask landed on
  its edge.
- **The survey's heights are right.** Against our own DOM20 minus DGM1, the median difference is
  0.0 to 0.2 m, 86 to 95 % of trees within 2 m.
- **Its counts are a floor.** On the ten riskiest spans, 61 % of the canopy that could reach a
  wire (9,850 of 16,066 m²) stands inside the 15 m it leaves out.
- **Storms here come from the west south west.** The 15 strongest gust days at Augsburg since
  1996 had their damaging gusts from a median 230 to 290 degrees.
- **The gust front we borrow**, 11 July 2023: 32.9 m/s from 230 degrees, under 12 m/s again
  50 minutes later.
- **LINE_009, 010 and 011 are DB Energie**, railway power at 16.7 Hz. A harvester built for
  50 Hz gets a third of the voltage, so we don't plan to charge there.

## How the planner works

All in `web/src/engine.js`, run in the browser so any change re-plans in about a third of a
second.

**Three kinds of fault per span**: a tree on the wire, a damaged wire or joint, a wire too low
or swinging. Each carries an expected number of faults, kept per source so a finding can
explain a report away. A chance is 1 - exp(-expected).

**The prior.**
- Trees: for each tree that can reach the lowest wire falling in each of 36 directions, times
  where this storm threw trees (downwind of each damaging gust, spread 25 degrees), times the
  chance one such tree falls.
- A background per km for faults nobody points at, so no span is ever at zero.
- Each report adds its confidence as expected faults inside its area, shared out by what it
  could be describing: trees for R02, span length and wind across the span for R06, length for
  R05.

**The reach rule.** A falling tree pivots at its foot and sweeps everything within its height,
so it reaches the wire if it's taller than its 3D distance to it: along its fall to under the
wire, and the wire's height there. The wire is assumed 12 m up mid span and 20 m at the towers
for 110 kV, 15 and 30 m for 380 kV, a parabola between.

**Looks.** Each look has a detection rate per kind of fault (table below). Nothing seen lowers
the chance by that rate, never to zero. Something found raises it by detection over false
alarm. Listening to a line's current for arcing is line-wide evidence: it raises the odds that
something on the line is damaged, but says nothing about where.

**Lines.** LINE_024 is off. Lines mostly inside R03 are in doubt. A package that lands or passes
close learns the state. A line in doubt found dead was locked out by the protection, so
something on it is 85 % sure. Charging only on lines that are live or assumed live, never on a
line in doubt, never on railway power.

**Flights.** For every drone that can fly: every run of consecutive spans on one line it can
patrol and still land, plus where it lands. Two questions, kept apart:

- **Which run, and is it worth flying?** What it expects to find. Each look is worth less the
  later it comes in the flight, down to half at the end of the battery, because a fault seen
  sooner sends the crew sooner. A run that takes a switched-off line's doubt under the 25 % bar
  for switching it back on also earns the power it brings back, worth one fault found (a
  setting). Below 0.1 expected faults a drone holds, with a full battery for the next finding.
- **Where does it wait?** It sits there three hours, so the landing is a standby choice like
  the k-medoids one, made again after every flight. Gradual covering (Berman, Krass and Drezner,
  2003): a drone m minutes from a span covers it by 1 - m / 22, the share of a flight it would
  have left once there. A landing is worth the risk it covers that the rest of the fleet
  doesn't, counting what's left of this storm and what a typical storm here brings. No drone
  waits within 2 km of another.

Cover never decides what gets searched, only where the search ends. The best flight across the
fleet goes first, its spans and landing are claimed, then the next. A flight keeps 6 minutes for
an alternate landing. A span counts as searched only if the look found nothing, so a drone
turns back for an unclear reading.

## How the planner reacts to events

No drone is assigned to a line. Every decision looks at the whole network: which runs of spans,
on any line, a drone can still fly and land after. What used to be static was time: a drone
committed to its whole flight at take-off and couldn't react to anything until it landed. In the
walk-through P2 found the tree on LINE_026 span 3 at T+2:07, which explained the line's trip and
both reports, then spent the rest of its battery on 45 more spans of that line worth 0.06
expected faults, while single spans elsewhere were worth 0.12 to 0.20.

The planner is now three known pieces, and only the third is new:

1. **Bayesian search** (Koopman, 1946; Stone, *Theory of Optimal Search*, 1975; the method that
   found Air France 447 in 2011). A chance of a fault on every span, for each kind. A report adds
   only as much as its confidence, so none is treated as a confirmed fault. A look that finds
   nothing lowers the chance by the sensor's detection rate, a find raises it by detection over
   false alarm.
2. **Greedy assignment with claims.** The expected number of faults a set of looks finds has
   diminishing returns: a second drone over the same span adds less than the first. That makes it
   *submodular*, and picking the best flight, claiming its spans and repeating is guaranteed to
   reach at least 63 % (1 - 1/e) of the best possible set (Nemhauser, Wolsey and Fisher, 1978).
   The Hungarian algorithm or an auction would need each drone and task to have a value of its
   own, which overlapping patrols don't.
3. **Receding horizon** (the idea behind model predictive control). Plan a whole flight, commit
   only to the next span. Whenever the probability map changes, a find, an unclear reading, a
   line found dead or cleared, a switching, every drone that can act plans again: drones on a
   wire with a full battery, and drones in the air from where they are with the minutes they
   have left. With no news nothing is re-planned, so a quiet storm costs nothing extra.

That covers what an event-driven dispatcher needs without a rule of its own. **Priority and
confidence** are the chance of a fault times the chance the sensor sees it. **Location** is the
flight time, which decides what fits in the battery. **Availability** is the battery and the
3 hour charge. **Current assignments** are the claimed spans. Each change of plan in the timeline
says what prompted it. `retask()` in `engine.js`, and `replan: false` gives the old behaviour.

### Did it help?

`node web/src/evaluate.js 200` runs both planners on the same storms. Minutes are from T+2:00 to
the crew, a fault never found counts as the whole 270 minute window.

| scenario (one tab each in the app) | committed | re-planning |
|---|---|---|
| walk-through: tree on LINE_026 span 3, joint on LINE_036 span 14 | 111 min | 15 min |
| R02 alone: tree on LINE_026 span 3 | 7 min | 7 min |
| R03 alone: tree on LINE_024 span 45 | 18 min | 18 min |
| R04 alone: damaged wire on LINE_037 span 13 | 12 min | 10 min |
| R05 alone: the joint on LINE_036 span 14 | 76 min | 72 min |
| R06 alone: LINE_054 span 26 hangs too low | 31 min | 11 min |
| false alarm: LINE_024 back on | after 214 min | after 48 min |
| a tree nobody reported | missed | missed |

A report tab plays that report as if it were the only one that came in. The walk-through, the
false alarm and the unreported tree have all six.

| 200 storms drawn from the prior | committed | re-planning |
|---|---|---|
| faults found | 415 of 647, 64 % | 430 of 647, 66 % |
| found in the first hour | 306 | 403 |
| mean minutes to a crew | 138 | 109 |
| crews sent to a span with nothing on it | 0 | 0 |
| drones stranded | 0 | 0 |

Re-planning was faster in 120 storms and slower in 9. It finds about the same number of faults
in four hours, but a third more of them in the first hour, half an hour sooner on average. What
made the difference, beyond re-planning itself: a look counts for more the earlier it comes, a
drone turns back for an unclear reading instead of treating the span as searched, and a flight
that clears a switched-off line earns the power it brings back. The objective still has no
customer numbers per line; with them, a line's outage minutes would join the value.

**The witness.** A package may end a patrol perched on LINE_024 on purpose. It gives up its next
flight until the line is back, so it costs the value of a flight. When the line is switched on
it sees the current return and charges, or logs the fault current if something is still there.

**Standby: k-medoids.** Before the storm the five wait at substations, where a crew can reach
them. Choosing which is the p-median problem (Hakimi, 1964), solved with PAM, the k-medoids
algorithm (Kaufman and Rousseeuw, 1987): k-means where each centre must be a real substation.
Every span is weighted by the faults a typical storm here leaves on it (trees that can reach
its wire, falling the way the 15 strongest days since 1996 blew, plus the background). The
cost is each span's weight times its flight time to the nearest package. PAM adds substations
one at a time, then swaps while a swap lowers the cost. `standby()` in `engine.js`.

| method | substations | average flight to the risk | risk within 10 min |
|---|---|---|---|
| k-medoids (used) | 03, 05, 08, 11, 12 | 7.3 min | 72 % |
| max coverage, 10 min | 02, 04, 05, 08, 11 | 7.6 min | 73 % |
| k-centre, worst case | 01, 06, 09, 11, 14 | 10.3 min | 36 % |

With 15 substations there are only 3,003 ways to pick five, so `engine.test.js` checks them
all and fails if PAM's answer isn't the best. "Who covers what" on the map colours each span
by the package nearest to it.

## Assumptions

The ones worth arguing about are sliders under **Settings**, the rest are listed there as fixed.

| | value | why |
|---|---|---|
| flight, charge | 30 min, 3 h | the brief |
| start | T+2:00, full battery, at standby | all six reports in; the last came at T+1:51 |
| speed | 16 m/s, the same getting there and inspecting | ours, the brief asks us to state it |
| reserve, take off and clamp on | 6 min, 2 min | an alternate landing if a line won't charge |
| flight limit | 10 m/s gusts | the NOMAD's stated wind limit, 36 km/h. Flyable from T+0:50 |
| chance one reaching tree falls | 2 % | about one to two trees on wires across the network |
| fall spread | 25 degrees | trees fall downwind, give or take |
| other faults | 0.003 per km in the footprint | faults nobody points at |
| report confidence | R02 35 %, R03 60 %, R04 15 %, R05 30 %, R06 20 % | from each report's own words |
| detection, patrol | tree 90 %, damage 60 % (35 % on a dead line), clearance 70 % | thermal needs current |
| detection, perch | tree 60 %, damage 60 %, clearance 85 %; next spans 30 / 20 / 10 % | |
| listening for arcing | 40 % of damage on the line, odds times 8 when heard | corona sounds alike |
| crew, line back, stand down, hold | 80 %, under 25 %, under 5 %, 0.1 faults | |

## The walk-through

With the default fictional truth, a spruce on LINE_026 span 3, a cracked joint on LINE_036
span 14, LINE_026 locked out and a generator test at the R04 site:

| time | what happens |
|---|---|
| T+0:00 | the storm's peak gust. The five wait it out on substations |
| T+0:12 to T+1:51 | the six reports arrive, R03 with LINE_024 switched off |
| T+2:05 | a phone call: the R04 site logged a generator test, R04 closed without a flight. D1 patrols LINE_024's forest, D2 LINE_026, D4 LINE_004, D5 LINE_054 under R06. D3 holds |
| T+2:06 | D2 finds LINE_026 dead: the protection locked it out |
| T+2:07 | D2 sees the tree on span 3, 99 %. Crew sent, R02 closed. D2 re-plans in the air towards R05 |
| T+2:20 | LINE_024 searched, under 25 % doubt: switch it back on. R03 closed |
| T+2:22 | D2 sees what could be a hot joint on LINE_036 span 14: 15 %, unclear. It turns back for a second look: 92 %. Crew sent, R05 closed |
| T+2:25 | LINE_024 holds. D3 takes off to search the rest of it |
| T+2:29 to T+2:49 | all five land at least 2 km apart: LINE_064, LINE_002, LINE_054, and two on LINE_024's 26 km |
| T+5:29 on | charged, but nothing left is worth three hours of charging, so they hold where they cover the most |

Open at the end: R06 with 11 % left, a low confidence report over 17 km of line. Everything
else is closed.

## Limitations

- **The planner looks one flight ahead.** Where a package waits is part of each flight's value,
  but it never plans two flights together, say a reposition now for a search later.
- **Wire heights are assumed** and the ground is taken as flat between tree and wire.
  LINE_024 span 37's ground falls 18 m along the span.
- **The mapped lines can be metres off.** Which trees are inside the 15 m strip is only as good
  as the mapping. A package's LiDAR measures the real clearance.
- **The survey leaves out the 15 m strip**, and our canopy model only covers ten spans. The
  prior counts the trees beyond 15 m only.
- **Outcomes are deterministic.** A look over 50 % detection finds what's there, one under
  misses it. A random draw per look would show the spread over many storms.
- **No network topology.** The package says nothing about which lines feed which, so a dead line
  doesn't tell us what else is dead.

## What we'd test next

1. A package on a real 110 kV line: does the harvester charge in 3 hours at this load, and what
   does an arcing joint look like in the current next to corona on a wet day.
2. The whole corridor's DOM20, 254 tiles, so the prior counts canopy in the strip, not just
   survey points beyond it.
3. Two-flight planning, so a reserve repositions toward where it will be needed.
4. Replay a real storm against real outage records: did the prior put the faults near the top?
5. Wire heights from tower drawings, ground from DGM1 along every span.

## Tests

```bash
python -m vigi.grid && python -m vigi.trees && python -m vigi.wind && python -m vigi.elevation
node --test web/src/engine.test.js
```

Each Python module checks itself against numbers worked out separately. The planner test runs
the walk-through on the real package: both faults found, LINE_024 back, no flight over its
budget or before its charge, nobody stranded, and two what-ifs.

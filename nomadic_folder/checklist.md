# Deliverables checklist

Every item in `challenge.md`, where we answer it, and what's still missing. Checked on
24 October 2026 against the code as it is now. **App** is the dashboard, **README** is
`docs/README.md`, **deck** is the slides artifact.

## What to deliver

### 1. What would you measure? What can the readings tell, and what can't they?

Partly done. The app and README name the sensors, but nowhere says plainly what each one
can't tell us. This table is the answer, and it should go into the README and the deck:

| reading | tells us | can't tell us |
|---|---|---|
| camera, flying along the span | a tree or branch on the wire (90 % of the time, assumed) | a tree that is leaning but hasn't fallen, or anything hidden by canopy |
| thermal, flying along the span | a joint running hot (60 %) | anything on a dead line: no current, no heat (35 %) |
| sag and angle, perched (inclinometer) | the span it sits on hangs too low or swings (85 %) | the spans either side, only a glance at those (10 %) |
| line current, perched | something on the line is arcing (40 % of damage on the line) | which span it is, and wet insulators sound alike |
| charging | whether the line is live | why a dead line is dead |

**Decision needed.** Nomadic's own page lists an RGB camera, accelerometers, inclinometers and
on-conductor current and temperature. It doesn't list a thermal camera or LiDAR. Our walk-through
finds the joint with a thermal camera in flight, and the planner measures clearance from the
air (70 %) as if it had LiDAR. Either we say we add both to the 3.8 kg drone, or the joint is
found by the RGB camera and the current, and clearance only from a perch, at lower rates.

### 2. Where would you look first? Five packages, by line or node ID.

Done in the app, the README's number is out of date.

The five wait out the storm on these substations, chosen with k-medoids (PAM) over the 15 the
packages can reach, every span weighted by what a typical storm here leaves on it:

| package | perch | substation |
|---|---|---|
| P1 | LINE_056 span 17 | SUBSTATION_08 |
| P2 | LINE_025 span 1 | SUBSTATION_05 |
| P3 | LINE_053 span 1 | SUBSTATION_11 |
| P4 | LINE_033 span 5 | SUBSTATION_03 |
| P5 | LINE_054 span 37 | SUBSTATION_12 |

From there the average flight to the risk is 5.5 minutes and 93 % of it is within 10 minutes.
The README's table still says 7.3 minutes and 72 %, from before the speed was 16 m/s, and its
two other methods (max coverage, k-centre) need rerunning at 16 m/s too.

The first flights at T+2:05: P1 LINE_024 spans 15 to 58, P2 LINE_026 spans 1 to 48, P4 LINE_004
spans 33 to 1, P5 LINE_054 spans 37 to 1. P3 holds.

### 3. What happens next? A finding, an unclear reading, a lack of evidence, with the flight and charging limits.

Done in the app. The walk-through now shows all three:

- **A finding.** T+2:07, P2 sees the tree on LINE_026 span 3. 64 % to over 99 %, crew sent,
  R02 closed. LINE_026 stays off until the crew clears it.
- **An unclear reading.** T+2:21, P2's first look at LINE_036 span 14 takes a damaged joint
  from 0.3 % to 15 %. Not enough for a crew. P4 changes plan in the air, looks a minute later,
  92 %, crew sent.
- **A lack of evidence.** LINE_024 is searched by P1 and nothing turns up, so at T+2:21 the
  chance of a fault on it is under 25 %. It's switched back on, holds at T+2:26, and P4 charges
  on it.
- **The limits.** Every flight keeps 6 minutes for an alternate landing. Everyone lands by
  T+2:45, so nobody can fly again before T+5:29. The "dead landing" scenario shows a package
  whose line won't charge using its spare battery.

The README's walk-through table is from an older run (arcing heard at T+2:29, second wave at
T+5:29, P3 never flies). It needs rewriting from the app.

### 4. When would you act?

Done in the app and the README. A crew at 80 % sure, a dead line back on under 25 %, a report
closed under 5 %, and a package holds rather than flies for less than 0.1 expected faults.

Still weak: why these numbers. They're policy, not data. The argument to make on a slide: a
crew sent wrong costs a few hours, a line kept off costs every customer on it, so the bar to
switch a line back on is set low, and a failed attempt costs a fraction of a second because
the protection cuts it.

## What to present

| the brief asks for | where | status |
|---|---|---|
| a tool, map or simulation | the app | done |
| slides | the deck | to do: numbers are from before 16 m/s, R03 is in its old place, no re-planning story |
| one fictional example, walked through | the app's timeline | done, README and deck out of date |
| what it helps an operator decide | "What we've decided" in the app | done |
| assumptions | Settings in the app, README table | done |
| context for someone opening the link cold | the intro on load, About reopens it | done |
| more than one fictional example | a tab per scenario, each replays the four hours | done |
| limitations | README | done, but "P3 never flies" is no longer true |
| what we'd test next | README | done |

## Rules in the brief

| rule | status |
|---|---|
| Reports choose where to begin, they aren't faults | done: each adds only its confidence |
| Hypothetical observations clearly labelled | done: "Made up for the exercise" on each |
| State starting battery and speed | done: full battery at T+2:00, 16 m/s |
| Charge only on a live line | done: no charging on dead, doubtful or railway lines |
| Travel time, charging stops, sensor limits | done |
| Is `636_5344.tif` in the right place? | yes: DGM1, corner 636000 E 5344000 N, on SUBSTATION_07 |

## To do, in order

1. Decide on the thermal camera (section 1), since it changes the walk-through.
2. Rerun the standby comparison at 16 m/s, then update the README's standby table, walk-through
   and limitations. "Did it help?" is current: the 200-storm run on 24 October matched it.
3. Add the "tells us, can't tell us" table to the README.
4. Update the deck from the README.

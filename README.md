# SMBO: where five drones should look after a storm

Our entry to Nomadic's challenge, Keeping the Power Flowing. A storm has crossed 64
high-voltage lines south-west of Augsburg, six vague reports are in, and five line-charging
drones have to find the damage. SMBO plans where they fly and tells the operator when to act.

## See it

**Mac:** double-click `start.command`. If macOS says it's from an unidentified developer,
right-click it, choose Open, then Open again.

**Windows:** double-click `start.bat`.

Your browser opens at http://localhost:5173. Press **Play the walk-through**. Keep the window
that opened alongside it running while you look.

It needs Python 3 or Node.js to serve the page (a Mac with developer tools has Python already),
and an internet connection for the map tiles.

## Run it from the source

With Node.js 20 or newer:

```bash
npm --prefix web ci
npm --prefix web run dev
```

## What's where

- `docs/README.md`: the whole story. The answer to the brief, the data, how the planner works,
  every assumption with its reason, the walk-through, the limits and what we'd test next.
- `nomadic_folder/`: the brief, the organisers' package, and our checklist against the brief.
- `web/`: the app. `web/public/data` holds the prepared data it reads, `web/dist` a ready build.
- `vigi/`: the Python that turns the grid, the tree survey and the wind record into that data.
  Rebuilding it downloads about 2 GB, see `docs/README.md`.
- `make_zip.sh`: packs this folder into `SMBO.zip`.

The grid, every tree and the wind are real data. The storm, the reports and what the drones
find are made up for the exercise, and the app says so wherever they appear.

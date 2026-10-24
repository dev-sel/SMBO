# Inside the 15 m strip the tree survey leaves out. On the spans with the most trees in reach,
# canopy height = DOM20 surface minus DGM1 ground, and the survey's heights checked against it.
#
# The 20 cm surface is pooled to 1 m by the highest point in each metre, so a crown survives
# and a gap doesn't. A cell reaches the wire by the same rule as a surveyed tree, taken where
# the cell is. Crowns spread a few metres from the trunk, so that's generous by a few metres,
# the right side to err on for a spot check. Towers stand in the surface model like 30 m trees,
# so 12 m around each one is left out.
#
#   python -m vigi.canopy     needs data/dom20 and data/dgm1, writes web/public/data/spotcheck.json

import json
import math

import numpy as np

from vigi import grid, trees
from vigi.elevation import DGM1, DOM20, at, tiles, window

MARGIN_M = 60
TOWER_M = 12.0
STRIP_M = trees.SURVEY_GAP_M
REACH_M = 50.0
PROFILE_STEP_M = 5.0


def chm(west, north, size):
    # ground and canopy height at 1 m, NaN where either model has no data
    ground = window(DGM1, west, north, size)
    surface = window(DOM20, west, north, size)
    k = round(1 / tiles(DOM20)[0]["cell"])
    # all-NaN blocks are outside the delivery, nanmax would warn about each one
    with np.errstate(invalid="ignore"):
        blocks = surface.reshape(size, k, size, k)
        top = np.where(np.isnan(blocks).all(axis=(1, 3)), np.nan, np.nanmax(np.nan_to_num(blocks, nan=-1e9), axis=(1, 3)))
    return ground, np.clip(top - ground, 0, None)


def check(span, survey_heights):
    (x0, y0), (x1, y1) = span["xy"]
    west = math.floor(min(x0, x1) - MARGIN_M)
    north = math.ceil(max(y0, y1) + MARGIN_M)
    size = math.ceil(max(max(x0, x1) - west, north - min(y0, y1)) + MARGIN_M)
    ground, canopy = chm(west, north, size)

    xs = west + np.arange(size) + 0.5
    ys = north - np.arange(size) - 0.5
    gx, gy = np.meshgrid(xs, ys)
    d = np.array([x1 - x0, y1 - y0])
    t = np.clip(((gx - x0) * d[0] + (gy - y0) * d[1]) / (d @ d), 0, 1)
    off = np.hypot(gx - (x0 + t * d[0]), gy - (y0 + t * d[1]))
    tower = np.minimum(np.hypot(gx - x0, gy - y0), np.hypot(gx - x1, gy - y1)) < TOWER_M
    seen = np.isfinite(canopy) & ~tower
    reaches = seen & (canopy ** 2 >= off ** 2 + trees.wire_height(span["kv_low"], t) ** 2)
    strip = seen & (off < STRIP_M)

    return {
        "strip_canopy_m2": int((strip & (canopy >= 3)).sum()),
        "strip_max_m": round(float(np.nanmax(np.where(strip, canopy, np.nan))), 1) if strip.any() else None,
        "strip_reach_m2": int((reaches & (off < STRIP_M)).sum()),
        "beyond_reach_m2": int((reaches & (off >= STRIP_M) & (off <= REACH_M)).sum()),
        "survey_trees_reaching": span["trees_reaching"],
        "height_check": _heights(survey_heights, span, canopy, west, north),
        "profile": _profile(span, ground, canopy, off, seen, reaches, west, north),
    }


def _heights(survey, span, canopy, west, north):
    # each surveyed tree against the tallest canopy within 2 m of its point
    diffs = []
    for x, y, h in survey:
        c, r = int(x - west), int(north - y)
        patch = canopy[max(r - 2, 0):r + 3, max(c - 2, 0):c + 3]
        if patch.size and np.isfinite(patch).any():
            diffs.append(float(np.nanmax(patch)) - h)
    if not diffs:
        return None
    return {"trees": len(diffs), "median_m": round(float(np.median(diffs)), 1),
            "within_2m": round(float(np.mean(np.abs(diffs) <= 2)), 2)}


def _profile(span, ground, canopy, off, seen, reaches, west, north):
    # walking the span: the ground, the tallest canopy in the strip and within 50 m, and where any reaches
    (x0, y0), (x1, y1) = span["xy"]
    steps = max(2, int(span["length_m"] // PROFILE_STEP_M) + 1)
    out = {"step": span["length_m"] / (steps - 1), "ground": [], "strip": [], "near": [], "reaching": []}
    for k in range(steps):
        f = k / (steps - 1)
        sx, sy = x0 + f * (x1 - x0), y0 + f * (y1 - y0)
        c, r = int(sx - west), int(north - sy)
        r0, r1, c0, c1 = max(r - 50, 0), r + 51, max(c - 50, 0), c + 51
        here = np.hypot((np.arange(c0, min(c1, canopy.shape[1])) - c)[None, :],
                        (np.arange(r0, min(r1, canopy.shape[0])) - r)[:, None]) <= REACH_M
        block, seen_b, off_b = canopy[r0:r1, c0:c1], seen[r0:r1, c0:c1], off[r0:r1, c0:c1]
        g = ground[r, c] if 0 <= r < ground.shape[0] and 0 <= c < ground.shape[1] else np.nan
        strip_v = block[here & seen_b & (off_b < STRIP_M)]
        near_v = block[here & seen_b]
        out["ground"].append(None if np.isnan(g) else round(float(g), 1))
        out["strip"].append(round(float(g + strip_v.max()), 1) if strip_v.size and np.isfinite(g) else None)
        out["near"].append(round(float(g + near_v.max()), 1) if near_v.size and np.isfinite(g) else None)
        out["reaching"].append(bool((reaches[r0:r1, c0:c1] & here).any()))
    return out


def main():
    spans = grid.spans(grid.load())
    per_span, _, _ = trees.all_spans(spans)
    for s in spans:
        s.update(per_span[s["id"]])
    covered = [s for s in spans if all(at(DOM20, *p) for p in s["xy"])]
    top = sorted(covered, key=lambda s: -s["trees_reaching"])[:10]
    if not any(s["id"] == "LINE_026/3" for s in top):
        top += [s for s in covered if s["id"] == "LINE_026/3"]

    tables = trees._tables(trees.TREES)
    out = {}
    for s in top:
        points, heights = trees.near(s, tables)
        out[s["id"]] = check(s, [(x, y, h) for (x, y), h in zip(points, heights)])
        r = out[s["id"]]
        hc = r["height_check"] or {}
        print(f"{s['id']:12} survey {r['survey_trees_reaching']:3d} trees reach | strip: {r['strip_canopy_m2']:5d} m² canopy, "
              f"max {r['strip_max_m']} m, {r['strip_reach_m2']:4d} m² reaches | beyond 15 m: {r['beyond_reach_m2']:5d} m² reaches | "
              f"survey vs canopy: median {hc.get('median_m')} m, {hc.get('within_2m')} within 2 m")
    path = grid.ROOT / "web" / "public" / "data" / "spotcheck.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    strip = sum(r["strip_reach_m2"] for r in out.values())
    beyond = sum(r["beyond_reach_m2"] for r in out.values())
    print(f"{len(out)} spans checked: {strip} m² of reaching canopy inside the {STRIP_M:.0f} m strip, {beyond} m² beyond it "
          f"({strip / (strip + beyond):.0%} inside), {path.stat().st_size / 1024:.0f} kB")

    # measured on the first run: the survey's heights agree with this canopy model, and the
    # corridor under LINE_026/3 is cleared, so a wrong offset or a swapped model would show here
    assert all(abs(r["height_check"]["median_m"]) <= 0.5 for r in out.values())
    assert out["LINE_026/3"]["strip_max_m"] < 30 and out["LINE_026/3"]["strip_reach_m2"] < 200


if __name__ == "__main__":
    main()

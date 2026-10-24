# Which trees can fall onto which span, from the Bavarian survey's tree points (Einzelbäume).
# Every point comes with the tree's height above ground, so the test is plain geometry:
# a falling tree swings its full height around its foot, so it reaches the wire if
#   height >= sqrt(distance along the fall to the wire² + wire height²)
# We check that for 36 fall directions, so later the wind can say which directions matter.
#
# Two things the data can't tell us:
# - how high the wire really hangs. We assume the usual German figures in WIRE_M.
# - anything within 15 m of a line. The survey cut that strip out before finding trees
#   (no point closer than 15.0 m to any of the 64 lines). canopy.py looks inside it.
#
#   python -m vigi.trees     checks the rule on a few planted trees

import sqlite3
import struct
from pathlib import Path

import numpy as np

from vigi.grid import ROOT

TREES = ROOT / "data" / "trees"
SEARCH_M = 50.0       # the tallest tree near any line is 43.5 m, so 50 m catches every candidate
SURVEY_GAP_M = 15.0
DIRECTIONS = 36       # direction k is 10k + 5 degrees from north

# lowest wire above the ground, (mid span, at the tower). Assumed, tower drawings would replace it.
WIRE_M = {110: (12.0, 20.0), 380: (15.0, 30.0)}


def _xy(blob):
    # a GeoPackage point: 8 byte header, an optional envelope the flags announce, then WKB
    envelope = (0, 32, 48, 48, 64)[(blob[3] >> 1) & 7]
    return struct.unpack_from("<dd", blob, 8 + envelope + 5)


def _tables(folder):
    # the 2024 lots have one table per km of northing, the 2025 lots one table each
    out = []
    for path in sorted(folder.glob("*_baeume.gpkg")):
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        for name, *box in con.execute("select table_name, min_x, min_y, max_x, max_y from gpkg_contents where data_type = 'features'"):
            out.append((con, name, box))
    return out


def near(span, tables):
    (x0, y0), (x1, y1) = span["xy"]
    box = (min(x0, x1) - SEARCH_M, max(x0, x1) + SEARCH_M, min(y0, y1) - SEARCH_M, max(y0, y1) + SEARCH_M)
    points, heights = [], []
    for con, name, (tx0, ty0, tx1, ty1) in tables:
        if tx1 < box[0] or tx0 > box[1] or ty1 < box[2] or ty0 > box[3]:
            continue
        for geom, height in con.execute(
                f'select t.geom, t.baumhoehe from "{name}" t join "rtree_{name}_geom" r on t.fid = r.id '
                "where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?", box):
            points.append(_xy(geom))
            heights.append(height)
    return np.array(points).reshape(-1, 2), np.array(heights, dtype=float)


def wire_height(kv_low, t):
    # the wire sags: lowest halfway between towers, highest at them
    mid, tower = WIRE_M[380 if kv_low >= 380 else 110]
    return mid + (tower - mid) * (2 * t - 1) ** 2


def reach(span, points, heights):
    # for every tree and every fall direction: does it land on the wire? Shape (trees, 36).
    a, b = np.array(span["xy"][0]), np.array(span["xy"][1])
    d = b - a
    angles = np.radians(np.arange(DIRECTIONS) * 10 + 5)
    u = np.stack([np.sin(angles), np.cos(angles)], axis=1)
    rel = a - points
    cross = lambda p, q: p[..., 0] * q[..., 1] - p[..., 1] * q[..., 0]
    denominator = cross(u, d)
    with np.errstate(divide="ignore", invalid="ignore"):
        run = cross(rel, d)[:, None] / denominator          # how far the trunk travels to the wire
        t = cross(rel[:, None, :], u[None, :, :]) / denominator   # where along the span it crosses
    crosses = (run > 0) & (t >= 0) & (t <= 1) & (np.abs(denominator) > 1e-9)
    z = wire_height(span["kv_low"], np.clip(np.nan_to_num(t), 0, 1))
    return crosses & (run ** 2 + z ** 2 <= heights[:, None] ** 2)


def along_across(span, points):
    # metres along the span from its first tower, and to its left (+) or right (-)
    a, b = np.array(span["xy"][0]), np.array(span["xy"][1])
    e = (b - a) / np.hypot(*(b - a))
    rel = points - a
    return rel @ e, e[0] * rel[:, 1] - e[1] * rel[:, 0]


def all_spans(spans, folder=TREES):
    tables = _tables(folder)
    per_span, trees, nearby = {}, {}, {}
    for span in spans:
        points, heights = near(span, tables)
        hits = reach(span, points, heights) if len(points) else np.zeros((0, DIRECTIONS), bool)
        can = hits.any(axis=1)
        per_span[span["id"]] = {
            "hits": hits.sum(axis=0).astype(int).tolist(),
            "trees_reaching": int(can.sum()),
            "trees_near": int(len(points)),
            "tallest_reaching": round(float(heights[can].max()), 1) if can.any() else None,
        }
        # each tree within 50 m for the chart: where it stands, its height, and the directions
        # that land it on the wire as bits
        if len(points):
            u, v = along_across(span, points)
            off_end = np.maximum(np.maximum(-u, u - span["length_m"]), 0)
            masks = (hits * (1 << np.arange(DIRECTIONS, dtype=np.int64))).sum(axis=1)
            nearby[span["id"]] = [[round(float(a), 1), round(float(c), 1), round(float(h), 1), format(int(m), "x")]
                                  for a, c, h, m, d in zip(u, v, heights, masks, np.hypot(off_end, v)) if d <= SEARCH_M]
        for (x, y), h in zip(points[can], heights[can]):
            key = (round(x, 1), round(y, 1))
            trees.setdefault(key, {"x": key[0], "y": key[1], "h": round(float(h), 1), "spans": []})["spans"].append(span["id"])
    return per_span, list(trees.values()), nearby


if __name__ == "__main__":
    # a 110 kV span running north for 300 m, with trees planted east of it
    span = {"xy": [[0.0, 0.0], [0.0, 300.0]], "kv_low": 110}
    planted = np.array([[20.0, 150.0], [20.0, 150.0], [14.0, 150.0], [20.0, 2.0]])
    hits = reach(span, planted, np.array([25.0, 23.0, 18.0, 25.0]))
    # halfway along, the wire is 12 m up, so a tree 20 m away needs sqrt(20² + 12²) = 23.3 m.
    # The 25 m tree makes it, but only falling within about 24 degrees of due west.
    assert np.flatnonzero(hits[0]).tolist() == [25, 26, 27, 28]
    assert not hits[1].any()    # 23 m, just short
    assert not hits[2].any()    # 18 m at 14 m needs 18.4 m
    assert not hits[3].any()    # the same 25 m tree next to a tower, where the wire is 20 m up
    # east of a span running north is its right
    assert [round(x, 6) for x in np.array(along_across(span, planted))[:, 0]] == [150.0, -20.0]
    print("ok")

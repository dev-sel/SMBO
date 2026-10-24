# The participant package, cut into spans.
# OSM puts a vertex at every tower (a median 275 m apart), so a span is two consecutive
# vertices and "LINE_026/12" is the twelfth span from the line's from_node. Positions go to
# UTM 32 (EPSG:25832), the Bavarian survey's own grid, so the trees need no reprojection.
#
#   python -m vigi.grid      a summary, checked against numbers worked out separately

import json
import math
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "nomadic_folder" / "participant_package"
TO_UTM = Transformer.from_crs(4326, 25832, always_xy=True)


def inside(lon, lat, ring):
    # ray casting, the areas have a handful of corners
    hit = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > lat) != (y1 > lat) and lon < (x1 - x0) * (lat - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def load(package=PACKAGE):
    config = json.loads((package / "scenario_public_config.json").read_text())["public_context"]
    return {
        "segments": json.loads((package / "grid_segments.geojson").read_text())["features"],
        "nodes": json.loads((package / "grid_nodes.geojson").read_text())["features"],
        "storm": config["storm_footprint"],
        "reports": config["reports"],
    }


def spans(package):
    storm = package["storm"]["coordinates"]
    # R01 covers the whole study area. It says where the wind was, not where to look.
    areas = [(r["information_id"], r["location_area_coordinates"])
             for r in package["reports"] if r["information_id"] != "SYN_REPORT_01"]
    out = []
    for feature in package["segments"]:
        p = feature["properties"]
        lonlat = feature["geometry"]["coordinates"]
        xs, ys = TO_UTM.transform(*zip(*lonlat))
        n = len(lonlat) - 1
        for k in range(n):
            mid = ((lonlat[k][0] + lonlat[k + 1][0]) / 2, (lonlat[k][1] + lonlat[k + 1][1]) / 2)
            dx, dy = xs[k + 1] - xs[k], ys[k + 1] - ys[k]
            out.append({
                "id": f"{p['segment_id']}/{k + 1}",
                "line": p["segment_id"],
                "k": k + 1,
                "n": n,
                "kv": p["voltage_kv"],
                # on a mixed tower the lowest circuit hangs lowest, and that's the one a tree hits
                "kv_low": min(p["voltages_kv"]),
                "circuits": p["circuits"],
                "operator": p["source_operator"],
                # the line's end nodes this span touches, none in the middle of a line
                "nodes": ([p["from_node"]] if k == 0 else []) + ([p["to_node"]] if k == n - 1 else []),
                "component": p["component_id"],
                "lonlat": [lonlat[k], lonlat[k + 1]],
                "xy": [[round(xs[k], 1), round(ys[k], 1)], [round(xs[k + 1], 1), round(ys[k + 1], 1)]],
                "length_m": round(math.hypot(dx, dy), 1),
                # which way the span runs, 0 to 180, so a wind across it is 90 off
                "azimuth": round(math.degrees(math.atan2(dx, dy)) % 180, 1),
                "storm": inside(*mid, storm),
                "reports": [rid for rid, ring in areas if inside(*mid, ring)],
            })
    return out


if __name__ == "__main__":
    package = load()
    all_spans = spans(package)
    by_line = {}
    for s in all_spans:
        by_line.setdefault(s["line"], []).append(s)
    lengths = sorted(s["length_m"] for s in all_spans)
    print(f"{len(all_spans)} spans on {len(by_line)} lines, median {lengths[len(lengths) // 2]:.0f} m")
    for rid in ["SYN_REPORT_02", "SYN_REPORT_03", "SYN_REPORT_04", "SYN_REPORT_05", "SYN_REPORT_06"]:
        inside_area = [s for s in all_spans if rid in s["reports"]]
        km = sum(s["length_m"] for s in inside_area) / 1000
        lines = sorted({s["line"] for s in inside_area})
        print(f"  {rid}: {len(inside_area)} spans, {km:.1f} km, {', '.join(lines)}")

    # the same figures as the first look at the package, which sampled every 10 m instead
    assert len(all_spans) == 744
    assert len(by_line["LINE_024"]) == 89
    assert abs(sum(s["length_m"] for s in by_line["LINE_024"]) / 1000 - 26.8) < 0.15
    # R03 sits over LINE_024 since we moved it there, and still over the start of LINE_026
    assert [s["k"] for s in by_line["LINE_024"] if "SYN_REPORT_03" in s["reports"]] == list(range(27, 61))
    assert by_line["LINE_004"][0]["kv"] == 380 and by_line["LINE_004"][0]["kv_low"] == 110

# Writes everything the web app reads into web/public/data. The app serves nothing live.
#
#   python -m vigi.build     needs data/trees and data/wind, see docs/README.md

import json

from pyproj import Transformer

from vigi import grid, trees, wind

OUT = grid.ROOT / "web" / "public" / "data"
TO_LONLAT = Transformer.from_crs(25832, 4326, always_xy=True)


def collection(features):
    return {"type": "FeatureCollection", "features": features}


def main():
    package = grid.load()
    spans = grid.spans(package)
    reach, reaching, nearby = trees.all_spans(spans)

    span_features = []
    for s in spans:
        props = {k: v for k, v in s.items() if k != "lonlat"} | reach[s["id"]]
        span_features.append({"type": "Feature", "properties": props, "geometry": {"type": "LineString", "coordinates": s["lonlat"]}})

    nodes = [{"type": "Feature", "geometry": f["geometry"], "properties": {
        "id": f["properties"]["node_id"], "type": f["properties"]["node_type"], "name": f["properties"]["name"],
        "kv": f["properties"]["voltage_kv"], "segments": f["properties"]["connected_segments"]}} for f in package["nodes"]]

    storm = package["storm"]
    areas = [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [storm["coordinates"]]},
              "properties": {"id": storm["context_id"], "kind": "storm", "label": storm["label"],
                             "text": storm["description"], "confidence": storm["confidence"]}}]
    for r in package["reports"]:
        areas.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [r["location_area_coordinates"]]},
                      "properties": {"id": r["information_id"], "kind": r["information_type"], "text": r["description"],
                                     "confidence": r["confidence"], "time": r["timestamp_relative_to_storm"],
                                     "source": r["source"], "asset": r.get("asset_reference")}})

    tree_features = []
    for t in reaching:
        lon, lat = TO_LONLAT.transform(t["x"], t["y"])
        tree_features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                              "properties": {"h": t["h"], "spans": t["spans"]}})

    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "spans.geojson": collection(span_features),
        "nodes.geojson": collection(nodes),
        "areas.geojson": collection(areas),
        "trees.geojson": collection(tree_features),
        "nearby.json": nearby,
        "wind.json": wind.summary(wind.read()),
    }
    for name, data in files.items():
        (OUT / name).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
        print(f"  {name}: {(OUT / name).stat().st_size / 1024:.0f} kB")
    print(f"{len(spans)} spans, {len(reaching)} trees in reach, {sum(1 for r in reach.values() if r['trees_reaching'])} spans with any")


if __name__ == "__main__":
    main()

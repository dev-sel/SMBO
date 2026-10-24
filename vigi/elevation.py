# Bavarian elevation tiles, DGM1 ground and DOM20 surface, placed by their GeoTIFF tags.
# Never trust a file name for position. A window near a tile edge needs the next tile too:
# clipping there doesn't fail, it quietly returns a smaller array, so window() mosaics.

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import tifffile

from vigi.grid import ROOT

DGM1 = ROOT / "data" / "dgm1"
DOM20 = ROOT / "data" / "dom20"


@lru_cache(maxsize=None)
def tiles(folder):
    # reading every file's tags is slow, so they're kept in _index.json next to the tiles
    files = sorted(Path(folder).glob("*.tif"))
    if not files:
        raise FileNotFoundError(f"no GeoTIFFs in {folder}")
    cache = Path(folder) / "_index.json"
    rows = json.loads(cache.read_text()) if cache.exists() else []
    if len(rows) != len(files):
        rows = []
        for tif in files:
            with tifffile.TiffFile(tif) as t:
                page = t.pages[0]
                tie = page.tags["ModelTiepointTag"].value
                assert tie[0] == tie[1] == 0, f"{tif.name} ties a pixel other than the corner"
                # "pixel is area", so the tie point is the tile's corner, not a pixel centre
                rows.append({"name": tif.stem, "file": tif.name, "west": tie[3], "north": tie[4],
                             "cell": page.tags["ModelPixelScaleTag"].value[0],
                             "width": page.shape[1], "height": page.shape[0]})
        cache.write_text(json.dumps(rows, indent=1))
    for r in rows:
        r["east"] = r["west"] + r["width"] * r["cell"]
        r["south"] = r["north"] - r["height"] * r["cell"]
    return rows


def at(folder, x, y):
    return any(t["west"] <= x < t["east"] and t["south"] < y <= t["north"] for t in tiles(folder))


@lru_cache(maxsize=6)
def _read(path):
    # 100 MB per DOM20 tile, a window needs 4 at most
    return tifffile.imread(path)


def window(folder, west, north, size_m):
    # a square size_m across from its north west corner, NaN where there's no tile.
    # Corners on whole metres sit on both grids, 1 m and 20 cm.
    rows = tiles(folder)
    cell = rows[0]["cell"]
    n = round(size_m / cell)
    east, south = west + n * cell, north - n * cell
    out = np.full((n, n), np.nan, dtype=np.float32)
    for t in rows:
        x0, x1 = max(west, t["west"]), min(east, t["east"])
        y0, y1 = max(south, t["south"]), min(north, t["north"])
        if x0 >= x1 or y0 >= y1:
            continue
        data = _read(str(Path(folder) / t["file"]))
        sc, sr = round((x0 - t["west"]) / cell), round((t["north"] - y1) / cell)
        dc, dr = round((x0 - west) / cell), round((north - y1) / cell)
        w, h = round((x1 - x0) / cell), round((y1 - y0) / cell)
        out[dr:dr + h, dc:dc + w] = data[sr:sr + h, sc:sc + w]
    out[out < -1000] = np.nan    # the survey writes gaps as -9999
    return out


if __name__ == "__main__":
    # the first tile downloaded: SUBSTATION_07, flat Lechfeld
    assert at(DGM1, 636500, 5344500)
    ground = window(DGM1, 636400, 5344600, 200)
    assert ground.shape == (200, 200) and 531 < np.nanmin(ground) and np.nanmax(ground) < 538
    # straddling two tiles, which a plain clip would cut in half
    assert not np.isnan(window(DGM1, 623900, 5345600, 200)).any()
    print("ok", len(tiles(DGM1)), "DGM1 tiles")

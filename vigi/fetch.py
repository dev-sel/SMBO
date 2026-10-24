# Downloads what the pipeline reads into data/. Files already there are skipped.
# Both sources are open: the Bavarian survey (CC BY 4.0) and DWD (CC BY 4.0).
#
#   python -m vigi.fetch          trees, wind and the spot-check tiles, about 2 GB
#   python -m vigi.fetch --small  wind only, a few MB, the app still runs from web/public/data

import sys
import urllib.request
import zipfile

from vigi.grid import ROOT

DATA = ROOT / "data"
TREE_LOTS = ["124021", "124026", "125042", "125043", "125044", "125045"]   # the six lots that cover every line
SPOT_TILES = ["619_5340", "622_5345", "622_5359", "623_5345", "624_5345", "626_5345", "626_5346", "629_5345", "630_5345"]
DWD = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/extreme_wind/historical/"
WIND = ["19961108_19991231", "20000101_20091231", "20100101_20191231", "20200101_20251231"]


def get(url, path):
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    print(f"  {path.relative_to(ROOT)}")
    with urllib.request.urlopen(url, timeout=120) as response, open(part, "wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    part.rename(path)   # a cut download stays .part, so a rerun fetches it again


def main(small):
    for period in WIND:
        name = f"10minutenwerte_extrema_wind_00232_{period}_hist.zip"
        get(DWD + name, DATA / "wind" / name)
        with zipfile.ZipFile(DATA / "wind" / name) as z:
            z.extractall(DATA / "wind")
    if small:
        return
    for lot in TREE_LOTS:
        get(f"https://geodaten.bayern.de/odd/m/8/baeume3d/data/{lot}_baeume.gpkg", DATA / "trees" / f"{lot}_baeume.gpkg")
    for tile in SPOT_TILES:
        get(f"https://download1.bayernwolke.de/a/dgm/dgm1/{tile}.tif", DATA / "dgm1" / f"{tile}.tif")
        get(f"https://download1.bayernwolke.de/a/dom20/DOM/32{tile}_20_DOM.tif", DATA / "dom20" / f"32{tile}_20_DOM.tif")


if __name__ == "__main__":
    main("--small" in sys.argv)
    print("done")

# The wind the trees fell in: DWD's 10 minute gusts at Augsburg (station 232), about 6 km
# north east of the study area. Times are UTC, as DWD writes them.
#
# The exercise storm is made up, so it borrows a real one's shape: the gust front of
# 11 July 2023, the third strongest gust in the station's 29 years (32.9 m/s from 230 degrees),
# under 12 m/s again within 50 minutes. The 15 strongest days since 1996 all came from 230 to
# 290 degrees, so west south west is the usual case here, not this storm's luck.
#
#   python -m vigi.wind     the event, the directions trees fell in, the strongest days

from datetime import datetime

from vigi.grid import ROOT

WIND = ROOT / "data" / "wind"
EVENT_PEAK = "202307112140"
DAMAGING_MS = 15.0       # gusts that break trees. Below it the record is just weather.
FLIGHT_LIMIT_MS = 10.0   # the NOMAD's stated wind limit, 36 km/h


def read(folder=WIND):
    # (time, max gust m/s, its direction) for every 10 minutes with both recorded
    rows = []
    for path in sorted(folder.glob("produkt_zehn_min_fx_*_00232.txt")):
        for line in path.read_text(encoding="latin-1").splitlines()[1:]:
            p = [v.strip() for v in line.split(";")]
            # a blank or -999 is a gap in the record, not calm
            if not p[3] or not p[6] or float(p[3]) < 0 or int(p[6]) < 0:
                continue
            rows.append((p[1], float(p[3]), int(p[6])))
    return rows


def _minutes(ts):
    return int(datetime.strptime(ts, "%Y%m%d%H%M").timestamp() // 60)


def event(rows, peak=EVENT_PEAK, before=60, after=240):
    t0 = _minutes(peak)
    return [{"t": _minutes(ts) - t0, "gust": gust, "from": direction}
            for ts, gust, direction in rows if -before <= _minutes(ts) - t0 <= after]


def strongest_days(rows, n=15):
    # one gust's direction swings with the turbulence, the median of a day's damaging gusts
    # is where the storm came from
    days = {}
    for ts, gust, direction in rows:
        day = days.setdefault(ts[:8], {"gust": 0.0, "dirs": []})
        day["gust"] = max(day["gust"], gust)
        if gust >= DAMAGING_MS:
            day["dirs"].append(direction)
    top = sorted(days.items(), key=lambda kv: -kv[1]["gust"])[:n]
    # a plain median is safe here, no strong day comes from either side of north
    return [{"day": f"{d[:4]}-{d[4:6]}-{d[6:]}", "gust": v["gust"], "from": sorted(v["dirs"])[len(v["dirs"]) // 2]}
            for d, v in top]


def summary(rows):
    window = event(rows)
    damaging = [w for w in window if w["gust"] >= DAMAGING_MS]
    calm = next(w["t"] for w in window if w["t"] > 0 and w["gust"] < FLIGHT_LIMIT_MS)
    return {
        "station": "DWD 232 Augsburg",
        "event": "11 July 2023, gust front",
        "peak_utc": f"{EVENT_PEAK[:4]}-{EVENT_PEAK[4:6]}-{EVENT_PEAK[6:8]} {EVENT_PEAK[8:10]}:{EVENT_PEAK[10:]}",
        "series": window,
        # the gusts that could break trees, each 10 minutes weighted by its gust squared,
        # which is how the force on a crown grows
        "damaging": [[w["from"], round(w["gust"] ** 2)] for w in damaging],
        "flyable_after_min": calm,
        "flight_limit_ms": FLIGHT_LIMIT_MS,
        "damaging_ms": DAMAGING_MS,
        "strongest_days": strongest_days(rows),
    }


if __name__ == "__main__":
    s = summary(read())
    print(f"{s['station']}, {s['event']}, peak {s['peak_utc']} UTC")
    for w in s["series"]:
        if -20 <= w["t"] <= 60:
            print(f"  {w['t']:+4d} min  {w['gust']:5.1f} m/s from {w['from']:3d}")
    print(f"  flyable {s['flyable_after_min']} min after the peak (gusts under {FLIGHT_LIMIT_MS} m/s)")
    print("  damaging gusts, from and weight:", s["damaging"])
    print("strongest days:", ", ".join(f"{d['day']} {d['gust']} from {d['from']}" for d in s["strongest_days"]))

    # measured once by hand from the 2020 to 2025 file
    assert s["damaging"][1] == [230, round(32.9 ** 2)]
    assert s["flyable_after_min"] == 50       # 12.6 m/s at +30 and +40, 9.2 at +50
    assert all(230 <= d["from"] <= 290 for d in s["strongest_days"])

#!/usr/bin/env python3
"""Build station network and traffic-camera files for the Hong Kong map."""

import csv
import io
import json
import math
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = "hk-smart-map/0.1 (classroom map)"

# EPSG:2326 (Hong Kong 1980 Grid) to WGS84.
A_HK = 6378388.0
F_HK = 1 / 297.0
E2_HK = F_HK * (2 - F_HK)
EP2_HK = E2_HK / (1 - E2_HK)
LAT0 = math.radians(22.31213333333334)
LON0 = math.radians(114.1785555555556)
K0 = 1.0
X0 = 836694.05
Y0 = 819069.80
DX, DY, DZ = -162.619, -276.959, -161.764
RX = math.radians(0.067753 / 3600)
RY = math.radians(-2.243649 / 3600)
RZ = math.radians(-1.158828 / 3600)
DS = -1.094246e-6
A_WGS = 6378137.0
F_WGS = 1 / 298.257223563
E2_WGS = F_WGS * (2 - F_WGS)

LINES = [
    ("ISL", "港島綫", "#007dc5"),
    ("TWL", "荃灣綫", "#ed1d24"),
    ("KTL", "觀塘綫", "#1a9431"),
    ("TKL", "將軍澳綫", "#6d2c8a"),
    ("EAL", "東鐵綫", "#5eb6e4"),
    ("TML", "屯馬綫", "#923a2b"),
    ("TCL", "東涌綫", "#fe7f1d"),
    ("AEL", "機場快綫", "#1c7670"),
    ("SIL", "南港島綫", "#b5bd00"),
    ("DRL", "迪士尼綫", "#f550a6"),
]
LINE_NAME = {code: name for code, name, _ in LINES}
LINE_COLOR = {code: color for code, _, color in LINES}
SPINE = {code: "UT" for code, _, _ in LINES}
SPURS = {
    "EAL": [["SHS", "LMC"], ["FOT", "RAC"]],
    "TKL": [["TKO", "LHP"]],
}


def meridional(lat):
    a = A_HK
    e2 = E2_HK
    e4 = e2 * e2
    e6 = e4 * e2
    a0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256
    b0 = 3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024
    c0 = 15 * e4 / 256 + 45 * e6 / 1024
    d0 = 35 * e6 / 3072
    return a * (a0 * lat - b0 * math.sin(2 * lat) + c0 * math.sin(4 * lat) - d0 * math.sin(6 * lat))


M0 = meridional(LAT0)


def hk80_to_wgs(easting, northing):
    a = A_HK
    e2 = E2_HK
    x = (easting - X0) / K0
    y = (northing - Y0) / K0
    mu = (M0 + y) / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    lat = (
        mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
    )
    for _ in range(5):
        lat += (M0 + y - meridional(lat)) / (a * (1 - e2) / (1 - e2 * math.sin(lat) ** 2) ** 1.5)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    t = math.tan(lat) ** 2
    c = EP2_HK * math.cos(lat) ** 2
    r = a * (1 - e2) / (1 - e2 * math.sin(lat) ** 2) ** 1.5
    d = x / n
    lat = lat - (n * math.tan(lat) / r) * (
        d * d / 2
        - (5 + 3 * t + 10 * c - 4 * c * c - 9 * EP2_HK) * d ** 4 / 24
        + (61 + 90 * t + 298 * c + 45 * t * t - 252 * EP2_HK - 3 * c * c) * d ** 6 / 720
    )
    lon = LON0 + (
        d
        - (1 + 2 * t + c) * d ** 3 / 6
        + (5 - 2 * c + 28 * t - 3 * c * c + 8 * EP2_HK + 24 * t * t) * d ** 5 / 120
    ) / math.cos(lat)
    sx, sy, sz = geodetic_to_ecef(lat, lon, A_HK, E2_HK)
    x2 = DX + (1 + DS) * sx - RZ * sy + RY * sz
    y2 = DY + RZ * sx + (1 + DS) * sy - RX * sz
    z2 = DZ - RY * sx + RX * sy + (1 + DS) * sz
    lat2, lon2 = ecef_to_geodetic(x2, y2, z2)
    return lat2, lon2


def geodetic_to_ecef(lat, lon, a, e2):
    sl, cl = math.sin(lat), math.cos(lat)
    n = a / math.sqrt(1 - e2 * sl * sl)
    return n * cl * math.cos(lon), n * cl * math.sin(lon), n * (1 - e2) * sl


def ecef_to_geodetic(x, y, z):
    a = A_WGS
    e2 = E2_WGS
    b = a * math.sqrt(1 - e2)
    ep2 = (a * a - b * b) / (b * b)
    p = math.hypot(x, y)
    th = math.atan2(a * z, b * p)
    lon = math.atan2(y, x)
    lat = math.atan2(z + ep2 * b * math.sin(th) ** 3, p - e2 * a * math.cos(th) ** 3)
    return math.degrees(lat), math.degrees(lon)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def name_variants(name):
    variants = [name]
    if "茘" in name:
        variants.append(name.replace("茘", "荔"))
    if "荔" in name:
        variants.append(name.replace("荔", "茘"))
    return variants


def geocode(code, name):
    last = None
    for variant in name_variants(name):
        query = "港鐵" + variant + "站"
        url = "https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=" + urllib.parse.quote(query)
        try:
            hits = json.loads(fetch(url).decode())
        except Exception as error:
            return {"code": code, "error": str(error), "query": query}
        exact = next((hit for hit in hits if hit.get("nameZH") == query), None)
        chosen = exact or (hits[0] if hits else None)
        last = (query, chosen, bool(exact), len(hits))
        if exact:
            break
    if not last or not last[1]:
        return {"code": code, "error": "沒有搜尋結果", "query": name}
    query, chosen, exact, count = last
    lat, lon = hk80_to_wgs(float(chosen["x"]), float(chosen["y"]))
    return {
        "code": code,
        "query": query,
        "hit": chosen.get("nameZH"),
        "exact": exact,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "candidates": count,
    }


def load_stations():
    text = fetch("https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv").decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    stations = {}
    sequences = defaultdict(lambda: defaultdict(list))
    for row in rows:
        line = row["Line Code"].strip()
        direction = row["Direction"].strip()
        code = row["Station Code"].strip()
        name = row["Chinese Name"].strip()
        english = row["English Name"].strip()
        if not line or not code or not name:
            continue
        stations[code] = {"code": code, "name": name, "en": english}
        sequences[line][direction].append((float(row["Sequence"]), code))
    stations["RAC"] = {"code": "RAC", "name": "馬場", "en": "Racecourse"}
    return stations, sequences


def ordered_codes(sequences, line, direction):
    return [code for _, code in sorted(sequences[line][direction])]


def haversine_km(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def build_network():
    stations, sequences = load_stations()
    with ThreadPoolExecutor(max_workers=6) as pool:
        located = list(pool.map(lambda item: geocode(*item), ((code, item["name"]) for code, item in stations.items())))
    by_code = {item["code"]: item for item in located}
    missing = [item for item in located if item.get("error") or not (22.1 <= item.get("lat", 0) <= 22.6 and 113.8 <= item.get("lon", 0) <= 114.5)]
    if missing:
        raise SystemExit("車站座標不完整: " + json.dumps(missing, ensure_ascii=False))
    inexact = [item for item in located if not item.get("exact")]
    if inexact:
        raise SystemExit("車站名稱未能完全對上: " + json.dumps(inexact, ensure_ascii=False))
    for code, station in stations.items():
        station["lat"] = by_code[code]["lat"]
        station["lon"] = by_code[code]["lon"]
        station["lines"] = []

    line_features = []
    warnings = []
    for code, name, color in LINES:
        direction = SPINE[code]
        spine = ordered_codes(sequences, code, direction)
        for index, station_code in enumerate(spine):
            stations[station_code]["lines"].append(code)
        path = [(station_code, stations[station_code]["lon"], stations[station_code]["lat"]) for station_code in spine]
        paths = [[[lon, lat] for _, lon, lat in path]]
        for spur in SPURS.get(code, []):
            for station_code in spur:
                if code not in stations[station_code]["lines"]:
                    stations[station_code]["lines"].append(code)
            paths.append([[stations[station_code]["lon"], stations[station_code]["lat"]] for station_code in spur])
        for coordinates in paths:
            for start, end in zip(coordinates, coordinates[1:]):
                distance = haversine_km(start, end)
                if distance > 12:
                    warnings.append(f"{code} 相鄰車站相距 {distance:.1f} 公里")
        line_features.append({"code": code, "name": name, "color": color, "paths": paths})

    station_list = []
    for code, station in stations.items():
        if not station["lines"]:
            raise SystemExit(f"{code} 沒有歸入任何路綫")
        station_list.append({
            "code": code,
            "name": station["name"],
            "en": station["en"],
            "lat": station["lat"],
            "lon": station["lon"],
            "lines": station["lines"],
        })
    station_list.sort(key=lambda item: item["name"])
    print(f"車站 {len(station_list)} 個，路綫 {len(line_features)} 條")
    if warnings:
        print("距離提醒:", "; ".join(warnings))
    payload = {
        "lines": line_features,
        "stations": station_list,
    }
    (DATA / "network.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_cameras():
    raw = fetch("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml")
    root = ET.fromstring(raw)
    cameras = []
    for image in root.findall("image"):
        try:
            lat = float(image.findtext("latitude"))
            lon = float(image.findtext("longitude"))
        except (TypeError, ValueError):
            continue
        key = (image.findtext("key") or "").strip()
        description = (image.findtext("description") or key).strip()
        url = (image.findtext("url") or f"https://tdcctv.data.one.gov.hk/{key}.JPG").strip()
        if not key:
            continue
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "tdcctv.data.one.gov.hk":
            url = f"https://tdcctv.data.one.gov.hk/{key}.JPG"
        cameras.append({
            "key": key,
            "name": description,
            "district": (image.findtext("district") or "").strip(),
            "lat": lat,
            "lon": lon,
            "url": url,
        })
    if len(cameras) < 900:
        raise SystemExit(f"快拍點數量異常: {len(cameras)}")
    print(f"快拍點 {len(cameras)} 個")
    (DATA / "cameras.json").write_text(json.dumps(cameras, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    build_network()
    build_cameras()

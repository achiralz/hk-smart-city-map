"use strict";

const summary = document.querySelector("#summary");
const searchInput = document.querySelector("#search");
const results = document.querySelector("#results");
const legend = document.querySelector("#legend");
const detail = document.querySelector("#detail");
const banner = document.querySelector("#banner");
const toggleMtr = document.querySelector("#toggle-mtr");
const toggleCam = document.querySelector("#toggle-cam");

let map;
let network = { lines: [], stations: [] };
const CAMERA_ZOOM = 13;
let cameras = [];
let camerasLoaded = false;
let camerasLoading = null;
let stationByCode = new Map();
let lineByCode = new Map();
let selectedStation = "";
let requestToken = 0;
const bannerMessages = [];
const BASEMAP_MESSAGE = "暫時未能載入地圖底圖。左方仍可搜尋車站和快拍點。";

function showBanner(text) {
  if (!bannerMessages.includes(text)) bannerMessages.push(text);
  banner.hidden = false;
  banner.textContent = bannerMessages.join(" ");
}

function clearBanner(text) {
  const index = bannerMessages.indexOf(text);
  if (index >= 0) bannerMessages.splice(index, 1);
  banner.textContent = bannerMessages.join(" ");
  banner.hidden = bannerMessages.length === 0;
}

function canonical(text) {
  return String(text)
    .replaceAll("荔", "茘")
    .replaceAll("台", "臺")
    .replaceAll("恒", "恆")
    .toLowerCase();
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function lineFeatures() {
  const features = [];
  network.lines.forEach((line) => {
    line.paths.forEach((path) => {
      features.push({
        type: "Feature",
        properties: { code: line.code, name: line.name, color: line.color },
        geometry: { type: "LineString", coordinates: path },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

function stationFeatures() {
  return {
    type: "FeatureCollection",
    features: network.stations.map((station) => ({
      type: "Feature",
      id: station.code,
      properties: {
        code: station.code,
        name: station.name,
        lineCount: station.lines.length,
      },
      geometry: { type: "Point", coordinates: [station.lon, station.lat] },
    })),
  };
}

function cameraFeatures(list) {
  return {
    type: "FeatureCollection",
    features: (list || []).map((camera) => ({
      type: "Feature",
      id: camera.key,
      properties: camera,
      geometry: { type: "Point", coordinates: [camera.lon, camera.lat] },
    })),
  };
}

function camerasInView() {
  if (!map || map.getZoom() < CAMERA_ZOOM) return [];
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const padLon = (east - west) * 0.2;
  const padLat = (north - south) * 0.2;
  return cameras.filter((camera) => camera.lon >= west - padLon && camera.lon <= east + padLon
    && camera.lat >= south - padLat && camera.lat <= north + padLat);
}

function updateSummary() {
  const stationText = network.stations.length ? network.stations.length + " 個港鐵站" : "港鐵網絡未能載入";
  let cameraText = "放大後才顯示交通快拍";
  if (!toggleCam.checked) cameraText = "交通快拍已隱藏";
  else if (map && map.getZoom() >= CAMERA_ZOOM) {
    cameraText = camerasLoaded ? camerasInView().length + " 個畫面內快拍點" : "正在載入畫面內的快拍點";
  }
  summary.textContent = stationText + " · " + cameraText;
}

function refreshVisibleCameras() {
  const source = map && map.getSource("cameras");
  if (!source) return;
  const visible = toggleCam.checked && map.getZoom() >= CAMERA_ZOOM && camerasLoaded;
  source.setData(cameraFeatures(visible ? camerasInView() : []));
  updateSummary();
}

function ensureCameras() {
  if (camerasLoaded) return Promise.resolve(true);
  if (!camerasLoading) {
    camerasLoading = loadJson("data/cameras.json").then((data) => {
      cameras = data;
      camerasLoaded = true;
      return true;
    }).catch(() => {
      camerasLoading = null;
      showBanner("暫時未能載入交通快拍點。");
      return false;
    });
  }
  return camerasLoading;
}

function updateCamerasForView() {
  if (!map) return;
  if (!toggleCam.checked || map.getZoom() < CAMERA_ZOOM) {
    refreshVisibleCameras();
    return;
  }
  ensureCameras().then((loaded) => {
    if (loaded) refreshVisibleCameras();
  });
}

function setLayerVisibility(layers, visible) {
  if (!map || typeof map.getLayer !== "function") return;
  layers.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  });
}

function applyLayerToggles() {
  setLayerVisibility(["mtr-lines", "stations", "station-labels"], toggleMtr.checked);
  setLayerVisibility(["camera-clusters", "camera-counts", "camera-points"], toggleCam.checked);
  updateCamerasForView();
}

function fitAll() {
  if (!map || !network.stations.length) return;
  const bounds = new maplibregl.LngLatBounds();
  network.stations.forEach((station) => bounds.extend([station.lon, station.lat]));
  map.fitBounds(bounds, { padding: 48, duration: 600 });
}

function selectStationFeature(code) {
  const next = code || "";
  if (map && map.getSource("stations")) {
    if (selectedStation) {
      map.setFeatureState({ source: "stations", id: selectedStation }, { selected: false });
    }
    if (next) map.setFeatureState({ source: "stations", id: next }, { selected: true });
  }
  selectedStation = next;
}

function revealDetail() {
  detail.scrollIntoView({ block: "nearest" });
}

function renderLegend() {
  clearNode(legend);
  network.lines.forEach((line) => {
    const item = el("li");
    const swatch = el("span", "swatch");
    swatch.style.background = line.color;
    item.append(swatch, document.createTextNode(line.name));
    legend.append(item);
  });
}

function renderEmptyDetail() {
  clearNode(detail);
  detail.append(el("p", "muted", "在地圖上選擇一個車站或快拍點。暫時沒有班次或照片時，這裡會說明原因。"));
}

function parseHongKongTime(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value || ""))) return null;
  const parsed = new Date(String(value).replace(" ", "T") + "+08:00");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countdownText(train, currTime) {
  const arrival = parseHongKongTime(train.time);
  const now = parseHongKongTime(currTime);
  if (!arrival || !now) return "未能計算到站時間";
  const minutes = Math.round((arrival.getTime() - now.getTime()) / 60000);
  if (minutes <= 0) return "即將到站";
  return minutes + " 分鐘";
}

function trainRow(train, currTime) {
  const row = el("div", "train");
  row.append(el("div", "when", countdownText(train, currTime)));
  const bits = [];
  if (train.route === "RAC") bits.push("經馬場");
  if (train.plat) bits.push(train.plat + " 號月台");
  if (train.time && String(train.time).length >= 16) bits.push(String(train.time).slice(11, 16));
  if (train.valid === "N") bits.push("預計時間");
  if (bits.length) row.append(el("div", "sub", bits.join(" · ")));
  return row;
}

function renderDestination(trains, currTime) {
  const destination = stationByCode.get(trains[0].dest);
  const block = el("div", "direction");
  block.append(el("h4", null, "往" + (destination ? destination.name : trains[0].dest)));
  trains.forEach((train) => block.append(trainRow(train, currTime)));
  return block;
}

function groupByDestination(trains) {
  const groups = [];
  trains.forEach((train) => {
    const last = groups[groups.length - 1];
    if (last && last[0].dest === train.dest) last.push(train);
    else groups.push([train]);
  });
  return groups;
}

async function fetchLine(line, code) {
  try {
    const url = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line="
      + encodeURIComponent(line) + "&sta=" + encodeURIComponent(code) + "&lang=TC";
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 429) return { line, error: "查詢太頻密，請稍後再試。" };
    if (!response.ok) return { line, error: "暫時未能取得到站資料。" };
    const payload = await response.json();
    if (!payload || payload.status !== 1) return { line, error: "暫時未能取得到站資料。" };
    const block = payload.data && payload.data[line + "-" + code];
    if (!block) return { line, error: "暫時未能取得到站資料。" };
    return {
      line,
      up: block.UP || [],
      down: block.DOWN || [],
      delay: payload.isdelay === "Y" || block.isdelay === "Y",
      updated: block.curr_time || payload.curr_time || "",
    };
  } catch (error) {
    return { line, error: "暫時未能取得到站資料。" };
  }
}

async function openStation(station) {
  const token = ++requestToken;
  selectStationFeature(station.code);
  results.hidden = true;
  if (map) {
    map.flyTo({
      center: [station.lon, station.lat],
      zoom: Math.max(map.getZoom(), 13.5),
      essential: true,
    });
  }
  clearNode(detail);
  detail.append(el("h2", null, station.name));
  detail.append(el("p", "meta", station.en));
  const chips = el("div", "chips");
  station.lines.forEach((code) => {
    const line = lineByCode.get(code);
    const chip = el("span", "chip", line ? line.name : code);
    const swatch = el("span", "swatch");
    swatch.style.background = line ? line.color : "#999";
    chip.prepend(swatch);
    chips.append(chip);
  });
  detail.append(chips, el("p", "muted", "正在查詢到站班次…"));
  revealDetail();

  const rows = await Promise.all(station.lines.map((code) => fetchLine(code, station.code)));
  if (token !== requestToken) return;

  clearNode(detail);
  detail.append(el("h2", null, station.name));
  detail.append(el("p", "meta", station.en));
  detail.append(chips);
  rows.forEach((row) => {
    const line = lineByCode.get(row.line);
    const section = el("section");
    const heading = el("h3", null, line ? line.name : row.line);
    section.append(heading);
    if (row.error) {
      section.append(el("p", "notice", row.error));
      detail.append(section);
      return;
    }
    if (row.delay) section.append(el("p", "notice", "港鐵表示服務可能受阻延。"));
    const trains = row.up.concat(row.down);
    if (!trains.length) {
      section.append(el("p", "notice", "這個車站暫時沒有即將到站的班次。"));
    } else {
      groupByDestination(trains).forEach((group) => section.append(renderDestination(group, row.updated)));
    }
    if (row.updated) section.append(el("p", "meta", "資料時間 " + row.updated));
    detail.append(section);
  });
  const refresh = el("button", "refresh", "重新查詢");
  refresh.type = "button";
  refresh.addEventListener("click", () => openStation(station));
  detail.append(refresh);
  revealDetail();
}

function freshPhoto(url) {
  const join = url.includes("?") ? "&" : "?";
  return url + join + "t=" + Math.floor(Date.now() / 120000);
}

function openCamera(camera, coordinates) {
  const token = ++requestToken;
  if (selectedStation) selectStationFeature("");
  results.hidden = true;
  const center = coordinates || [Number(camera.lon), Number(camera.lat)];
  if (map) map.flyTo({ center, zoom: Math.max(map.getZoom(), 15), essential: true });
  clearNode(detail);
  detail.append(el("h2", null, camera.name));
  if (camera.district) detail.append(el("p", "meta", camera.district));
  const image = el("img", "photo");
  image.alt = camera.name + "的最新交通快拍";
  image.addEventListener("error", () => {
    if (token !== requestToken) return;
    image.remove();
    detail.append(el("p", "notice", "這個快拍點暫時沒有最新照片。"));
  });
  image.src = freshPhoto(camera.url);
  detail.append(image);
  revealDetail();
}

function showSearch(query) {
  const text = query.trim();
  clearNode(results);
  if (!text) {
    results.hidden = true;
    return;
  }
  const folded = canonical(text);
  const stationHits = network.stations.filter((station) => {
    return canonical(station.name).includes(folded)
      || canonical(station.en).includes(folded)
      || station.code.toLowerCase() === text.toLowerCase();
  }).slice(0, 8);
  if (text.length >= 2 && !camerasLoaded) {
    ensureCameras().then(() => {
      if (searchInput.value.trim() === text) showSearch(text);
    });
    if (!stationHits.length) {
      const item = el("li");
      item.append(el("p", "muted", "正在搜尋快拍點…"));
      results.append(item);
      results.hidden = false;
      return;
    }
  }
  const cameraHits = text.length >= 2 && camerasLoaded
    ? cameras.filter((camera) => canonical(camera.name).includes(folded) || camera.key.toLowerCase().includes(text.toLowerCase())).slice(0, 6)
    : [];
  if (!stationHits.length && !cameraHits.length) {
    const item = el("li");
    item.append(el("p", "muted", "找不到相符的車站或快拍點。"));
    results.append(item);
    results.hidden = false;
    return;
  }
  stationHits.forEach((station) => {
    const item = el("li");
    const button = el("button");
    button.type = "button";
    button.append(el("strong", null, station.name));
    button.append(el("small", null, station.lines.map((code) => {
      const line = lineByCode.get(code);
      return line ? line.name : code;
    }).join("、")));
    button.addEventListener("click", () => openStation(station));
    item.append(button);
    results.append(item);
  });
  cameraHits.forEach((camera) => {
    const item = el("li");
    const button = el("button");
    button.type = "button";
    button.append(el("strong", null, camera.name));
    button.append(el("small", null, "交通快拍"));
    button.addEventListener("click", () => openCamera(camera));
    item.append(button);
    results.append(item);
  });
  results.hidden = false;
}

const TRAIN_ZOOM = 13;
const TRAIN_SEGMENT_MIN_MS = 60 * 1000;
const TRAIN_SEGMENT_MAX_MS = 8 * 60 * 1000;
const LINE_ROUTES = [
  { line: "ISL", stations: ["KET", "HKU", "SYP", "SHW", "CEN", "ADM", "WAC", "CAB", "TIH", "FOH", "NOP", "QUB", "TAK", "SWH", "SKW", "HFC", "CHW"] },
  { line: "TWL", stations: ["CEN", "ADM", "TST", "JOR", "YMT", "MOK", "PRE", "SSP", "CSW", "LCK", "MEF", "LAK", "KWF", "KWH", "TWH", "TSW"] },
  { line: "KTL", stations: ["WHA", "HOM", "YMT", "MOK", "PRE", "SKM", "KOT", "LOF", "WTS", "DIH", "CHH", "KOB", "NTK", "KWT", "LAT", "YAT", "TIK"] },
  { line: "TKL", stations: ["NOP", "QUB", "YAT", "TIK", "TKO", "HAH", "POA"] },
  { line: "TKL", stations: ["NOP", "QUB", "YAT", "TIK", "TKO", "LHP"] },
  { line: "EAL", stations: ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "FOT", "UNI", "TAP", "TWO", "FAN", "SHS", "LOW"] },
  { line: "EAL", viaRac: true, stations: ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "RAC", "UNI", "TAP", "TWO", "FAN", "SHS", "LOW"] },
  { line: "EAL", stations: ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "FOT", "UNI", "TAP", "TWO", "FAN", "SHS", "LMC"] },
  { line: "EAL", viaRac: true, stations: ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "RAC", "UNI", "TAP", "TWO", "FAN", "SHS", "LMC"] },
  { line: "TML", stations: ["WKS", "MOS", "HEO", "TSH", "SHM", "CIO", "STW", "CKT", "TAW", "HIK", "DIH", "KAT", "SUW", "TKW", "HOM", "HUH", "ETS", "AUS", "NAC", "MEF", "TWW", "KSR", "YUL", "LOP", "TIS", "SIH", "TUM"] },
  { line: "TCL", stations: ["HOK", "KOW", "OLY", "NAC", "LAK", "TSY", "SUN", "TUC"] },
  { line: "AEL", stations: ["HOK", "KOW", "TSY", "AIR", "AWE"] },
  { line: "SIL", stations: ["ADM", "OCP", "WCH", "LET", "SOH"] },
  { line: "DRL", stations: ["SUN", "DIS"] },
];
let lineRoutes = [];
let routesReady = false;
const scheduleCache = new Map();
const durationCache = new Map();
const geometryCache = new Map();
const trainMarkers = new Map();

function llMetres(point) {
  return [point[0] * 111320 * Math.cos(22.3 * Math.PI / 180), point[1] * 110540];
}

function llDist(a, b) {
  const am = llMetres(a);
  const bm = llMetres(b);
  return Math.hypot(am[0] - bm[0], am[1] - bm[1]);
}

function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function bearingDeg(a, b) {
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x) * 180 / Math.PI;
}

function projectOnPath(lon, lat, path) {
  let best = { offset: Infinity, along: 0, index: 0, t: 0 };
  let travel = 0;
  const point = llMetres([lon, lat]);
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const am = llMetres(a);
    const bm = llMetres(b);
    const dx = bm[0] - am[0];
    const dy = bm[1] - am[1];
    const seg = Math.hypot(dx, dy) || 0.001;
    const t = Math.max(0, Math.min(1, ((point[0] - am[0]) * dx + (point[1] - am[1]) * dy) / (dx * dx + dy * dy || 1)));
    const offset = Math.hypot(point[0] - (am[0] + t * dx), point[1] - (am[1] + t * dy));
    if (offset < best.offset) best = { offset, along: travel + seg * t, index: i, t };
    travel += seg;
  }
  return best;
}

function slicePath(path, from, to) {
  const reverse = to.along < from.along;
  const start = reverse ? to : from;
  const end = reverse ? from : to;
  const coords = [lerpPoint(path[start.index], path[start.index + 1], start.t)];
  for (let i = start.index + 1; i <= end.index; i += 1) coords.push(path[i]);
  coords.push(lerpPoint(path[end.index], path[end.index + 1], end.t));
  const cleaned = [coords[0]];
  coords.slice(1).forEach((point) => {
    if (llDist(cleaned[cleaned.length - 1], point) > 3) cleaned.push(point);
  });
  if (cleaned.length < 2) cleaned.push(coords[coords.length - 1]);
  return reverse ? cleaned.reverse() : cleaned;
}

function segmentGeometry(route, fromStation, toStation) {
  const key = route.line + ":" + fromStation.code + ":" + toStation.code;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const paths = network.lines.find((line) => line.code === route.line).paths;
  let geometry = null;
  let bestScore = Infinity;
  paths.forEach((path) => {
    const from = projectOnPath(fromStation.lon, fromStation.lat, path);
    const to = projectOnPath(toStation.lon, toStation.lat, path);
    if (from.offset < 450 && to.offset < 450) {
      const score = from.offset + to.offset;
      if (score < bestScore) {
        bestScore = score;
        geometry = slicePath(path, from, to);
      }
    }
  });
  if (!geometry) {
    const fromChoices = paths.map((path) => ({ path, proj: projectOnPath(fromStation.lon, fromStation.lat, path) }));
    const toChoices = paths.map((path) => ({ path, proj: projectOnPath(toStation.lon, toStation.lat, path) }));
    const fromBest = fromChoices.reduce((best, item) => item.proj.offset < best.proj.offset ? item : best);
    const toBest = toChoices.reduce((best, item) => item.proj.offset < best.proj.offset ? item : best);
    const fromEnd = llDist(fromBest.path[0], toBest.path[0]) < llDist(fromBest.path[fromBest.path.length - 1], toBest.path[0])
      ? { along: 0, index: 0, t: 0 }
      : projectOnPath(fromBest.path[fromBest.path.length - 1][0], fromBest.path[fromBest.path.length - 1][1], fromBest.path);
    const toStart = { along: 0, index: 0, t: 0 };
    geometry = slicePath(fromBest.path, fromBest.proj, fromEnd).concat(slicePath(toBest.path, toStart, toBest.proj));
  }
  geometryCache.set(key, geometry);
  return geometry;
}

function pointAlong(coords, fraction) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const length = llDist(coords[i], coords[i + 1]);
    lengths.push(length);
    total += length;
  }
  let target = total * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.max(0, Math.min(1, target / lengths[i])) : 0;
      return {
        point: lerpPoint(coords[i], coords[i + 1], t),
        bearing: bearingDeg(coords[i], coords[i + 1]),
      };
    }
    target -= lengths[i];
  }
  return { point: coords[coords.length - 1], bearing: 0 };
}

function ensureRoutes() {
  if (routesReady || !network.lines.length) return;
  LINE_ROUTES.forEach((definition) => {
    const stations = definition.stations.map((code) => stationByCode.get(code)).filter(Boolean);
    if (stations.length < 2) return;
    const color = lineByCode.get(definition.line).color;
    lineRoutes.push({ line: definition.line, viaRac: !!definition.viaRac, stations, color });
    lineRoutes.push({ line: definition.line, viaRac: !!definition.viaRac, stations: stations.slice().reverse(), color });
  });
  routesReady = true;
}

function stationInside(station, bounds, padLon, padLat) {
  return station.lon >= bounds.getWest() - padLon && station.lon <= bounds.getEast() + padLon
    && station.lat >= bounds.getSouth() - padLat && station.lat <= bounds.getNorth() + padLat;
}

function stationJobsInView() {
  const bounds = map.getBounds();
  const padLon = (bounds.getEast() - bounds.getWest()) * 0.15;
  const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.15;
  const visible = new Set(network.stations.filter((station) => stationInside(station, bounds, padLon, padLat)).map((station) => station.code));
  const jobs = new Map();
  lineRoutes.forEach((route) => {
    route.stations.forEach((station, index) => {
      const nearby = visible.has(station.code)
        || (index > 0 && visible.has(route.stations[index - 1].code))
        || (index + 1 < route.stations.length && visible.has(route.stations[index + 1].code));
      if (nearby) jobs.set(route.line + ":" + station.code, { line: route.line, code: station.code });
    });
  });
  return [...jobs.values()];
}

function trainsToward(route, index) {
  const cached = scheduleCache.get(route.line + ":" + route.stations[index].code);
  if (!cached || cached.error) return [];
  const ahead = new Set(route.stations.slice(index).map((station) => station.code));
  return cached.up.concat(cached.down).filter((train) => {
    if (route.line === "EAL" && route.viaRac !== (train.route === "RAC")) return false;
    return ahead.has(train.dest);
  });
}

function segmentDuration(route, index) {
  const key = route.line + ":" + route.stations[index].code + ":" + route.stations[index + 1].code + ":" + (route.viaRac ? "R" : "N");
  const saved = durationCache.get(key);
  if (saved && Date.now() - saved.at < 120000) return saved.ms;
  const samples = [];
  trainsToward(route, index).forEach((earlier) => {
    const earlierTime = parseHongKongTime(earlier.time);
    if (!earlierTime) return;
    let best = null;
    trainsToward(route, index + 1).forEach((later) => {
      if (later.dest !== earlier.dest) return;
      const laterTime = parseHongKongTime(later.time);
      if (!laterTime) return;
      const gap = laterTime.getTime() - earlierTime.getTime();
      if (gap >= TRAIN_SEGMENT_MIN_MS && gap <= TRAIN_SEGMENT_MAX_MS && (best === null || gap < best)) best = gap;
    });
    if (best) samples.push(best);
  });
  if (!samples.length) return null;
  samples.sort((left, right) => left - right);
  const ms = samples[Math.floor(samples.length / 2)];
  durationCache.set(key, { ms, at: Date.now() });
  return ms;
}

function computePlacedTrains(nowMs) {
  const placed = [];
  const seen = new Set();
  lineRoutes.forEach((route) => {
    for (let index = 0; index < route.stations.length - 1; index += 1) {
      const duration = segmentDuration(route, index);
      if (!duration) continue;
      const nextStation = route.stations[index + 1];
      trainsToward(route, index + 1).forEach((train) => {
        const arrival = parseHongKongTime(train.time);
        if (!arrival) return;
        const depart = arrival.getTime() - duration;
        if (nowMs < depart || nowMs > arrival.getTime()) return;
        const id = route.line + "|" + train.dest + "|" + arrival.getTime() + "|" + (route.viaRac ? "R" : "N");
        if (seen.has(id)) return;
        const geometry = segmentGeometry(route, route.stations[index], nextStation);
        if (!geometry || geometry.length < 2) return;
        const at = pointAlong(geometry, (nowMs - depart) / duration);
        seen.add(id);
        placed.push({
          id,
          point: at.point,
          bearing: at.bearing,
          color: route.color,
          dest: train.dest,
          line: route.line,
          next: nextStation,
          arrive: arrival,
          viaRac: route.viaRac,
        });
      });
    }
  });
  return placed;
}

function showTrainDetail(train) {
  requestToken += 1;
  selectStationFeature("");
  const destination = stationByCode.get(train.dest);
  const line = lineByCode.get(train.line);
  const minutes = Math.round((train.arrive.getTime() - Date.now()) / 60000);
  clearNode(detail);
  detail.append(el("h2", null, "往" + (destination ? destination.name : train.dest)));
  detail.append(el("p", "meta", line ? line.name : train.line));
  if (train.viaRac) detail.append(el("p", "meta", "經馬場"));
  detail.append(el("p", null, minutes <= 0 ? "即將到" + train.next.name : "約 " + minutes + " 分鐘到" + train.next.name));
  revealDetail();
}

function clearTrainMarkers() {
  trainMarkers.forEach((marker) => marker.remove());
  trainMarkers.clear();
}

function renderMovingTrains() {
  if (!map || map.getZoom() < TRAIN_ZOOM) {
    clearTrainMarkers();
    return;
  }
  const placed = computePlacedTrains(Date.now());
  const seen = new Set();
  placed.forEach((train) => {
    seen.add(train.id);
    let marker = trainMarkers.get(train.id);
    if (!marker) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "train-marker";
      node.setAttribute("aria-label", "列車");
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        showTrainDetail(marker._train);
      });
      marker = new maplibregl.Marker({ element: node, rotationAlignment: "map" }).setLngLat(train.point).addTo(map);
      trainMarkers.set(train.id, marker);
    }
    marker._train = train;
    marker.setLngLat(train.point);
    marker.setRotation(train.bearing + 90);
  });
  trainMarkers.forEach((marker, id) => {
    if (!seen.has(id)) {
      marker.remove();
      trainMarkers.delete(id);
    }
  });
}

function refreshTrainSchedules() {
  if (!map || map.getZoom() < TRAIN_ZOOM || document.hidden) return;
  ensureRoutes();
  const jobs = stationJobsInView().filter((job) => {
    const cached = scheduleCache.get(job.line + ":" + job.code);
    return !cached || Date.now() - cached.fetchedAt > 30000;
  });
  if (!jobs.length) {
    renderMovingTrains();
    return;
  }
  Promise.all(jobs.map((job) => fetchLine(job.line, job.code))).then((results) => {
    results.forEach((result, index) => {
      scheduleCache.set(jobs[index].line + ":" + jobs[index].code, {
        ...result,
        fetchedAt: Date.now(),
      });
    });
    durationCache.clear();
    renderMovingTrains();
  });
}

function updateTrainsForView() {
  if (!map || map.getZoom() < TRAIN_ZOOM) {
    clearTrainMarkers();
    return;
  }
  ensureRoutes();
  refreshTrainSchedules();
}

function createMap() {
  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [114.15, 22.35],
    zoom: 10.5,
    attributionControl: true,
    dragRotate: false,
    pitchWithRotate: false,
    localIdeographFontFamily: '"PingFang HK", "Heiti TC", "Noto Sans CJK TC", sans-serif',
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("error", () => {
    if (!map.isStyleLoaded()) showBanner(BASEMAP_MESSAGE);
  });
  map.on("load", () => {
    clearBanner(BASEMAP_MESSAGE);
    map.addSource("mtr-lines", { type: "geojson", data: lineFeatures() });
    map.addLayer({
      id: "mtr-lines",
      type: "line",
      source: "mtr-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 13, 4, 16, 7],
        "line-opacity": 0.92,
      },
    });
    map.addSource("cameras", {
      type: "geojson",
      data: cameraFeatures([]),
      cluster: true,
      clusterRadius: 42,
      clusterMaxZoom: CAMERA_ZOOM,
      promoteId: "key",
    });
    map.addLayer({
      id: "camera-clusters",
      type: "circle",
      source: "cameras",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#9a5b3c",
        "circle-opacity": 0.88,
        "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 80, 24],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    });
    map.addLayer({
      id: "camera-counts",
      type: "symbol",
      source: "cameras",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: { "text-color": "#fff" },
    });
    map.addLayer({
      id: "camera-points",
      type: "circle",
      source: "cameras",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#9a5b3c",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fff",
      },
    });
    map.addSource("stations", { type: "geojson", data: stationFeatures(), promoteId: "code" });
    map.addLayer({
      id: "stations",
      type: "circle",
      source: "stations",
      paint: {
        "circle-color": "#fff",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 6],
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 2],
        "circle-stroke-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0f6e6e", "#1d2430"],
      },
    });
    map.addLayer({
      id: "station-labels",
      type: "symbol",
      source: "stations",
      minzoom: 12.4,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": "#1d2430",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.3,
      },
    });
    map.on("click", handleMapClick);
    map.on("mouseenter", "stations", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "stations", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "camera-points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "camera-points", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "camera-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "camera-clusters", () => { map.getCanvas().style.cursor = ""; });
    if (selectedStation) {
      map.setFeatureState({ source: "stations", id: selectedStation }, { selected: true });
    }
    map.on("moveend", () => {
      updateCamerasForView();
      updateTrainsForView();
    });
    applyLayerToggles();
    fitAll();
    updateCamerasForView();
  });
}

function featureDistance(feature, point) {
  const projected = map.project(feature.geometry.coordinates);
  return Math.hypot(projected.x - point.x, projected.y - point.y);
}

function closestFeature(features, point) {
  return features.reduce((best, feature) => {
    return featureDistance(feature, point) < featureDistance(best, point) ? feature : best;
  });
}

function handleMapClick(event) {
  const pad = 8;
  const box = [
    [event.point.x - pad, event.point.y - pad],
    [event.point.x + pad, event.point.y + pad],
  ];
  const stationHits = map.queryRenderedFeatures(box, { layers: ["stations", "station-labels"] });
  const cameraHits = map.queryRenderedFeatures(box, { layers: ["camera-points"] });
  const choices = [];
  if (stationHits.length) choices.push({ kind: "station", feature: closestFeature(stationHits, event.point) });
  if (cameraHits.length) choices.push({ kind: "camera", feature: closestFeature(cameraHits, event.point) });
  if (choices.length) {
    choices.sort((left, right) => featureDistance(left.feature, event.point) - featureDistance(right.feature, event.point));
    const chosen = choices[0];
    if (chosen.kind === "station") {
      const station = stationByCode.get(chosen.feature.properties.code);
      if (station) openStation(station);
      return;
    }
    openCamera(chosen.feature.properties, chosen.feature.geometry.coordinates);
    return;
  }
  const clusters = map.queryRenderedFeatures(box, { layers: ["camera-clusters"] });
  if (!clusters.length) return;
  const cluster = clusters[0];
  const clusterId = cluster.properties.cluster_id;
  map.getSource("cameras").getClusterExpansionZoom(clusterId).then((zoom) => {
    map.easeTo({ center: cluster.geometry.coordinates, zoom });
  }).catch(() => {});
}

toggleMtr.addEventListener("change", applyLayerToggles);
toggleCam.addEventListener("change", applyLayerToggles);
document.querySelector("#reset").addEventListener("click", () => {
  requestToken += 1;
  selectStationFeature("");
  renderEmptyDetail();
  fitAll();
});
searchInput.addEventListener("input", () => showSearch(searchInput.value));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateTrainsForView();
});
setInterval(() => {
  if (!document.hidden) renderMovingTrains();
}, 1000);

loadJson("data/network.json").then((data) => {
  network = data;
  stationByCode = new Map(network.stations.map((station) => [station.code, station]));
  lineByCode = new Map(network.lines.map((line) => [line.code, line]));
  renderLegend();
}).catch(() => {
  showBanner("暫時未能載入港鐵網絡。");
}).finally(() => {
  updateSummary();
  if (searchInput.value.trim()) showSearch(searchInput.value);
  createMap();
});

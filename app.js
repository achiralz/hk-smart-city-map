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
let cameras = [];
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

function cameraFeatures() {
  return {
    type: "FeatureCollection",
    features: cameras.map((camera) => ({
      type: "Feature",
      id: camera.key,
      properties: camera,
      geometry: { type: "Point", coordinates: [camera.lon, camera.lat] },
    })),
  };
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

function trainRow(train) {
  const minutes = String(train.ttnt);
  const when = minutes === "0" ? "即將到站" : minutes + " 分鐘";
  const row = el("div", "train");
  row.append(el("div", "when", when));
  const bits = [];
  if (train.plat) bits.push(train.plat + " 號月台");
  if (train.time && String(train.time).length >= 16) bits.push(String(train.time).slice(11, 16));
  if (train.valid === "N") bits.push("預計時間");
  if (bits.length) row.append(el("div", "sub", bits.join(" · ")));
  return row;
}

function renderDestination(trains) {
  const destination = stationByCode.get(trains[0].dest);
  const block = el("div", "direction");
  block.append(el("h4", null, "往" + (destination ? destination.name : trains[0].dest)));
  trains.forEach((train) => block.append(trainRow(train)));
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
      groupByDestination(trains).forEach((group) => section.append(renderDestination(group)));
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
  const cameraHits = text.length >= 2
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
      data: cameraFeatures(),
      cluster: true,
      clusterRadius: 42,
      clusterMaxZoom: 13,
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
    applyLayerToggles();
    fitAll();
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

Promise.allSettled([loadJson("data/network.json"), loadJson("data/cameras.json")]).then(([networkResult, cameraResult]) => {
  if (networkResult.status === "fulfilled") {
    network = networkResult.value;
    stationByCode = new Map(network.stations.map((station) => [station.code, station]));
    lineByCode = new Map(network.lines.map((line) => [line.code, line]));
    renderLegend();
  } else {
    showBanner("暫時未能載入港鐵網絡。");
  }
  if (cameraResult.status === "fulfilled") {
    cameras = cameraResult.value;
  } else {
    showBanner("暫時未能載入交通快拍點。");
  }
  const stationText = network.stations.length ? network.stations.length + " 個港鐵站" : "港鐵網絡未能載入";
  const cameraText = cameras.length ? cameras.length + " 個交通快拍點" : "交通快拍暫時未能載入";
  summary.textContent = stationText + " · " + cameraText;
  if (searchInput.value.trim()) showSearch(searchInput.value);
  createMap();
});

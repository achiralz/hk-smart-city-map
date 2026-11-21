# 香港智慧城市地圖

一幅可互動的香港地圖。打開後可以看到十條港鐵重鐵和運輸署的交通快拍點。點選車站可查即將到站的班次，點選快拍點可看該處最新照片。暫時沒有資料時，畫面上會直接說明。

## 預覽

在專案資料夾執行：

```bash
python3 -m http.server 8765
```

然後用瀏覽器打開 http://127.0.0.1:8765/

## 可以做什麼

- 拖動、縮放地圖，或按「顯示全港」回到整個網絡。
- 搜尋車站或快拍地點。常用異體字也可以找到，例如「荔景」「宋皇台」。
- 放大後，小列車會沿軌道移動。速度用相鄰兩站的到站時間差計算，只顯示目前畫面裡的車。
- 點選車站，查看每條綫最多四班即將到達的列車，包括目的地、月台和大約幾分鐘。
- 東鐵班次若經馬場而不經火炭，該列會標明「經馬場」。
- 點選快拍點才會讀取那一張最新 JPEG。地圖縮小時不載入快拍點；放大到看得見的範圍後，才顯示畫面內的點。
- 可以用圖層開關分別隱藏港鐵網絡或交通快拍。

## 資料來源

| 內容 | 來源 |
| --- | --- |
| 底圖 | [OpenFreeMap](https://openfreemap.org/) 公開服務，地圖資料來自 OpenStreetMap |
| 車站名稱、路綫和次序 | [港鐵綫及車站](https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv) |
| 到站班次 | [港鐵實時列車服務資訊](https://data.gov.hk/tc-data/dataset/mtr-data2-nexttrain-data) |
| 車站位置 | [地政總署地圖搜尋](https://www.map.gov.hk/gs/api/v1.0.0/locationSearch) |
| 快拍點位置和照片 | [運輸署交通情況快拍圖像](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images) |

港鐵範圍是這份到站資料涵蓋的十條重鐵，共 98 個車站，包括馬場站。路綫不是車站之間的直線，而是跟隨 OpenStreetMap 上的港鐵軌道。東鐵主線經火炭；經馬場的繞道另畫成沙田、馬場、大學。落馬洲和康城同樣沿實際支線連接。輕鐵不在這個頁面。

快拍位置檔在建置時下載並存成 `data/cameras.json`。照片則在點選時直接向運輸署讀取最新影像。

## 更新內置資料

需要 Python 3。執行：

```bash
python3 scripts/build_data.py
```

這個指令會重新取得車站名單、車站座標和繁體快拍位置檔，並覆寫 `data/network.json` 與 `data/cameras.json`。

## 檔案

- `index.html`、`styles.css`、`app.js`：網頁
- `data/`：車站網絡和快拍點
- `scripts/build_data.py`：整理上述資料
- `vendor/`：頁面使用的 [MapLibre GL JS](https://maplibre.org/)

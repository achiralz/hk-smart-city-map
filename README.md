# 香港智慧城市地圖

一幅可互動的香港地圖。地圖上有十條港鐵重鐵，路綫跟隨真實軌道。放大後可以看到小列車沿路行走，以及畫面內的交通快拍點。點選車站可查即將到站的班次，點選快拍點可看該處最新照片。暫時沒有資料時，畫面上會直接說明。

目前的 `main` 是這個版本。較早的地圖保留在 [0.6](https://github.com/achiralz/hk-smart-city-map/tree/0.6)。

## 預覽

在專案資料夾執行：

```bash
python3 -m http.server 8765
```

然後用瀏覽器打開 http://127.0.0.1:8765/

## 可以做什麼

- 拖動、縮放地圖，或按「顯示全港」回到整個網絡。
- 搜尋車站或快拍地點。常用異體字也可以找到，例如「荔景」「荔枝角」「宋皇台」「恒安」。
- 點選車站，查看該站每條綫最多四班即將到達的列車，包括目的地、月台和大約幾分鐘。倒數用班次時間和資料時間計算，時區固定為香港。
- 東鐵班次若經馬場而不經火炭，班次和地圖上的小列車都會標明「經馬場」。
- 放大到看得到車站後，小列車才出現，並沿軌道移動。每一段路的速度，用上一站和下一站的到站時間差，除以該段軌道的實際長度。點選小列車可看它往哪裡、大約幾分鐘到下一站。縮回全港、或離開這個分頁時，小列車會收起，也不再查詢。
- 交通快拍同樣在放大後才載入，而且只顯示目前畫面裡的點。點選一個點，才讀取那一張最新照片。
- 可以用圖層開關分別隱藏港鐵網絡或交通快拍。

## 資料來源

| 內容 | 來源 |
| --- | --- |
| 底圖 | [OpenFreeMap](https://openfreemap.org/) 公開服務，地圖資料來自 OpenStreetMap |
| 路綫形狀 | OpenStreetMap 的港鐵軌道 |
| 車站名稱、路綫和次序 | [港鐵綫及車站](https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv) |
| 到站班次 | [港鐵實時列車服務資訊](https://data.gov.hk/tc-data/dataset/mtr-data2-nexttrain-data) |
| 車站位置 | [地政總署地圖搜尋](https://www.map.gov.hk/gs/api/v1.0.0/locationSearch) |
| 快拍點位置和照片 | [運輸署交通情況快拍圖像](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images) |

港鐵範圍是這份到站資料涵蓋的十條重鐵，共 98 個車站，包括馬場站。東鐵主線經火炭；經馬場的班次改走沙田、馬場、大學。落馬洲和康城沿實際支線連接。輕鐵不在這個頁面。

到站班次和快拍照片都是點選時才向官方接口讀取。快拍位置檔在建置時下載，存成 `data/cameras.json`，瀏覽時只取出畫面內的點。

## 更新內置資料

需要 Python 3。執行：

```bash
python3 scripts/build_data.py
```

這個指令會重新取得車站名單、車站座標、軌道形狀和繁體快拍位置檔，並覆寫 `data/network.json` 與 `data/cameras.json`。若只想更新軌道形狀，可執行：

```bash
python3 scripts/build_data.py tracks
```

## 檔案

- `index.html`、`styles.css`、`app.js`：網頁
- `images/train.png`：地圖上的小列車圖示
- `data/`：車站網絡、軌道形狀和快拍點
- `scripts/build_data.py`：整理上述資料
- `vendor/`：頁面使用的 [MapLibre GL JS](https://maplibre.org/)

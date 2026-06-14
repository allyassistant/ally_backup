# iOS Shortcuts × Rapaport 計價器 配置指南

## 一、Mac 端設置

### 1. 啟動 API Server

```bash
cd /Users/ally/.openclaw/workspace
node scripts/rapaport-api.js
```

**成功後會顯示：**
```
═══════════════════════════════════════
  💎 Rapaport API Server
  iOS Shortcuts Integration
═══════════════════════════════════════

📡 Server running on:
   Local:   http://localhost:3456
   Network: http://localhost:3456

🔑 API Key: ally2024

✅ Ready for iOS Shortcuts!
```

### 2. 設置開機自動啟動（可選）

**方法 A：使用 launchd**
```bash
# 創建 plist 檔案
cat > ~/Library/LaunchAgents/com.ally.rapaport-api.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ally.rapaport-api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/ally/.openclaw/workspace/scripts/rapaport-api.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/ally/.openclaw/workspace/logs/rapaport-api.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/ally/.openclaw/workspace/logs/rapaport-api.error.log</string>
</dict>
</plist>
EOF

# 載入服務
launchctl load ~/Library/LaunchAgents/com.ally.rapaport-api.plist
```

---

## 二、iPhone Shortcuts 設置

### 步驟 1：創建新 Shortcut

1. 打開 **Shortcuts App**
2. 點擊右上角 **+**
3. 命名：`Rapaport 計價器`

### 步驟 2：添加動作

#### 動作 1：選擇形狀
- 搜索：`選擇` 或 `Choose from Menu`
- 類型：**從選單中選擇**
- 提示文字：`選擇形狀`
- 選項：
  - `RBC` (Round Brilliant)
  - `PR` (Princess)
  - `PS` (Pear)
  - `CU` (Cushion)
  - `OV` (Oval)
  - `EM` (Emerald)
  - `RAD` (Radiant)
  - `HS` (Heart)
  - `MQ` (Marquise)

**設置 Magic Variable：**
- 點擊 `選擇的項目`
- 改名為：`shape`

---

#### 動作 2：輸入卡數
- 搜索：`詢問輸入` 或 `Ask for Input`
- 提示文字：`輸入卡數（例：5.01）`
- 輸入類型：**數字**
- 預設值：`1.00`

**設置 Magic Variable：**
- 改名為：`carat`

---

#### 動作 3：選擇顏色
- 類型：**從選單中選擇**
- 提示文字：`選擇顏色`
- 選項：
  - `D`
  - `E`
  - `F`
  - `G`
  - `H`
  - `I`
  - `J`
  - `K`
  - `L`
  - `M`

**設置 Magic Variable：**
- 改名為：`color`

---

#### 動作 4：選擇淨度
- 類型：**從選單中選擇**
- 提示文字：`選擇淨度`
- 選項：
  - `FL` (Flawless)
  - `IF` (Internally Flawless)
  - `VVS1`
  - `VVS2`
  - `VS1`
  - `VS2`
  - `SI1`
  - `SI2`

**設置 Magic Variable：**
- 改名為：`clarity`

---

#### 動作 5：輸入折扣
- 類型：**詢問輸入**
- 提示文字：`輸入折扣（例：-15 表示 Back 15%）`
- 輸入類型：**數字**
- 預設值：`-15`

**設置 Magic Variable：**
- 改名為：`discount`

---

#### 動作 6：準備 JSON 字典
- 搜索：`字典` 或 `Dictionary`
- 類型：**字典**
- 添加鍵值：
  - `shape` → 選擇變數 `shape`
  - `carat` → 選擇變數 `carat`
  - `color` → 選擇變數 `color`
  - `clarity` → 選擇變數 `clarity`
  - `discount` → 選擇變數 `discount`

**設置 Magic Variable：**
- 改名為：`requestBody`

---

#### 動作 7：發送 HTTP POST 請求
- 搜索：`取得 URL` 或 `Get Contents of URL`
- URL：`http://localhost:3456/calculate`
- 方法：**POST**
- 標頭：
  - `Content-Type` → `application/json`
  - `Authorization` → `Bearer ally2024`
- 請求體：選擇 `requestBody` (字典)

**設置 Magic Variable：**
- 改名為：`apiResponse`

---

#### 動作 8：解析 JSON 回應
- 搜索：`取得字典值` 或 `Get Dictionary Value`
- 從 `apiResponse` 獲取
- 鍵：`result`

**設置 Magic Variable：**
- 改名為：`result`

---

#### 動作 9：獲取具體數值

**獲取表格值：**
- 類型：**取得字典值**
- 從 `result` 獲取
- 鍵：`tableValue`
- 改名為：`tableValue`

**獲取總價：**
- 類型：**取得字典值**
- 從 `result` 獲取
- 鍵：`totalPriceFormatted`
- 改名為：`priceFormatted`

**獲取基礎價格：**
- 類型：**取得字典值**
- 從 `result` 獲取
- 鍵：`basePrice`
- 改名為：`basePrice`

---

#### 動作 10：格式化輸出
- 搜索：`文字` 或 `Text`
- 內容：
```
💎 Rapaport 報價

形狀：【shape】 【carat】ct
規格：【color】 【clarity】
表格值：【tableValue】
基礎價：USD 【basePrice】
折扣：【discount】%

💰 總價：【priceFormatted】

由 Ally AI 計算
```

**注意：** 將 【】 內的文字替換為對應的 Magic Variable

---

#### 動作 11：顯示結果
- 搜索：`顯示提示` 或 `Show Alert`
- 標題：`報價結果`
- 內容：選擇上一步的文字

#### 動作 12（可選）：複製到剪貼板
- 搜索：`複製到剪貼板` 或 `Copy to Clipboard`
- 方便貼到 WhatsApp 或郵件

---

## 三、測試

### Mac 端測試
```bash
curl -X POST http://localhost:3456/calculate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ally2024" \
  -d '{"shape":"PS","carat":5.01,"color":"G","clarity":"VS1","discount":-15}'
```

**預期回應：**
```json
{
  "success": true,
  "input": {
    "shape": "PS",
    "carat": 5.01,
    "color": "G",
    "clarity": "VS1",
    "discount": -15
  },
  "result": {
    "tableValue": 425,
    "totalPriceFormatted": "$180,986.25"
  }
}
```

### iPhone 端測試
1. 確保 iPhone 同 Mac 在同一 WiFi
2. 運行 Shortcut
3. 輸入測試數據：
   - 形狀：PS
   - 卡數：5.01
   - 顏色：G
   - 淨度：VS1
   - 折扣：-15

**預期結果：** USD 180,986.25

---

## 四、故障排除

### 問題：連接超時
**解決：**
1. 確保 Mac 同 iPhone 在同一 WiFi
2. 檢查 Mac 防火牆設定
3. 嘗試用 IP 地址代替 `localhost`
   - 獲取 Mac IP：`ifconfig | grep "inet "`
   - URL 改為：`http://192.168.1.XXX:3456`

### 問題：401 Unauthorized
**解決：**
- 檢查 Authorization Header 是否為 `Bearer ally2024`

### 問題：找不到數據庫
**解決：**
- 確保已運行 `scripts/update_rapaport_universal.js` 更新數據

### 問題：Shortcuts 閃退
**解決：**
- 重啟 Shortcuts App
- 檢查所有 Magic Variable 是否正確設置

---

## 五、進階功能

### Siri 語音觸發
1. 在 Shortcut 設置中添加 **Siri 語音**
2. 設置短語：`「計價錢」`
3. 使用：`「嘿 Siri，計價錢」`

### 分享功能
- 點擊 `分享按鈕`
- 選擇 `添加到主畫面`
- 創建桌面快捷方式

### Widget 快速訪問
- 長按主畫面 → 添加 Widget
- 選擇 Shortcuts
- 選擇 `Rapaport 計價器`

---

## 六、安全建議

1. **更改 API Key**
   - 編輯 `rapaport-api.js`
   - 修改 `const API_KEY = '你的新密碼'`
   - 同步更新 Shortcuts 中的 Authorization

2. **限制網絡訪問**
   - 如需更高安全性，可限制僅本地網絡訪問
   - 修改 `app.listen(PORT, '0.0.0.0', ...)` 為 `'127.0.0.1'`
   - 使用 VPN 連接

3. **定期更新**
   - 保持 `rapaport_db.json` 最新
   - 每月更新 Rapaport 價格表

---

**完成！🎉**

你而家可以隨時隨地用 iPhone 快速計算 Rapaport 價格！
---
id: "023-dn-memo-rapaport-v2"
title: "DN Memo Rapaport v2 開發"
status: "completed"
priority: "P1"
created: "2026-02-25"
due: "2026-03-01"
---

# DN Memo Rapaport v2 - ✅ 已完成

## 狀態：已上傳 GitHub ✅

## GitHub 連結
- **Repo:** https://github.com/allyassistant/rapaport-calculator
- **DN Memo App:** https://allyassistant.github.io/rapaport-calculator/dn_memo_app.html
- **Rapaport Calculator:** https://allyassistant.github.io/rapaport-calculator/rapaport_calculator_app.html

---

## 完成項目 (2026-03-01)

### 核心功能
| 功能 | 說明 | 狀態 |
|------|------|------|
| Import Excel | 從 Excel 檔案匯入庫存資料 | ✅ |
| Shape 分類選擇 | Select Shape 頁面顯示 All Shapes + 各 Shape | ✅ |
| Items 選擇 | 可 checkbox 選擇 items | ✅ |
| 實時數量顯示 | Submit button 顯示已選數量 | ✅ |
| Select All / Deselect All / Reset | 全選 / 取消全選 / 重置 | ✅ |
| Rapaport 價格計算 | 根據 Shape/Carat/Color/Clarity 自動計算 | ✅ |
| 手動輸入 Price/Ct & Amount | 可手動修改，自動銀碼格式 | ✅ |
| Submit 後清空 Selected items | Submit 後清除選擇狀態 | ✅ |
| X button 清除每行 | 清除該行，下面既會升上去 | ✅ |
| Clear All button | 一次過清除所有行 | ✅ |
| localStorage 儲存 | Import 既 data 會 save 去 localStorage | ✅ |
| Filter 功能 | All / White / Color filter buttons | ✅ |
| Filter button 顯示數量 | All (15) / White (10) / Color (5) | ✅ |
| 基本資料欄位 | Memo No, Date, To, Address, Tel, Dealer, Details | ✅ |
| Rapaport Data 日期顯示 | 底部顯示 Data: MM/DD/YY | ✅ |

### PDF 功能
| 功能 | 說明 | 狀態 |
|------|------|------|
| Custom PDF Template | 使用 pdf-lib 填寫 PDF form | ✅ |
| Memo No. Auto-generation | YYMMDD + daily count | ✅ |
| PDF Filename | memo<Memo No.>.pdf | ✅ |
| Discount default blank | 預設空白唔係 0 | ✅ |

### GitHub / Hosting
| 項目 | 說明 | 狀態 |
|------|------|------|
| 上傳 GitHub | dn_memo_app.html 已上傳 | ✅ |
| GitHub Pages | 已啟用，可用 URL 直接開 | ✅ |
| Load data.json | 自動讀取 repo 入面既 data.json | ✅ |
| index.html 改名 | 改為 rapaport_calculator_app.html | ✅ |
| iOS Icon | Discord 紫底 (#5865F2) + 白色 M | ✅ |

---

## 檔案結構 (GitHub Repo)
```
rapaport-calculator/
├── dn_memo_app.html              # DN Memorandum App
├── rapaport_calculator_app.html  # Rapaport Calculator (原名 index.html)
├── data.json                     # Rapaport 價格數據
└── README.md
```

---

*Status: ✅ Completed*
*Completed: 2026-03-01*
*Last Updated: 2026-03-01 16:45*

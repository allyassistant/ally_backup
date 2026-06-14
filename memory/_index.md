# 快速索引 (Quick Reference Index)

## 核心記憶 (Core Memory)
- **身份**: Josh 嘅私人秘書，鑽石業務專家
- **語言**: 廣東話優先
- **用戶**: Josh (+852XXXXXX, +852XXXXXX)

## 關鍵數據位置
| 數據 | 位置 | 大小 |
|------|------|------|
| Rapaport 價格 | `memory/rapaport_db.json` | 外部 |
| 鑽石庫存 | `memory/diamond_stock.json` | 外部 |
| 完整記憶 | `memory/_archive/MEMORY_FULL.md` | 按需載入 |

## 快速參考連結
- [精簡參考 → `_quickref.md`]
- [Excel 技巧 → `_skills/excel.md`]
- [鑽石市場 → `_skills/diamond.md`]
- [Rapaport 提取 → `_skills/rapaport.md`]

## 常用指令
```
查庫存: 讀取 diamond_stock.json
計價格: 讀取 rapaport_db.json
整 Excel: 使用 exceljs，V9 格式
新 PDF: 用 scripts/update_rapaport_universal.js
```

## Token 狀態
- 核心記憶: ~240 行
- 技能文件: 按需載入
- 歷史檔案: `_archive/` 目錄

# Excel 高級技巧 (Excel Advanced Techniques)

## 動態數組函數 (Excel 2021/365)

**FILTER** - 自動篩選:
```excel
=FILTER(inventory_range, inventory[Shape]="RBC", "No data")
```

**SORT / SORTBY** - 自動排序:
```excel
=SORTBY(inventory, inventory[Carat], -1, inventory[Color], 1)
```

**UNIQUE** - 提取唯一值:
```excel
=UNIQUE(inventory[Shape])
```

**LET** - 定義變量:
```excel
=LET(
  carat, B2,
  price_per_ct, VLOOKUP(...),
  total, carat * price_per_ct,
  total * 0.95
)
```

## 文字處理函數 (Excel 2024)

**TEXTBEFORE / TEXTAFTER**:
```excel
=TEXTBEFORE("Parcel: US01/0046", ":")  // "Parcel"
=TEXTAFTER("Parcel: US01/0046", ":")   // " US01/0046"
```

**TEXTSPLIT**:
```excel
=TEXTSPLIT("10.5-D-VVS1-EX", "-")
```

## 查找函數

**XLOOKUP** (推薦):
```excel
=XLOOKUP(lookup_value, lookup_range, return_range, [if_not_found], [match_mode])
```

**XMATCH**:
```excel
=XMATCH("D", color_range, 0, -1)  // -1 = 從最後搜索
```

## 條件格式

**公式示例**:
- 重複 GIA: `=COUNTIF($N:$N, $N2)>1`
- 價格異常: `=ABS(D2-AVERAGE(D:D))/AVERAGE(D:D)>0.2`

## Power Query (ETL)

**用途**:
- 自動導入合併多個文件
- 自動清理數據
- 設置刷新規則
- 適合整合多個 stock list

## Power Pivot

**用途**:
- 處理數百萬行數據
- 建立數據關聯
- DAX 公式:
```excel
=AVERAGE([Memo Price]/[Crt])
=CALCULATE(COUNTROWS(Inventory), Inventory[Shape]="RBC")
```

## VBA 自動化

**用途**:
- 一鍵執行重複任務
- 批量格式化
- 自動生成報告

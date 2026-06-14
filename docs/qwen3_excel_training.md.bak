# Qwen3 Excel 學習教材

## 模塊 1: 高級公式精通

### 1.1 XLOOKUP (現代查找之王)
```excel
=XLOOKUP(查找值, 查找範圍, 返回範圍, [如果找不到], [匹配模式], [搜索模式])

範例:
=XLOOKUP("D", A2:A11, B2:B11, "未找到", 0, 1)
查找 "D" 色，返回對應價格
```

### 1.2 SUMIFS 多條件求和
```excel
=SUMIFS(求和範圍, 條件範圍1, 條件1, 條件範圍2, 條件2...)

範例:
=SUMIFS(價格列, 形狀列, "RBC", 顏色列, "D", 淨度列, "IF")
計算 RBC + D色 + IF 的總價
```

### 1.3 FILTER 動態篩選
```excel
=FILTER(數據範圍, 包含條件, [如果為空])

範例:
=FILTER(A2:D100, (B2:B100="RBC")*(C2:C100>5))
篩選形狀=RBC 且卡數>5 的記錄
```

### 1.4 UNIQUE 提取唯一值
```excel
=UNIQUE(數據範圍, [按列], [恰好一次])

範例:
=UNIQUE(B2:B100)
提取所有不重的形狀類型
```

### 1.5 TEXTSPLIT 文本分割
```excel
=TEXTSPLIT(文本, [列分隔符], [行分隔符], [忽略空])

範例:
=TEXTSPLIT("RBC,PS,EM", ",")
分割成多列: RBC | PS | EM
```

---

## 模塊 2: 數據透視表精通

### 2.1 鑽石庫存分析 PivotTable
```
行標簽: 形狀 (Shape)
列標簽: 顏色 (Color)
值: Carat 求和, 數量計數
篩選: 淨度
```

### 2.2 動態圖表設置
1. 插入 PivotChart
2. 鏈接到 PivotTable
3. 設置自動刷新
4. 添加切片器 (Slicer)

---

## 模塊 3: Power Query 自動化

### 3.1 自動導入多個文件
```m
let
    Source = Folder.Files("C:\\Stock List"),
    Filtered = Table.SelectRows(Source, each Text.EndsWith([Name], ".xlsx")),
    Combined = Table.Combine(Filtered[Content])
in
    Combined
```

### 3.2 數據清洗步驟
1. 移除空行
2. 標準化列名
3. 數據類型轉換
4. 移除重複項
5. 添加自定義列

---

## 模塊 4: VBA 基礎

### 4.1 錄製宏並修改
```vba
Sub 格式化報表()
    ' 選擇全部數據
    Range("A1").CurrentRegion.Select
    
    ' 自動調整欄寬
    Selection.Columns.AutoFit
    
    ' 置中對齊
    Selection.HorizontalAlignment = xlCenter
    
    ' 添加邊框
    Selection.Borders.LineStyle = xlContinuous
End Sub
```

### 4.2 循環處理
```vba
Sub 處理多個工作表()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        ' 對每個工作表執行操作
        ws.Range("A1").Value = "已處理"
    Next ws
End Sub
```

---

## 模塊 5: Python + Excel

### 5.1 Pandas 讀寫 Excel
```python
import pandas as pd

# 讀取 Excel
df = pd.read_excel('stock_list.xlsx', sheet_name='Sheet1')

# 數據處理
filtered = df[(df['Shape'] == 'RBC') & (df['Carat'] > 5)]

# 保存到新文件
filtered.to_excel('filtered_stock.xlsx', index=False)
```

### 5.2 OpenPyXL 格式化
```python
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill

wb = Workbook()
ws = wb.active

# 添加數據
ws['A1'] = 'Rapaport Report'
ws['A1'].font = Font(bold=True, size=16, color='C8102E')
ws['A1'].alignment = Alignment(horizontal='center')

# 設置列寬
ws.column_dimensions['A'].width = 20

wb.save('formatted_report.xlsx')
```

### 5.3 XlsxWriter 高級功能
```python
import xlsxwriter

workbook = xlsxwriter.Workbook('chart_report.xlsx')
worksheet = workbook.add_worksheet()

# 創建格式
bold_red = workbook.add_format({
    'bold': True,
    'font_color': '#C8102E',
    'align': 'center'
})

# 寫入數據
worksheet.write('A1', 'Shape', bold_red)
worksheet.write('B1', 'Carat', bold_red)

# 添加圖表
chart = workbook.add_chart({'type': 'column'})
chart.add_series({'values': '=Sheet1!$B$2:$B$10'})
worksheet.insert_chart('D2', chart)

workbook.close()
```

---

## 實戰項目檢查清單

### 項目 1: 自動化 Stock List 整合
- [ ] 使用 Power Query 導入多文件
- [ ] 標準化格式 (全部置中, 自動欄寬)
- [ ] 驗證數據完整性
- [ ] 生成整合報告

### 項目 2: 智能報價單生成器
- [ ] 讀取 Rapaport 數據
- [ ] 計算折扣後價格
- [ ] 生成格式化報表
- [ ] 一鍵導出 PDF

### 項目 3: 庫存分析 Dashboard
- [ ] 創建 PivotTable
- [ ] 添加動態圖表
- [ ] 設置自動刷新
- [ ] 添加預警功能

---

## 學習資源

### 推薦網站
- Microsoft Excel 官方文檔
- ExcelJet (公式速查)
- Chandoo.org (進階技巧)
- Python-Excel.org

### YouTube 頻道
- ExcelIsFun
- Leila Gharani
- MyOnlineTrainingHub

---

*Created for Qwen3 Excel Training - 2026-02-06*

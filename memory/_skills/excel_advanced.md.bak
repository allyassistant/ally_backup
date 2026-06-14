# Excel 進階功能指南（鑽石業務專用）

## 目錄
1. [查找函數](#查找函數)
2. [樞紐表分析](#樞紐表分析)
3. [條件格式](#條件格式)
4. [統計函數](#統計函數)
5. [數據驗證](#數據驗證)
6. [Power Query](#power-query)
7. [VBA 自動化](#vba-自動化)
8. [最佳實踐](#最佳實踐)

---

## 查找函數

### VLOOKUP（垂直查找）

**用途**：根據 GIA 證書編號查找鑽石資料

```excel
=VLOOKUP(D2, StockDB!$A:$M, 3, FALSE)
```

**參數說明**：
- `D2`：要查找的值（GIA No）
- `StockDB!$A:$M`：資料範圍
- `3`：返回第 3 欄（Carat）
- `FALSE`：精確匹配

**實際應用**：
```excel
=VLOOKUP(B2, 'Stock List'!$A:$O, 5, FALSE)
```
根據 Parcel Name 查找 Color

### INDEX + MATCH（更靈活嘅查找）

**用途**：反向查找、多條件查找

```excel
=INDEX('Stock List'!$C:$C, MATCH(B2, 'Stock List'!$A:$A, 0))
```

**多條件查找**：
```excel
=INDEX($D:$D, MATCH(1, ($A:$A=GIA_No)*($B:$B=Shape), 0))
```
按 Ctrl+Shift+Enter 輸入（Excel 2019 以前版本）

### XLOOKUP（Excel 365/2021 推薦）

**用途**：最強大嘅查找函數

```excel
=XLOOKUP(GIA_No, 'Stock List'!$N:$N, 'Stock List'!$C:$C, "未找到", 0)
```

**參數**：
1. 查找值
2. 查找範圍
3. 返回範圍
4. 未找到時顯示
5. 匹配模式（0=精確）

**反向查找示例**：
```excel
=XLOOKUP(CertNo, CertColumn, ParcelColumn)
```

---

## 樞紐表分析

### 創建庫存分析樞紐表

**步驟**：
1. 選擇資料範圍 → 插入 → 樞紐表
2. 拖放欄位：
   - **列**：Shape
   - **欄**：Color
   - **值**：Count of Cert No / Sum of Carat

### 常用樞紐表配置

**按形狀統計**：
```
行標籤：Shape
值：Count of Cert No
```

**按顏色同淨度分類**：
```
行標籤：Color
列標籤：Clarity
值：Sum of Carat
```

**添加計算欄位**：
```excel
=MemoPrice/Carat
```
計算每卡價格

### 樞紐圖表

插入 → 樞紐圖 → 選擇圖表類型
- 柱狀圖：比較唔同形狀嘅庫存量
- 餅圖：顯示顏色分佈比例

---

## 條件格式

### 突出顯示特定規格

**高亮 10ct+ 鑽石**：
1. 選擇 Carat 欄
2. 開始 → 條件格式 → 新增規則
3. 使用公式：`=C2>=10`
4. 設置格式：紅色填充

**標記 Fancy Color**：
```excel
=ISNUMBER(SEARCH("F", E2))
```
如果 Color 欄包含 "F"（Fancy）就標記

**數據條（Data Bars）**：
用於視覺化比較 Memo Price

**色階（Color Scales）**：
用於顯示 Carat 大小分佈

---

## 統計函數

### SUMIF / SUMIFS（條件求和）

**計算特定形狀嘅總卡數**：
```excel
=SUMIF(B:B, "RBC", C:C)
```

**多條件求和**：
```excel
=SUMIFS(C:C, B:B, "RBC", E:E, "D")
```
計算 RBC D 色嘅總卡數

**計算特定範圍價格**：
```excel
=SUMIFS(O:O, C:C, ">=5", C:C, "<=10")
```
5-10ct 嘅總 Memo Price

### COUNTIF / COUNTIFS（條件計數）

**統計 GIA 證書數量**：
```excel
=COUNTIF(M:M, "GIA")
```

**統計特定規格組合**：
```excel
=COUNTIFS(B:B, "RBC", E:E, "D", F:F, "IF")
```
RBC D IF 嘅數量

### AVERAGEIF

**計算平均價格**：
```excel
=AVERAGEIF(B:B, "RBC", O:O)
```

---

## 數據驗證

### 限制輸入內容

**Shape 下拉選單**：
1. 選擇 Shape 欄
2. 資料 → 數據驗證
3. 允許：清單
4. 來源：`RBC,PR,PS,CU,OV,EM,RAD,HS,MQ,SEM`

**Carat 範圍限制**：
```
允許：小數
資料：介於
最小：0.01
最大：100
```

**自定義驗證（確保 GIA No 為 10 位數字）**：
```excel
=AND(ISNUMBER(N2), LEN(N2)=10)
```

---

## Power Query

### 自動導入 Stock List

**步驟**：
1. 資料 → 取得資料 → 從檔案 → 從 Excel 活頁簿
2. 選擇 Stock list 檔案
3. 選擇工作表 → 轉換資料

### 常用轉換操作

**變更欄位類型**：
- Carat → 小數
- Price → 貨幣

**新增自訂欄位**：
```
每卡價格 = [Memo Price] / [Carat]
```

**篩選資料**：
- 只保留 Carat >= 1.00
- 只保留有 GIA No 嘅行

**排序**：
1. Shape（自訂清單：RBC 先）
2. Carat（大→小）
3. Color（D→Z）

**關閉並載入至**：
選擇「僅建立連線」或「表格」

---

## VBA 自動化

### 錄製宏基礎

**步驟**：
1. 開發人員 → 錄製宏
2. 執行操作（如：設定格式）
3. 停止錄製
4. 檢視 VBA 代碼

### 常用宏示例

**自動設定 Stock List 格式**：
```vba
Sub FormatStockList()
    ' 設定標題列格式
    With Rows(1)
        .Font.Bold = True
        .HorizontalAlignment = xlCenter
    End With
    
    ' 自動調整欄寬
    Columns.AutoFit
    
    ' 設定數字格式
    Range("C:C").NumberFormat = "0.00"
    Range("O:O").NumberFormat = "#,##0.00"
End Sub
```

**快速查詢鑽石**：
```vba
Sub SearchDiamond()
    Dim searchGIA As String
    searchGIA = InputBox("輸入 GIA No:")
    
    If searchGIA <> "" Then
        Columns("N:N").Find(What:=searchGIA).Select
    End If
End Sub
```

### 添加按鈕執行宏

1. 開發人員 → 插入 → 表單控制項 → 按鈕
2. 指定宏
3. 編輯文字

---

## 最佳實踐

### Stock List 管理建議

**1. 統一命名規範**
- Parcel Name：`倉庫/編號` 格式
- Shape：使用標準簡寫（PR/PS/RBC 等）
- Color：D-Z 或 Fancy 代碼

**2. 定期備份**
- 每日自動備份到雲端
- 保留版本歷史

**3. 使用表格功能（Ctrl+T）**
- 自動擴展公式
- 結構化引用
- 自動篩選

**4. 建立摘要頁**
```excel
=COUNTA(Table1[Cert No])  ' 總數量
=SUM(Table1[Carat])       ' 總卡數
=AVERAGE(Table1[Memo Price]) ' 平均價格
```

### 公式最佳實踐

**使用結構化引用**：
```excel
=SUMIFS(Table1[Carat], Table1[Shape], "RBC")
```
代替：
```excel
=SUMIFS(C:C, B:B, "RBC")
```

**避免硬編碼**：
使用儲存格存放常量（如折扣率）

**錯誤處理**：
```excel
=IFERROR(VLOOKUP(...), "未找到")
```

---

## 快速參考卡

| 功能 | 快捷鍵 |
|------|--------|
| 自動求和 | Alt + = |
| 插入函數 | Shift + F3 |
| 選擇整欄 | Ctrl + Space |
| 選擇整行 | Shift + Space |
| 建立表格 | Ctrl + T |
| 開啟篩選 | Ctrl + Shift + L |
| 尋找 | Ctrl + F |
| 替換 | Ctrl + H |
| 前往 | Ctrl + G |
| VBA 編輯器 | Alt + F11 |

---

*由 Ally AI 整理 - 持續更新中*
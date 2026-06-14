# Excel VBA 基礎教程 - 鑽石庫存自動化

## 📚 目錄

1. [VBA 簡介](#1-vba-簡介)
2. [VBA 編輯器 (VBE)](#2-vba-編輯器-vbe)
3. [錄製宏](#3-錄製宏)
4. [模組、過程與函數](#4-模組過程與函數)
5. [變量與數據類型](#5-變量與數據類型)
6. [條件語句](#6-條件語句)
7. [迴圈](#7-迴圈)
8. [操作 Excel 對象](#8-操作-excel-對象)
9. [鑽石數據自動化實例](#9-鑽石數據自動化實例)
10. [完整項目代碼](#10-完整項目代碼)

---

## 1. VBA 簡介

### 什麼是 VBA？

**VBA (Visual Basic for Applications)** 是微軟開發的程式語言，內置於 Office 應用程式中。

### VBA 能做什麼？

| 功能 | 說明 |
|------|------|
| 自動化重複任務 | 一鍵完成格式化、數據處理 |
| 創建自定義函數 | 如計算鑽石價格的專用公式 |
| 操作多個工作表 | 批量生成報告 |
| 與用戶互動 | 彈出對話框、輸入框 |
| 連接外部數據 | 導入導出數據 |

### 為什麼學習 VBA？

```
情景：每天需要格式化 100 條鑽石記錄
手動操作：每次 5 分鐘 × 100 = 500 分鐘 (8+ 小時)
VBA 自動化：編寫一次，每次 1 秒 × 100 = 100 秒 (2 分鐘)
```

---

## 2. VBA 編輯器 (VBE)

### 如何打開 VBA 編輯器

**快捷鍵：Alt + F11**

或者：
1. 點擊「開發人員」選項卡
2. 點擊「Visual Basic」按鈕

### VBA 編輯器界面

```
┌─────────────────────────────────────────────────────────┐
│  VBAProject - DiamondInventory.xlsm                     │
│  ├─ Microsoft Excel 物件                                │
│  │   ├─ Sheet1 (庫存表)                                 │
│  │   ├─ Sheet2 (報告)                                   │
│  │   └─ ThisWorkbook                                    │
│  ├─ 模組                                                │
│  │   └─ Module1  ← 代碼寫在這裡                         │
│  └─ 表單                                                │
│      └─ UserForm1                                       │
└─────────────────────────────────────────────────────────┘
```

### 重要窗口

| 窗口 | 快捷鍵 | 用途 |
|------|--------|------|
| 專案總管 | Ctrl + R | 查看所有模組和工作表 |
| 屬性窗口 | F4 | 查看和修改對象屬性 |
| 即時運算 | Ctrl + G | 測試代碼片段 |
| 監看式 | - | 監控變量值 |

---

## 3. 錄製宏

### 什麼是宏 (Macro)？

宏是 VBA 代碼的錄製版本。Excel 會記錄你的操作並轉換為代碼。

### 錄製宏的步驟

1. **開啟錄製**：開發人員 → 錄製宏
2. **命名宏**：如 `FormatDiamondTable`
3. **執行操作**：格式化表格、設置顏色等
4. **停止錄製**：開發人員 → 停止錄製

### 查看錄製的代碼

```vba
' 這是錄製宏自動生成的代碼
Sub FormatDiamondTable()
    ' 選擇 A1 單元格
    Range("A1").Select
    
    ' 設置字體為粗體
    Selection.Font.Bold = True
    
    ' 設置背景顏色
    Selection.Interior.Color = RGB(200, 200, 200)
    
    ' 設置字體大小
    Selection.Font.Size = 12
End Sub
```

### 錄製宏的優缺點

| 優點 | 缺點 |
|------|------|
| 快速入門 | 代碼冗長 |
| 學習語法 | 使用 Select (效率低) |
| 無需編程基礎 | 不夠靈活 |

---

## 4. 模組、過程與函數

### 模組 (Module)

模組是存放 VBA 代碼的容器。

**創建模組**：
1. 在 VBA 編輯器中，右鍵點擊「插入」
2. 選擇「模組」

### 過程 (Sub)

過程是執行一系列操作的代碼塊，**不返回值**。

```vba
' Sub 語法結構
Sub 過程名稱()
    ' 代碼寫在這裡
End Sub

' 帶參數的 Sub
Sub 過程名稱(參數1 As 類型, 參數2 As 類型)
    ' 使用參數
End Sub
```

**範例**：

```vba
' 定義一個格式化標題的過程
Sub FormatHeader()
    ' 設置 A1 為標題格式
    Range("A1").Font.Bold = True
    Range("A1").Font.Size = 14
    Range("A1").Interior.Color = RGB(68, 114, 196)
    Range("A1").Font.Color = RGB(255, 255, 255)
End Sub

' 帶參數的過程
Sub FormatCell(cellAddress As String, fontSize As Integer)
    Range(cellAddress).Font.Size = fontSize
    Range(cellAddress).Font.Bold = True
End Sub

' 調用方式
Sub TestFormat()
    FormatCell "B2", 16      ' 格式化 B2，字體大小 16
    FormatCell "C3", 20      ' 格式化 C3，字體大小 20
End Sub
```

### 函數 (Function)

函數是**返回值**的代碼塊，可以在 Excel 公式中使用。

```vba
' Function 語法結構
Function 函數名稱(參數 As 類型) As 返回類型
    ' 計算邏輯
    函數名稱 = 返回值
End Function
```

**範例**：

```vba
' 計算鑽石價格的函數
Function CalculateDiamondPrice(carat As Double, pricePerCarat As Double) As Double
    ' 計算總價 = 克拉數 × 每克拉價格
    CalculateDiamondPrice = carat * pricePerCarat
End Function

' 帶折扣的價格計算
Function CalculateDiscountedPrice(originalPrice As Double, discountPercent As Double) As Double
    ' 計算折扣後價格
    CalculateDiscountedPrice = originalPrice * (1 - discountPercent / 100)
End Function

' 判斷鑽石等級的函數
Function GetDiamondGrade(color As String, clarity As String) As String
    If color = "D" And clarity = "FL" Then
        GetDiamondGrade = "頂級"
    ElseIf color <= "F" And clarity <= "VVS1" Then
        GetDiamondGrade = "優質"
    Else
        GetDiamondGrade = "標準"
    End If
End Function
```

**在 Excel 中使用自定義函數**：

```
=CalculateDiamondPrice(A2, B2)      ' A2=克拉數, B2=每克拉價格
=GetDiamondGrade(C2, D2)            ' C2=顏色, D2=淨度
```

---

## 5. 變量與數據類型

### 什麼是變量？

變量是存儲數據的容器，可以在程式運行過程中改變值。

### 聲明變量

```vba
Dim 變量名稱 As 數據類型
```

### 常用數據類型

| 數據類型 | 說明 | 範例 | 存儲大小 |
|---------|------|------|---------|
| `String` | 文字 | "Princess", "D" | 可變 |
| `Integer` | 整數 (-32,768 到 32,767) | 100, -50 | 2 bytes |
| `Long` | 長整數 | 100000 | 4 bytes |
| `Double` | 小數 | 1.5, 3.14159 | 8 bytes |
| `Boolean` | 真假 | True, False | 2 bytes |
| `Date` | 日期 | #2024/1/15# | 8 bytes |
| `Variant` | 任意類型 (避免使用) | 任何值 | 可變 |
| `Range` | Excel 單元格範圍 | Range("A1") | 對象 |
| `Worksheet` | 工作表 | Worksheets(1) | 對象 |
| `Workbook` | 工作簿 | ThisWorkbook | 對象 |

### 變量聲明範例

```vba
Sub VariableExamples()
    ' 字符串變量
    Dim diamondShape As String
    diamondShape = "Princess"
    
    ' 數值變量
    Dim caratWeight As Double
    caratWeight = 1.52
    
    ' 整數變量
    Dim quantity As Integer
    quantity = 100
    
    ' 日期變量
    Dim purchaseDate As Date
    purchaseDate = DateSerial(2024, 1, 15)
    
    ' 布爾變量
    Dim isAvailable As Boolean
    isAvailable = True
    
    ' Excel 對象變量
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("庫存表")
    
    Dim rng As Range
    Set rng = ws.Range("A1:D10")
    
    ' 顯示變量值
    MsgBox "鑽石形狀: " & diamondShape & vbCrLf & _
           "克拉重量: " & caratWeight & vbCrLf & _
           "數量: " & quantity
End Sub
```

### 變量命名規則

```vba
' ✅ 正確的命名
Dim diamondPrice As Double
Dim caratWeight As Double
Dim isAvailable As Boolean
Dim customerName As String

' ❌ 錯誤的命名
Dim 1stPrice As Double      ' 不能以數字開頭
Dim diamond price As Double ' 不能有空格
Dim Dim As String           ' 不能使用保留字
```

### 常量 (Constant)

不會改變的值使用常量：

```vba
Sub ConstantsExample()
    ' 聲明常量
    Const TAX_RATE As Double = 0.08
    Const COMPANY_NAME As String = "Diamond Corp"
    
    Dim price As Double
    price = 10000
    
    ' 使用常量計算
    Dim totalPrice As Double
    totalPrice = price * (1 + TAX_RATE)
    
    MsgBox COMPANY_NAME & " 總價: " & totalPrice
End Sub
```

---

## 6. 條件語句

### If-Then-Else 語句

```vba
' 基本 If 語句
If 條件 Then
    ' 條件為真時執行
End If

' If-Else 語句
If 條件 Then
    ' 條件為真時執行
Else
    ' 條件為假時執行
End If

' If-ElseIf-Else 語句
If 條件1 Then
    ' 條件1為真
ElseIf 條件2 Then
    ' 條件2為真
ElseIf 條件3 Then
    ' 條件3為真
Else
    ' 以上都不為真
End If

' 單行 If (簡單情況)
If 條件 Then 語句
```

### 條件語句範例

```vba
Sub CheckDiamondQuality()
    Dim color As String
    Dim clarity As String
    Dim grade As String
    
    ' 從單元格獲取值
    color = Range("B2").Value
    clarity = Range("C2").Value
    
    ' 判斷等級
    If color = "D" And clarity = "FL" Then
        grade = "極品"
    ElseIf color <= "F" And (clarity = "VVS1" Or clarity = "VVS2") Then
        grade = "優質"
    ElseIf color <= "H" And clarity <= "VS2" Then
        grade = "良好"
    Else
        grade = "一般"
    End If
    
    ' 輸出結果
    Range("D2").Value = grade
End Sub
```

### 比較運算符

| 運算符 | 含義 | 範例 |
|--------|------|------|
| `=` | 等於 | `A = B` |
| `<>` | 不等於 | `A <> B` |
| `<` | 小於 | `A < B` |
| `>` | 大於 | `A > B` |
| `<=` | 小於等於 | `A <= B` |
| `>=` | 大於等於 | `A >= B` |

### 邏輯運算符

| 運算符 | 含義 | 說明 |
|--------|------|------|
| `And` | 且 | 兩個條件都為真 |
| `Or` | 或 | 至少一個為真 |
| `Not` | 非 | 條件取反 |

```vba
Sub LogicalOperators()
    Dim carat As Double
    Dim price As Double
    
    carat = Range("A2").Value
    price = Range("B2").Value
    
    ' And: 兩個條件都必須滿足
    If carat >= 1 And price < 10000 Then
        MsgBox "大克拉且價格合理！"
    End If
    
    ' Or: 滿足任一條件
    If carat > 2 Or price > 50000 Then
        MsgBox "高價值鑽石！"
    End If
    
    ' Not: 條件取反
    If Not (carat < 0.5) Then
        MsgBox "不小於 0.5 克拉"
    End If
End Sub
```

### Select Case 語句

當有多個條件時，Select Case 更清晰：

```vba
Sub ClassifyDiamondShape()
    Dim shapeCode As String
    Dim shapeName As String
    
    shapeCode = UCase(Range("A2").Value)  ' 轉大寫
    
    Select Case shapeCode
        Case "RBC"
            shapeName = "圓形明亮式"
        Case "PR"
            shapeName = "公主方"
        Case "PS"
            shapeName = "梨形"
        Case "CU"
            shapeName = "枕形"
        Case "OV"
            shapeName = "橢圓形"
        Case "EM"
            shapeName = "祖母綠形"
        Case "RAD"
            shapeName = "雷地恩形"
        Case "HS"
            shapeName = "心形"
        Case "MQ"
            shapeName = "馬眼形"
        Case Else
            shapeName = "未知形狀"
    End Select
    
    Range("B2").Value = shapeName
End Sub
```

---

## 7. 迴圈

### For 迴圈

用於已知循環次數的情況：

```vba
' 基本 For 迴圈
For 計數器 = 起始值 To 結束值
    ' 重複執行的代碼
Next 計數器

' 帶步長的 For 迴圈
For 計數器 = 起始值 To 結束值 Step 步長
    ' 重複執行的代碼
Next 計數器
```

**範例**：

```vba
Sub ForLoopExample()
    Dim i As Integer
    
    ' 基本迴圈：1 到 10
    For i = 1 To 10
        Cells(i, 1).Value = i  ' 在 A1:A10 填入 1-10
    Next i
    
    ' 帶步長的迴圈：偶數
    For i = 2 To 20 Step 2
        Cells(i / 2, 2).Value = i  ' 在 B 列填入偶數
    Next i
    
    ' 倒序迴圈
    For i = 10 To 1 Step -1
        Cells(11 - i, 3).Value = i  ' 在 C 列倒序填入
    Next i
End Sub
```

### For Each 迴圈

用於遍歷集合中的每個項目：

```vba
Sub ForEachExample()
    Dim cell As Range
    Dim ws As Worksheet
    
    ' 遍歷 A1:A10 中的每個單元格
    For Each cell In Range("A1:A10")
        If cell.Value > 100 Then
            cell.Interior.Color = RGB(255, 200, 200)  ' 高亮顯示
        End If
    Next cell
    
    ' 遍歷所有工作表
    For Each ws In ThisWorkbook.Worksheets
        MsgBox "工作表名稱: " & ws.Name
    Next ws
End Sub
```

### Do While / Do Until 迴圈

用於未知循環次數的情況：

```vba
' Do While：條件為真時繼續
Do While 條件
    ' 代碼
Loop

' Do Until：條件為真時停止
Do Until 條件
    ' 代碼
Loop
```

**範例**：

```vba
Sub DoLoopExample()
    Dim rowNum As Integer
    
    ' 處理數據直到遇到空行
    rowNum = 2  ' 從第 2 行開始
    
    Do While Cells(rowNum, 1).Value <> ""
        ' 處理當前行
        Cells(rowNum, 5).Value = Cells(rowNum, 2).Value * Cells(rowNum, 3).Value
        rowNum = rowNum + 1
    Loop
    
    MsgBox "處理了 " & rowNum - 2 & " 行數據"
End Sub
```

### 迴圈控制語句

| 語句 | 用途 |
|------|------|
| `Exit For` | 退出 For 迴圈 |
| `Exit Do` | 退出 Do 迴圈 |
| `Continue` | VBA 無此語句，用 If 跳過 |

```vba
Sub LoopControl()
    Dim i As Integer
    
    For i = 1 To 100
        ' 跳過奇數
        If i Mod 2 = 1 Then GoTo NextIteration
        
        Cells(i, 1).Value = i
        
        ' 到 20 就停止
        If i = 20 Then Exit For
        
NextIteration:
    Next i
End Sub
```

---

## 8. 操作 Excel 對象

### 工作簿 (Workbook)

```vba
Sub WorkbookOperations()
    Dim wb As Workbook
    
    ' 引用當前工作簿
    Set wb = ThisWorkbook
    
    ' 引用已打開的工作簿
    Set wb = Workbooks("DiamondInventory.xlsx")
    
    ' 打開工作簿
    Set wb = Workbooks.Open("C:\\Data\\Diamonds.xlsx")
    
    ' 保存工作簿
    wb.Save
    
    ' 另存為
    wb.SaveAs "C:\\Backup\\Diamonds_Backup.xlsx"
    
    ' 關閉工作簿
    wb.Close SaveChanges:=True
    
    ' 創建新工作簿
    Set wb = Workbooks.Add
End Sub
```

### 工作表 (Worksheet)

```vba
Sub WorksheetOperations()
    Dim ws As Worksheet
    
    ' 引用工作表
    Set ws = ThisWorkbook.Worksheets("庫存表")
    Set ws = ThisWorkbook.Worksheets(1)  ' 按索引
    Set ws = ActiveSheet                  ' 當前活動表
    
    ' 工作表操作
    ws.Name = "新名稱"                    ' 重命名
    ws.Visible = xlSheetHidden            ' 隱藏
    ws.Visible = xlSheetVisible           ' 顯示
    
    ' 添加工作表
    Set ws = ThisWorkbook.Worksheets.Add
    ws.Name = "新報告"
    
    ' 複製工作表
    ws.Copy After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    
    ' 刪除工作表
    Application.DisplayAlerts = False     ' 關閉警告
    ws.Delete
    Application.DisplayAlerts = True      ' 恢復警告
End Sub
```

### 單元格範圍 (Range)

```vba
Sub RangeOperations()
    Dim rng As Range
    
    ' 引用範圍的不同方式
    Set rng = Range("A1")                           ' 單個單元格
    Set rng = Range("A1:D10")                       ' 範圍
    Set rng = Range("A1", "D10")                    ' 另一種方式
    Set rng = Cells(1, 1)                           ' 行列索引 (A1)
    Set rng = Rows(1)                               ' 整行
    Set rng = Columns("A")                          ' 整列
    Set rng = ActiveCell                            ' 當前單元格
    Set rng = Selection                             ' 選中的範圍
    
    ' 讀取和寫入值
    Range("A1").Value = "鑽石編號"
    Dim val As Variant
    val = Range("B2").Value
    
    ' 格式化
    With Range("A1:D1")
        .Font.Bold = True
        .Font.Size = 12
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
        .HorizontalAlignment = xlCenter
    End With
    
    ' 調整列寬
    Range("A:D").AutoFit
    
    ' 複製和粘貼
    Range("A1:D10").Copy
    Range("F1").PasteSpecial xlPasteValues
    
    ' 清除內容
    Range("A1:D10").ClearContents       ' 只清除內容
    Range("A1:D10").Clear               ' 清除內容和格式
End Sub
```

### 使用 With 語句

With 語句可以簡化對同一對象的多個操作：

```vba
Sub UsingWith()
    ' ❌ 不使用 With (重複寫 Range("A1"))
    Range("A1").Value = "標題"
    Range("A1").Font.Bold = True
    Range("A1").Font.Size = 14
    Range("A1").Interior.Color = RGB(200, 200, 200)
    
    ' ✅ 使用 With (更簡潔)
    With Range("A1")
        .Value = "標題"
        .Font.Bold = True
        .Font.Size = 14
        .Interior.Color = RGB(200, 200, 200)
    End With
    
    ' 嵌套 With
    With Range("A1")
        .Value = "鑽石庫存"
        With .Font
            .Bold = True
            .Size = 16
            .Color = RGB(255, 255, 255)
        End With
        .Interior.Color = RGB(68, 114, 196)
    End With
End Sub
```

### 偏移和調整範圍

```vba
Sub RangeNavigation()
    Dim rng As Range
    Set rng = Range("B2")
    
    ' Offset：相對偏移
    rng.Offset(1, 0).Value = "下一行"      ' 向下 1 行
    rng.Offset(0, 1).Value = "右一列"      ' 向右 1 列
    rng.Offset(-1, 0).Value = "上一行"     ' 向上 1 行
    rng.Offset(2, 3).Value = "下2右3"      ' 向下 2，向右 3
    
    ' Resize：調整範圍大小
    Range("A1").Resize(5, 3).Select       ' 5行3列的範圍
    
    ' End：跳到數據邊緣
    Dim lastRow As Long
    lastRow = Range("A" & Rows.Count).End(xlUp).Row  ' A 列最後一行
    
    ' CurrentRegion：選擇連續數據區域
    Range("A1").CurrentRegion.Select
End Sub
```

---

## 9. 鑽石數據自動化實例

### 實例 1：自動格式化鑽石庫存表

```vba
Sub FormatDiamondInventory()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim headerRange As Range
    Dim dataRange As Range
    
    ' 設置工作表
    Set ws = ThisWorkbook.Worksheets("庫存表")
    
    ' 找到最後一行
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    ' 格式化標題行
    Set headerRange = ws.Range("A1:H1")
    With headerRange
        .Font.Bold = True
        .Font.Size = 11
        .Font.Color = RGB(255, 255, 255)
        .Interior.Color = RGB(68, 114, 196)
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With
    
    ' 格式化數據區域
    Set dataRange = ws.Range("A2:H" & lastRow)
    With dataRange
        .Font.Size = 10
        .HorizontalAlignment = xlLeft
        .VerticalAlignment = xlCenter
    End With
    
    ' 添加邊框
    With dataRange.Borders
        .LineStyle = xlContinuous
        .Weight = xlThin
        .ColorIndex = xlAutomatic
    End With
    
    ' 自動調整列寬
    ws.Columns("A:H").AutoFit
    
    ' 凍結首行
    ws.Activate
    ActiveWindow.FreezePanes = False
    ws.Range("A2").Select
    ActiveWindow.FreezePanes = True
    
    MsgBox "格式化完成！", vbInformation
End Sub
```

### 實例 2：批量生成報告

```vba
Sub GenerateDiamondReport()
    Dim wsSource As Worksheet
    Dim wsReport As Worksheet
    Dim lastRow As Long
    Dim i As Long
    Dim reportRow As Long
    Dim shapeFilter As String
    
    ' 設置篩選條件
    shapeFilter = InputBox("請輸入要篩選的鑽石形狀 (如: PR, RBC, PS):", "篩選條件", "PR")
    If shapeFilter = "" Then Exit Sub
    
    ' 設置源工作表
    Set wsSource = ThisWorkbook.Worksheets("庫存表")
    lastRow = wsSource.Cells(wsSource.Rows.Count, 1).End(xlUp).Row
    
    ' 創建或清空報告工作表
    On Error Resume Next
    Set wsReport = ThisWorkbook.Worksheets("報告")
    On Error GoTo 0
    
    If wsReport Is Nothing Then
        Set wsReport = ThisWorkbook.Worksheets.Add
        wsReport.Name = "報告"
    Else
        wsReport.Cells.Clear
    End If
    
    ' 寫入報告標題
    wsReport.Range("A1").Value = "鑽石形狀: " & shapeFilter & " 篩選報告"
    wsReport.Range("A1").Font.Bold = True
    wsReport.Range("A1").Font.Size = 14
    
    ' 複製標題行
    wsSource.Range("A1:H1").Copy Destination:=wsReport.Range("A3")
    
    ' 篩選並複製數據
    reportRow = 4
    For i = 2 To lastRow
        If UCase(wsSource.Cells(i, 2).Value) = UCase(shapeFilter) Then
            wsSource.Range("A" & i & ":H" & i).Copy Destination:=wsReport.Range("A" & reportRow)
            reportRow = reportRow + 1
        End If
    Next i
    
    ' 格式化報告
    wsReport.Columns("A:H").AutoFit
    
    ' 添加統計信息
    wsReport.Range("A" & reportRow + 1).Value = "總數: " & reportRow - 4 & " 顆"
    wsReport.Range("A" & reportRow + 1).Font.Bold = True
    
    ' 激活報告工作表
    wsReport.Activate
    
    MsgBox "報告生成完成！共找到 " & reportRow - 4 & " 條記錄。", vbInformation
End Sub
```

### 實例 3：自動篩選和分類數據

```vba
Sub CategorizeDiamonds()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim i As Long
    Dim carat As Double
    Dim price As Double
    Dim category As String
    
    Set ws = ThisWorkbook.Worksheets("庫存表")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    ' 添加分類列標題
    ws.Range("I1").Value = "分類"
    ws.Range("I1").Font.Bold = True
    
    ' 遍歷數據行
    For i = 2 To lastRow
        carat = ws.Cells(i, 3).Value  ' 假設克拉在 C 列
        price = ws.Cells(i, 7).Value  ' 假設價格在 G 列
        
        ' 根據克拉和價格分類
        If carat >= 2 And price >= 50000 Then
            category = "奢華"
            ws.Cells(i, 9).Interior.Color = RGB(255, 215, 0)  ' 金色
        ElseIf carat >= 1 And price >= 20000 Then
            category = "高端"
            ws.Cells(i, 9).Interior.Color = RGB(192, 192, 192)  ' 銀色
        ElseIf carat >= 0.5 And price >= 5000 Then
            category = "中端"
            ws.Cells(i, 9).Interior.Color = RGB(205, 127, 50)  ' 銅色
        Else
            category = "入門"
            ws.Cells(i, 9).Interior.Color = RGB(200, 200, 200)
        End If
        
        ws.Cells(i, 9).Value = category
    Next i
    
    MsgBox "分類完成！", vbInformation
End Sub
```

### 實例 4：自定義函數計算鑽石價格

```vba
' 計算鑽石零售價格
Function CalculateRetailPrice(carat As Double, pricePerCarat As Double, _
                              color As String, clarity As String) As Double
    Dim basePrice As Double
    Dim colorMultiplier As Double
    Dim clarityMultiplier As Double
    
    ' 基礎價格
    basePrice = carat * pricePerCarat
    
    ' 顏色係數
    Select Case UCase(color)
        Case "D"
            colorMultiplier = 1.5
        Case "E"
            colorMultiplier = 1.4
        Case "F"
            colorMultiplier = 1.3
        Case "G"
            colorMultiplier = 1.2
        Case "H"
            colorMultiplier = 1.1
        Case Else
            colorMultiplier = 1
    End Select
    
    ' 淨度係數
    Select Case UCase(clarity)
        Case "FL", "IF"
            clarityMultiplier = 1.5
        Case "VVS1", "VVS2"
            clarityMultiplier = 1.3
        Case "VS1", "VS2"
            clarityMultiplier = 1.2
        Case "SI1", "SI2"
            clarityMultiplier = 1.1
        Case Else
            clarityMultiplier = 1
    End Select
    
    ' 計算最終價格
    CalculateRetailPrice = basePrice * colorMultiplier * clarityMultiplier
End Function

' 計算批發折扣價格
Function CalculateWholesalePrice(retailPrice As Double, quantity As Integer) As Double
    Dim discount As Double
    
    ' 根據數量給予折扣
    Select Case quantity
        Case Is >= 100
            discount = 0.3      ' 30% 折扣
        Case Is >= 50
            discount = 0.25     ' 25% 折扣
        Case Is >= 20
            discount = 0.2      ' 20% 折扣
        Case Is >= 10
            discount = 0.15     ' 15% 折扣
        Case Else
            discount = 0.1      ' 10% 折扣
    End Select
    
    CalculateWholesalePrice = retailPrice * (1 - discount) * quantity
End Function

' 獲取形狀中文名稱
Function GetShapeName(shapeCode As String) As String
    Select Case UCase(shapeCode)
        Case "RBC"
            GetShapeName = "圓形明亮式"
        Case "PR"
            GetShapeName = "公主方"
        Case "PS"
            GetShapeName = "梨形"
        Case "CU"
            GetShapeName = "枕形"
        Case "OV"
            GetShapeName = "橢圓形"
        Case "EM"
            GetShapeName = "祖母綠形"
        Case "RAD"
            GetShapeName = "雷地恩形"
        Case "HS"
            GetShapeName = "心形"
        Case "MQ"
            GetShapeName = "馬眼形"
        Case "SEM"
            GetShapeName = "方形祖母綠"
        Case Else
            GetShapeName = "未知"
    End Select
End Function
```

---

## 10. 完整項目代碼

### 鑽石庫存管理系統

```vba
' ============================================================
' 鑽石庫存管理系統 - 完整 VBA 代碼
' ============================================================

Option Explicit  ' 強制聲明所有變量

' ============================================================
' 常量定義
' ============================================================
Public Const HEADER_ROW As Integer = 1
Public Const DATA_START_ROW As Integer = 2

' ============================================================
' 主程序：一鍵處理所有任務
' ============================================================
Sub ProcessDiamondInventory()
    Application.ScreenUpdating = False  ' 關閉屏幕更新，加快速度
    Application.Calculation = xlCalculationManual
    
    Call FormatDiamondInventory
    Call CategorizeDiamonds
    Call CalculateAllPrices
    Call GenerateSummaryReport
    
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
    
    MsgBox "所有處理完成！", vbInformation, "完成"
End Sub

' ============================================================
' 格式化庫存表
' ============================================================
Sub FormatDiamondInventory()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim headerRange As Range
    Dim dataRange As Range
    
    Set ws = ThisWorkbook.Worksheets("庫存表")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    ' 格式化標題
    Set headerRange = ws.Range("A1:J1")
    With headerRange
        .Font.Bold = True
        .Font.Size = 11
        .Font.Color = RGB(255, 255, 255)
        .Interior.Color = RGB(68, 114, 196)
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With
    
    ' 格式化數據
    Set dataRange = ws.Range("A2:J" & lastRow)
    With dataRange
        .Font.Size = 10
        .HorizontalAlignment = xlLeft
        .VerticalAlignment = xlCenter
    End With
    
    ' 添加邊框
    With dataRange.Borders
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With
    
    ' 自動調整列寬
    ws.Columns("A:J").AutoFit
    
    ' 數字格式
    ws.Columns("C").NumberFormat = "0.00"      ' 克拉，2位小數
    ws.Columns("G:I").NumberFormat = "$#,##0"  ' 價格，貨幣格式
    
    ' 凍結首行
    ws.Activate
    ActiveWindow.FreezePanes = False
    ws.Range("A2").Select
    ActiveWindow.FreezePanes = True
End Sub

' ============================================================
' 分類鑽石
' ============================================================
Sub CategorizeDiamonds()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim i As Long
    Dim carat As Double
    Dim price As Double
    Dim category As String
    
    Set ws = ThisWorkbook.Worksheets("庫存表")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    ' 確保分類列存在
    ws.Range("J1").Value = "分類"
    ws.Range("J1").Font.Bold = True
    
    For i = DATA_START_ROW To lastRow
        carat = ws.Cells(i, 3).Value
        price = ws.Cells(i, 7).Value
        
        ' 分類邏輯
        If carat >= 2 And price >= 50000 Then
            category = "奢華"
            ws.Cells(i, 10).Interior.Color = RGB(255, 215, 0)
        ElseIf carat >= 1 And price >= 20000 Then
            category = "高端"
            ws.Cells(i, 10).Interior.Color = RGB(192, 192, 192)
        ElseIf carat >= 0.5 And price >= 5000 Then
            category = "中端"
            ws.Cells(i, 10).Interior.Color = RGB(205, 127, 50)
        Else
            category = "入門"
            ws.Cells(i, 10).Interior.Color = RGB(230, 230, 230)
        End If
        
        ws.Cells(i, 10).Value = category
        ws.Cells(i, 10).HorizontalAlignment = xlCenter
    Next i
End Sub

' ============================================================
' 計算所有價格
' ============================================================
Sub CalculateAllPrices()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim i As Long
    Dim carat As Double
    Dim basePrice As Double
    Dim color As String
    Dim clarity As String
    
    Set ws = ThisWorkbook.Worksheets("庫存表")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    ' 確保價格列存在
    ws.Range("H1").Value = "零售價"
    ws.Range("I1").Value = "批發價"
    
    For i = DATA_START_ROW To lastRow
        carat = ws.Cells(i, 3).Value
        basePrice = ws.Cells(i, 6).Value
        color = ws.Cells(i, 4).Value
        clarity = ws.Cells(i, 5).Value
        
        ' 計算零售價
        ws.Cells(i, 8).Value = CalculateRetailPrice(carat, basePrice, color, clarity)
        
        ' 計算批發價 (假設數量為 10)
        ws.Cells(i, 9).Value = CalculateWholesalePrice(ws.Cells(i, 8).Value, 10)
    Next i
End Sub

' ============================================================
' 生成摘要報告
' ============================================================
Sub GenerateSummaryReport()
    Dim wsSource As Worksheet
    Dim wsReport As Worksheet
    Dim lastRow As Long
    Dim luxuryCount As Long
    Dim premiumCount As Long
    Dim midCount As Long
    Dim entryCount As Long
    Dim totalValue As Double
    Dim i As Long
    
    Set wsSource = ThisWorkbook.Worksheets("庫存表")
    lastRow = wsSource.Cells(wsSource.Rows.Count, 1).End(xlUp).Row
    
    ' 統計數據
    For i = DATA_START_ROW To lastRow
        Select Case wsSource.Cells(i, 10).Value
            Case "奢華"
                luxuryCount = luxuryCount + 1
            Case "高端"
                premiumCount = premiumCount + 1
            Case "中端"
                midCount = midCount + 1
            Case "入門"
                entryCount = entryCount + 1
        End Select
        totalValue = totalValue + wsSource.Cells(i, 8).Value
    Next i
    
    ' 創建報告工作表
    On Error Resume Next
    Application.DisplayAlerts = False
    ThisWorkbook.Worksheets("摘要報告").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0
    
    Set wsReport = ThisWorkbook.Worksheets.Add
    wsReport.Name = "摘要報告"
    
    ' 報告標題
    With wsReport.Range("A1")
        .Value = "鑽石庫存摘要報告"
        .Font.Size = 16
        .Font.Bold = True
    End With
    
    ' 報告日期
    wsReport.Range("A2").Value = "生成日期: " & Format(Now, "yyyy-mm-dd hh:mm")
    
    ' 統計表格
    wsReport.Range("A4").Value = "分類"
    wsReport.Range("B4").Value = "數量"
    wsReport.Range("C4").Value = "佔比"
    
    wsReport.Range("A4:C4").Font.Bold = True
    wsReport.Range("A4:C4").Interior.Color = RGB(200, 200, 200)
    
    ' 數據
    wsReport.Range("A5").Value = "奢華"
    wsReport.Range("B5").Value = luxuryCount
    wsReport.Range("C5").Value = Format(luxuryCount / (lastRow - 1), "0.0%")
    
    wsReport.Range("A6").Value = "高端"
    wsReport.Range("B6").Value = premiumCount
    wsReport.Range("C6").Value = Format(premiumCount / (lastRow - 1), "0.0%")
    
    wsReport.Range("A7").Value = "中端"
    wsReport.Range("B7").Value = midCount
    wsReport.Range("C7").Value = Format(midCount / (lastRow - 1), "0.0%")
    
    wsReport.Range("A8").Value = "入門"
    wsReport.Range("B8").Value = entryCount
    wsReport.Range("C8").Value = Format(entryCount / (lastRow - 1), "0.0%")
    
    wsReport.Range("A9").Value = "總計"
    wsReport.Range("B9").Value = lastRow - 1
    wsReport.Range("A9:B9").Font.Bold = True
    
    ' 總價值
    wsReport.Range("A11").Value = "總零售價值:"
    wsReport.Range("B11").Value = totalValue
    wsReport.Range("B11").NumberFormat = "$#,##0"
    wsReport.Range("A11:B11").Font.Bold = True
    
    ' 格式化
    wsReport.Columns("A:C").AutoFit
End Sub

' ============================================================
' 導出數據到 CSV
' ============================================================
Sub ExportToCSV()
    Dim ws As Worksheet
    Dim savePath As String
    
    Set ws = ThisWorkbook.Worksheets("庫存表")
    
    ' 選擇保存位置
    savePath = Application.GetSaveAsFilename( _
        InitialFileName:="DiamondInventory_" & Format(Now, "yyyymmdd") & ".csv", _
        FileFilter:="CSV Files (*.csv), *.csv")
    
    If savePath = "False" Then Exit Sub
    
    ' 複製到新工作簿並保存為 CSV
    ws.Copy
    ActiveWorkbook.SaveAs Filename:=savePath, FileFormat:=xlCSV
    ActiveWorkbook.Close SaveChanges:=False
    
    MsgBox "導出成功！", vbInformation
End Sub

' ============================================================
' 自定義函數
' ============================================================
Function CalculateRetailPrice(carat As Double, pricePerCarat As Double, _
                              color As String, clarity As String) As Double
    Dim basePrice As Double
    Dim colorMultiplier As Double
    Dim clarityMultiplier As Double
    
    basePrice = carat * pricePerCarat
    
    Select Case UCase(color)
        Case "D": colorMultiplier = 1.5
        Case "E": colorMultiplier = 1.4
        Case "F": colorMultiplier = 1.3
        Case "G": colorMultiplier = 1.2
        Case "H": colorMultiplier = 1.1
        Case Else: colorMultiplier = 1
    End Select
    
    Select Case UCase(clarity)
        Case "FL", "IF": clarityMultiplier = 1.5
        Case "VVS1", "VVS2": clarityMultiplier = 1.3
        Case "VS1", "VS2": clarityMultiplier = 1.2
        Case "SI1", "SI2": clarityMultiplier = 1.1
        Case Else: clarityMultiplier = 1
    End Select
    
    CalculateRetailPrice = basePrice * colorMultiplier * clarityMultiplier
End Function

Function CalculateWholesalePrice(retailPrice As Double, quantity As Integer) As Double
    Dim discount As Double
    
    Select Case quantity
        Case Is >= 100: discount = 0.3
        Case Is >= 50: discount = 0.25
        Case Is >= 20: discount = 0.2
        Case Is >= 10: discount = 0.15
        Case Else: discount = 0.1
    End Select
    
    CalculateWholesalePrice = retailPrice * (1 - discount)
End Function

Function GetShapeName(shapeCode As String) As String
    Select Case UCase(shapeCode)
        Case "RBC": GetShapeName = "圓形明亮式"
        Case "PR": GetShapeName = "公主方"
        Case "PS": GetShapeName = "梨形"
        Case "CU": GetShapeName = "枕形"
        Case "OV": GetShapeName = "橢圓形"
        Case "EM": GetShapeName = "祖母綠形"
        Case "RAD": GetShapeName = "雷地恩形"
        Case "HS": GetShapeName = "心形"
        Case "MQ": GetShapeName = "馬眼形"
        Case "SEM": GetShapeName = "方形祖母綠"
        Case Else: GetShapeName = "未知"
    End Select
End Function
```

---

## 📝 學習總結

### VBA 核心概念

| 概念 | 說明 |
|------|------|
| **Sub** | 執行操作，不返回值 |
| **Function** | 計算並返回值，可在公式中使用 |
| **變量** | 存儲數據的容器，需聲明類型 |
| **If-Then-Else** | 條件判斷 |
| **For/For Each** | 迴圈遍歷 |
| **Range** | 操作單元格 |
| **Worksheet** | 操作工作表 |

### 最佳實踐

1. **使用 Option Explicit** - 強制聲明變量，減少錯誤
2. **關閉 ScreenUpdating** - 提高宏運行速度
3. **使用 With 語句** - 代碼更簡潔
4. **添加註釋** - 方便維護
5. **錯誤處理** - 使用 On Error 語句

### 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| Alt + F11 | 打開 VBA 編輯器 |
| F5 | 運行宏 |
| F8 | 逐句執行 (調試) |
| F9 | 設置斷點 |
| Ctrl + R | 專案總管 |
| Ctrl + G | 即時運算窗口 |

---

**恭喜！** 你已經完成了 Excel VBA 基礎的學習。現在你可以：
- ✅ 錄製和修改宏
- ✅ 編寫自定義函數
- ✅ 自動化重複任務
- ✅ 處理鑽石庫存數據
- ✅ 生成自動化報告

**Excel 高級技巧模組已完成！** 🎉

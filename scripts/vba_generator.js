#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Excel VBA Macro Generator
 * Generates VBA code for diamond stock automation
 */

class VBAGenerator {
  generateStockFormatter() {
    return `
Sub FormatStockList()
    ' Format diamond stock list according to standards

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ' Auto-fit columns
    ws.Columns.AutoFit

    ' Center align all data
    With ws.Range("A:Z")
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

    ' Bold header row
    ws.Rows(1).Font.Bold = True
    ws.Rows(1).Font.Size = 12

    ' Format carat column to 2 decimals
    ws.Columns("C").NumberFormat = "0.00"

    ' Format price column with comma
    ws.Columns("O").NumberFormat = "#,##0.00"

    ' Add borders
    With ws.Range("A1").CurrentRegion
        .Borders.LineStyle = xlContinuous
        .Borders.Weight = xlThin
    End With

    MsgBox "Stock list formatted successfully!"
End Sub

Sub SortByStandard()
    ' Sort stock: Shape > Carat (desc) > Color

    Dim ws As Worksheet
    Set ws = ActiveSheet

    With ws.Sort
        .SortFields.Clear
        .SortFields.Add Key:=ws.Range("B:B"), Order:=xlAscending ' Shape
        .SortFields.Add Key:=ws.Range("C:C"), Order:=xlDescending ' Carat
        .SortFields.Add Key:=ws.Range("D:D"), Order:=xlAscending ' Color
        .SetRange ws.Range("A1").CurrentRegion
        .Header = xlYes
        .Apply
    End With
End Sub

Sub AddSubtotals()
    ' Add subtotals by shape

    Dim ws As Worksheet
    Set ws = ActiveSheet

    ' Group by shape and add totals
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row

    ' Insert blank rows between shapes
    Dim i As Long
    For i = lastRow To 2 Step -1
        If ws.Cells(i, "B").Value <> ws.Cells(i - 1, "B").Value Then
            ws.Rows(i).Insert
            ws.Cells(i, "A").Value = "Subtotal:"
            ws.Cells(i, "C").Formula = "=SUM(C" & ws.Cells(i - 1, "B").End(xlUp).Row & ":C" & i - 1 & ")"
        End If
    Next i
End Sub
    `.trim();
  }

  generateRapaportLookup() {
    return `
Function GetRapaportPrice(shape As String, carat As Double, color As String, clarity As String) As Double
    ' Lookup Rapaport price from database

    Dim rapaSheet As Worksheet
    Set rapaSheet = ThisWorkbook.Sheets("Rapaport")

    ' Determine table (Round vs Pear)
    Dim tableRange As Range
    If shape = "RBC" Then
        Set tableRange = rapaSheet.Range("RoundTable")
    Else
        Set tableRange = rapaSheet.Range("PearTable")
    End If

    ' Find carat range
    Dim caratRow As Long
    caratRow = Application.Match(carat, tableRange.Columns(1), 1)

    ' Find color column
    Dim colorCol As Long
    colorCol = Application.Match(color, tableRange.Rows(1), 0)

    ' Find clarity row
    Dim clarityRow As Long
    clarityRow = Application.Match(clarity, tableRange.Columns(2), 0)

    ' Return price (per $100)
    GetRapaportPrice = tableRange.Cells(clarityRow, colorCol).Value
End Function

Function CalculateDiamondPrice(shape As String, carat As Double, color As String, clarity As String, discount As Double) As Double
    ' Calculate final price with discount

    Dim basePrice As Double
    basePrice = GetRapaportPrice(shape, carat, color, clarity)

    ' Apply discount
    CalculateDiamondPrice = (basePrice * 100 * carat) * (1 + discount / 100)
End Function
    `.trim();
  }

  saveToFile(vbaCode, filename) {
    const fs = require('fs');
    const path = require('path');
    const { WS } = require('./lib/config');
    const outputPath = path.join(WS, 'vba', filename);
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
    try {
      const tmpPath = outputPath + '.tmp';
      fs.writeFileSync(tmpPath, vbaCode, 'utf8');
      fs.renameSync(tmpPath, outputPath);
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
    log(`VBA saved: ${outputPath}`);
    return outputPath;
  }
}

module.exports = VBAGenerator;

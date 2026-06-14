#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Power Query M Code Generator
 * For data transformation and consolidation
 */

class PowerQueryGenerator {
  generateStockConsolidation() {
    return `
let
    // Get all Excel files from folder
    Source = Folder.Files("C:\\Stock Data"),

    // Filter for Excel files
    ExcelFiles = Table.SelectRows(Source, each Text.EndsWith([Name], ".xlsx")),

    // Add custom column to extract data from each file
    AddDataColumn = Table.AddColumn(ExcelFiles, "Data", each
        Excel.Workbook(File.Contents([Folder Path] & [Name]), true){0}[Data]
    ),

    // Expand the data column
    ExpandData = Table.ExpandTableColumn(AddDataColumn, "Data",
        Table.ColumnNames(AddDataColumn{0}[Data])
    ),

    // Filter valid rows (has GIA number)
    FilterValid = Table.SelectRows(ExpandData, each [Cert No] <> null and [Cert No] <> ""),

    // Remove duplicates by Cert No
    RemoveDuplicates = Table.Distinct(FilterValid, {"Cert No"}),

    // Sort by standard rules
    SortData = Table.Sort(RemoveDuplicates, {
        {"Shape", Order.Ascending},
        {"Crt", Order.Descending},
        {"Color", Order.Ascending}
    }),

    // Add calculated columns
    AddCalculated = Table.AddColumn(SortData, "Price per Crt", each
        if [Crt] > 0 then [Memo In Price] / [Crt] else 0
    ),

    // Select final columns
    SelectColumns = Table.SelectColumns(AddCalculated, {
        "Parcel Name", "Shape", "Crt", "Color", "Clarity",
        "Cut", "Pol", "Symm", "Measurement", "Fluor",
        "Lab", "Cert No", "Memo In Price", "Price per Crt"
    })
in
    SelectColumns
    `.trim();
  }

  generateRapaportImport() {
    return `
let
    // Import Rapaport PDF data (via CSV export)
    Source = Csv.Document(File.Contents("C:\\Rapaport\\rapaport.csv"), [Delimiter=","]),

    // Promote headers
    PromoteHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),

    // Unpivot columns for color/clarity lookup
    Unpivot = Table.UnpivotOtherColumns(PromoteHeaders, {"Carat Range", "Clarity"}}, "Color", "Price"),

    // Clean price data
    CleanPrice = Table.TransformColumns(Unpivot, {{"Price", each try Number.FromText(_) otherwise 0}}),

    // Create lookup key
    AddKey = Table.AddColumn(CleanPrice, "LookupKey", each [Carat Range] & "_" & [Clarity] & "_" & [Color])
in
    AddKey
    `.trim();
  }

  saveToFile(mCode, filename) {
    const fs = require('fs');
    const path = require('path');
const { WS } = require('./lib/config');
    const outputPath = path.join(WS, 'powerquery', filename);
    try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    } catch (err) {
        log(`❌ 創建目錄失敗: ${err.message}`);
        return null;
    }
    try {
        fs.writeFileSync(outputPath, mCode);
    } catch (err) {
        log(`❌ 保存 Power Query 失敗: ${err.message}`);
        return null;
    }
    log(`Power Query saved: ${outputPath}`);
    return outputPath;
  }
}

module.exports = PowerQueryGenerator;

# 精簡參考 (Quick Reference)

## Rapaport 價格計算
1. **形狀**: Round → RBC 表 | 其他 → Pear 表
2. **重量範圍**: 1.00-1.49 | 1.50-1.99 | 2.00-2.99 | 3.00-3.99 | 4.00-4.99 | 5.00+
3. **計算**: 
   - List Price/ct = 表格值 × 100
   - Total = (List Price/ct × Carat) × (1 - Discount%)
4. **FL 淨度**: 使用 IF 價格

## V9 Stock List 格式
**列順序**: Parcel Name → Shape → Crt → Color → Clarity → Cut → Pol → Symm → Measur → Depth → Table → Fluor → Lab → Cert No → Memo Price

**排序**: Shape (RBC 先) → Carat (大→小) → Color (D→Z)

**格式**: 全部置中 | Crt 2 位小數 | Memo Price 逗號+2 位小數 | 標題粗體 | 形狀間隔空白行

## 鑽石資料格式
```
<Shape> <Carat> <Color> <Clarity> <Cut/Pol/Sym> <Fluorescence>
GIA No: <Cert No>
Link: https://www.gia.edu/report-check?reportno=<Cert No>
```

## 常用形狀代碼
- RBC = Round Brilliant Cut
- EM = Emerald
- PS = Pear
- CU = Cushion
- RAD = Radiant
- RD → RAD (自動轉換)

## 重要聯絡
- Josh: +852XXXXXX, +852XXXXXX
- Desanna: +852XXXXXX

## 工具位置
- V9 Stock Integrator: `scripts/v9_stock_integrator.js`
- Rapaport 更新: `scripts/update_rapaport_universal.js`

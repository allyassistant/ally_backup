## Rapaport 價格計算 (2026-02-07 更新)
1. **形狀**: Round=RBC 表,其他=Pear 表
2. **重量**: 1.00-1.49 | 1.50-1.99 | 2.00-2.99 | 3.00-3.99 | 4.00-4.99 | 5.00+
3. **重要規則 (2026-02-03 更新)**: **凡係大過 5 卡嘅鑽石都用 5.00-5.99 個表去計，包括 10 卡！**
4. **計算**: (表格值×100 × Carat) × (1-Discount%)
5. **FL**: 使用 IF 價格（同價，唔使加）
6. **輸出格式**:
   ```
   <Shape> <Carat> <Color> <Clarity>
   Discount: <Discount>%
   Total: USD <Amount>
   ```

### Rapaport 估值參考 (NEW - 2026-02-07)
當用戶查詢鑽石或計算價錢時，額外提供相對於 Rapaport 的折扣/溢價估值：

**估值等級:**
| 等級 | Rapaport 折扣 | 說明 |
|------|---------------|------|
| 🔴 偏低 | -35% ~ -45% | 急於套現 / 市場弱勢 |
| 🟡 合理 | -20% ~ -35% | 正常市場價格 |
| 🟢 偏高 | -10% ~ -20% | 優質貨 / 市場強勢 |
| 💎 極高 | 0% ~ +10% | 頂級貨 / 稀有規格 |

**輸出格式:**
```
*<Parcel Name>*
• Shape: <Shape>
• Carat: <Carat>
• Color: <Color>
• Clarity: <Clarity>
• Cut/Pol/Sym: <Cut/Pol/Sym>
• Fluor: <Fluorescence>
• GIA: <Cert No.>

💰 價格參考:
• Rapaport 基準: USD <base_price>
• 保守估值 (-35%): USD <price_low>
• 市場估值 (-25%): USD <price_mid>
• 樂觀估值 (-15%): USD <price_high>

💡 **備註**: 估值純粹基於 Rapaport 基準，唔參考 Stock list memo 價
```

---

## V9 Stock List 要求

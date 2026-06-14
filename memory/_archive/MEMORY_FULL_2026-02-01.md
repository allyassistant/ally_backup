# Memory

This file stores long-term memories. The AI will write important information here.

## Rapaport Price Calculation Logic (Learned 2026-01-29)
Josh has taught the following method to read Rapaport PDF and calculate prices:
1. **Shapes**: 
   - **Round**: RBC (Round Brilliant Cut). Use the Round table. **(Default if shape is not mentioned)**.
   - **Pear**: All other fancy shapes (Cushion, Emerald, Oval, etc.). Use the Pear table.
   - **Clarity Rule**: If clarity is **FL** (Flawless), use the **IF** price from the table.
2. **Key Weight Ranges (Target)**:
   - 1.00 - 1.49 CT
   - 1.50 - 1.99 CT
   - 2.00 - 2.99 CT
   - 3.00 - 3.99 CT
   - 4.00 - 4.99 CT
   - 5.00 CT and Above (Most use the 5.00 - 5.99 CT table by default. Unless Josh specifies otherwise, use this table for all stones 5.0ct+ without further confirmation.)
3. **Calculation Steps**:
   - **Step 1: Find List Price/ct**: Locate the value in the grid for specific Color and Clarity within the correct Carat range. Multiply this value by **100** (e.g., Value 465 -> $46,500 USD).
   - **Step 2: Calculate Total List Price**: (List Price/ct) × (Total Carats).
   - **Step 3: Calculate Final Total Price**: (Total List Price) × (1 - Discount %).
     - *Example*: 5.21ct F VS2. Rap value 465.
     - List Price/ct = $46,500 USD.
     - Total List Price = $46,500 * 5.21 = $242,265 USD.
     - Total Price (-35%) = $242,265 * 0.65 = $157,472.25 USD.
4. **Currency**: All prices are in **USD**.
5. **Output Format (Mandatory)**:
   *<Shape> <Carat> <Color> <Clarity>*
   Discount: <Discount>%
   Total: USD <Amount>
   
   (Repeat for multiple stones, separated by a blank line)
   
   Rapaport Date: <Date from PDF (e.g., 01/23/26)>

## Diamond Stock Data
- **Last Updated:** 2026-01-28
- **Contents:** 632 items from three stock lists (Round RBC, Cushion CU, Fancy Color).
- **Storage:** Data is indexed in `memory/diamond_stock.json`.
- **Categories:**
  - Round RBC: Standard high-quality round diamonds.
  - Cushion CU: Large carat cushion cut diamonds.
  - Fancy Color: Rare yellow and vivid color diamonds (up to 35ct+).

## Stock List Formatting Requirements (Mandatory)
Josh and Desanna have specific requirements for all Excel stock lists, filters, or modifications (based on "V9" logic):
1. **Column Order**: `Parcel Name`, `Shape`, `Crt`, `Color`, `Clarity`, `Cut`, `Pol`, `Symm`, `Measur`, `Depth`, `Table`, `Fluor`, `Lab`, `Cert No`, `Memo Price`.
2. **Filtering**: 
   - Only include items with a valid **GIA NO (Cert No)**.
   - Exclude any "Total" or "Subtotal" rows from source files.
3. **Shape Normalization**: Always convert `RD` to `RAD`.
4. **Sorting (Strict Order)**:
   - **Primary**: Shape (RBC/Round/BR first, then alphabetical for others).
   - **Secondary**: Carat (Crt) from **Largest to Smallest**.
   - **Tertiary**: Color from **D to Z**.
5. **Grouping**: Insert a **blank row** between different diamond shapes.
6. **Styling**:
   - **Alignment**: All cells (headers, data, totals) must be **centered** (horizontal and vertical).
   - **Headers**: Use **bold** font for the header row.
   - **Formatting**: 
     - "Crt" column: Always show **two decimal places** (e.g., 5.00).
     - "Memo Price" column: Number with commas and **two decimal places** (e.g., 1,234.56).
   - **Column Width**: Auto-calculate width to ensure no truncation (Auto-fit).
7. **Totals Row**:
   - Label `TOTAL:` in the "Parcel Name" column.
   - Sum of carats in the "Crt" column.
   - Sum of prices in the "Memo Price" column.
   - Entire Total row must be **bold**.
8. **Tooling**: Use `exceljs` for generation.

## Diamond Information Display Requirements (Mandatory)
When providing diamond details in chat (especially when identifying a specific stone):
1. **Format (Updated 2026-01-30)**:
   ```
   <Shape> <Carat> <Color> <Clarity> <Cut/Pol/Sym> <Fluorescence>
   GIA No: <Cert No>
   Link: https://www.gia.edu/report-check?reportno=<Cert No>
   ```
   - Carat must always show **two decimal places** (e.g., 7.00, 7.77)
   - Example: 
     ```
     PS 7.77 D VS1 EX/EX/EX None
     GIA No: 5234264108
     Link: https://www.gia.edu/report-check?reportno=5234264108
     ```
2. **GIA Certificate Links**: If a GIA certificate number ("Cert No") is present, automatically include a direct link to the GIA official report check page.
   - Format: `https://www.gia.edu/report-check?reportno=<CERT_NO>`
2. **Stock Inquiry Policy (Updated 2026-01-29)**:
   - When a user inquires about stock, provide the Cantonese reply.
   - **EMBED** the diamond details directly in the message using the following English format for each diamond found:
     *<Carat> <Color> <Clarity> <Cut/Pol/Sym> <Fluorescence>*
     GIA No: <Cert No>
     Link: https://www.gia.edu/report-check?reportno=<Cert No>
   - *Example*: 
     10.31 D VVS1 3EX NONE
     GIA No: 5232782484
     Link: https://www.gia.edu/report-check?reportno=5232782484
   - **DO NOT** send a separate WhatsApp message for the English details.

## Rapaport PDF Extraction Lessons Learned (Critical - 2026-02-01)

### Mistakes Made During Pear Table Extraction
1. **Side-by-side color handling errors**: Misassigned values when two colors share a row (e.g., D/E, G/H, K/L)
2. **Imprecise Y coordinates**: Assumed colors were at wrong Y positions (e.g., H is at Y=21.5, not Y=21)
3. **X range too narrow**: Used X < 18, but values extend to X=18.02, causing missing I3 data
4. **Data overwrites**: Multiple extraction runs overwrote correct data with incorrect data
5. **No trend verification**: Failed to verify D > E > F > G > H > I > J > K > L > M price trend

### Correct Extraction Process (Mandatory)
```
1. Read actual Y coordinates from PDF for each color
2. Extract values at precise Y positions
3. Determine single vs side-by-side color rows
4. For side-by-side: sort by X position, interleave values (even indices = first color, odd = second)
5. Assign to correct table (left = .90-.99, right = 1.00-1.49, etc.)
6. VERIFY before saving:
   - ✓ 10 colors present
   - ✓ 11 clarities per color
   - ✓ Price trend D→M is strictly decreasing
   - ✓ No zero/negative/unrealistic values
7. Save incrementally (don't overwrite entire database)
```

### Critical Notes
- **Round and Pear coordinates are DIFFERENT** - always verify coordinates for each
- **Never assume** color positions - always read actual PDF coordinates
- **Always use coordinate-based extraction** - no hardcoded Y values
- **Left table X range**: ~3.5 to ~19 (not 18)
- **Right table X range**: ~19 to ~35
- **Y tolerance**: Use ±0.3 to catch slight variations

### Tools Created
- `scripts/extract_pear_complete.js` - Full extraction with coordinate method
- `scripts/validate_pear.js` - Validation against PDF
- `scripts/fix_90_99.js` - Fix specific range extraction

## Rapaport PDF Reading Method (Updated 2026-01-31)
When reading Rapaport PDF price lists, **ALWAYS use X/Y coordinate-based extraction**:
1. **Tool**: Use `pdf2json` Node.js library with coordinate parsing.
2. **Script Location**: `/home/node/clawd/scripts/read_rapaport.js`
3. **Method**:
   - Extract all text elements with their X/Y coordinates
   - Sort by Y position (top to bottom) then X (left to right)
   - Group by rows based on Y proximity
   - Identify table headers by looking for `(X.XX - X.XX CT.)` patterns
   - Extract values for each Color row (D, E, F, G, H, I, J, K, L, M)
4. **Verification**: After extraction, always verify key values against expected positions (e.g., 5.00-5.99 CT table: E VVS1 = 750)
5. **Output**: Generate a structured table for easy lookup:
   - Rows = Colors (D through M)
   - Columns = Clarities (IF, VVS1, VVS2, VS1, VS2, SI1, SI2, SI3, I1, I2, I3)

## Rapaport PDF Update Policy (Established 2026-02-01)
**MANDATORY**: When Rapaport PDF date changes, use the universal update script:
- **Script**: `scripts/update_rapaport_universal.js`
- **Command**: `node scripts/update_rapaport_universal.js <pdf_path>`

This script handles BOTH Round and Pear price lists with:
- Automatic PDF type detection (from filename)
- Coordinate-based extraction with verification
- Bold value detection (price changes)
- Automatic trend verification (D > E > F > G > H > I > J > K > L > M)
- Change report generation (increases/decreases with percentages)
- Database backup before update

**DO NOT** manually extract or update the database - always use this script to avoid errors.

## Rapaport PDF Extraction Workflow (Updated 2026-01-31)
1. **Check Date**: Compare PDF date with `rapaport_db.json` date field
2. **New Date** → Run universal update script with coordinate-based extraction
3. **Same Date** → Use existing `rapaport_db.json` for price calculations

## Detecting Price Changes in Rapaport PDF (New - 2026-02-01)
When Rapaport prices change from the previous week, the PDF shows **changed values in BOLD** to highlight price movements.

### When to Check for Bold Values
- **ONLY check for bold values when the PDF date is NEW** (different from database date)
- **If date is the same** → No need to check bold, use existing database

### Extraction Strategy for Price Changes
1. **Check PDF date first** - compare with `rapaport_db.json` date field
2. **If NEW date** → Use coordinate method to identify numeric values formatted as **bold**
3. **Bold detection**: In pdf2json, check text attributes (R[0].TS usually contains font info like bold flag)
4. **Track changes**: Compare bold values against existing database to identify:
   - Price increases (value higher than previous)
   - Price decreases (value lower than previous)
5. **Report changes**: When updating database, note which specific Color/Clarity combinations had price movements
6. **Update only changed values**: For efficiency, can update only bold values instead of re-extracting entire table

### Technical Notes
- Bold text in PDF usually has different font weight or style flags
- Check `text.R[0].TS` (text style) properties for bold indicators
- May need to compare font names (e.g., "Helvetica-Bold" vs "Helvetica")
- Use this to generate a "price change summary" for Josh

## V9 Stock List Integrator (Created 2026-01-30)
Script for integrating and formatting diamond stock lists according to V9 specifications.
1. **Script Location**: `/home/node/clawd/scripts/v9_stock_integrator.js`
2. **Dependencies**: `exceljs` (Node.js library)
3. **Key Features**:
   - **Auto-detection of swapped columns**: Detects per-row if Crt/Shape columns are swapped and corrects automatically
   - **Filtering**: Only includes rows with valid GIA numbers; excludes Total/Subtotal rows
   - **Shape normalization**: Converts `RD` → `RAD`, `BR` → `RBC`
   - **Sorting**: Shape (RBC first) → Carat (descending) → Color (D to Z)
   - **Grouping**: Inserts blank rows between different shapes
   - **Formatting**: All cells centered, Crt 2 decimals, Memo Price with commas
   - **Totals row**: Bold, sums carats and prices
4. **Usage**:
   ```bash
   node v9_stock_integrator.js file1.xlsx [file2.xlsx] ... [-o output.xlsx]
   ```
5. **Example**:
   ```bash
   node v9_stock_integrator.js stock1.xlsx stock2.xlsx -o merged_v9.xlsx
   ```

## Image Generation (Mandatory)
When asked to generate or draw an image:
1. **No API Requests**: Never ask the user for API keys (e.g., OpenAI/DALL-E) to generate images.
2. **Free Tools**: Use internal capabilities (like `canvas` tool with HTML/SVG/JS) or public free generation methods to provide the image.

## Advanced Diamond Knowledge (Learned 2026-01-30)

### Fancy Shapes Market Trends
**Popularity Ranking** (from most to least popular):
1. **Round (RBC)** - Always most liquid, benchmark pricing
2. **Emerald (EM)** - Looks larger, rectangular, prestigious
3. **Pear (PS)** - Looks larger, elongated, popular for pendants
4. **Oval** - Looks larger, 10-20% cheaper than Round
5. **Cushion (CU)** - Vintage style, recently trending up
6. **Radiant (RAD)** - High brilliance, best square shape
7. **Marquise** - Niche, but looks exceptionally large
8. **Asscher** - Vintage, Art Deco style
9. **Heart** - Gift market, niche
10. **Princess** - Previously popular, currently weaker

**Price Reference** (vs Round with same specs):
- Pear / Oval / Marquise: Rap table -10% to -20%
- Emerald: Rap table -10% to -15% (but premium for well-proportioned)
- Cushion: Square weaker; Elongated +5% to +10%
- Radiant: Close to Round for square cuts

### Cut Quality Impact on Pricing

**Key Proportions**:
| Parameter | Ideal Range | Notes |
|-----------|-------------|-------|
| **Table %** | 53-58% | Too large (>62%) causes light leakage; too small (<50%) appears dark |
| **Depth %** | 59-62.5% | Too deep looks smaller; too shallow leaks light |
| **Crown Angle** | 34-35° | Affects fire/scintillation |
| **Pavilion Angle** | 40.6-41° | Affects brilliance |
| **Girdle** | Thin-Medium-Slightly Thick | Too thick adds weight without adding diameter |

**Cut Grade Price Impact**:
- **3EX** (Cut, Polish, Symmetry all EX): Baseline price
- **2EX + 1VG**: -2% to -5%
- **1EX + 2VG**: -5% to -10%
- **All VG**: -10% to -15%
- **Any G or lower**: -20%+, difficult to sell unless large stone

### Fluorescence Price Impact

| Grade | Price Impact | Notes |
|-------|--------------|-------|
| **None** | Baseline | Most desirable, especially for high colors (D-F) |
| **Faint** | -0% to -2% | Negligible impact |
| **Medium Blue** | -2% to -5% | More concern for D-F; may not deduct for I-J |
| **Strong Blue** | -5% to -15% | May appear hazy, but has market |
| **Very Strong Blue** | -10% to -20% | Generally avoid unless heavily discounted |

**Special Case**: Some buyers specifically seek Strong Blue to offset yellow tint (making I-J appear whiter under UV).

### GIA Certificate Inclusion Types

| Type | Visual Impact | Acceptability |
|------|---------------|---------------|
| **Pinpoint** | Nearly invisible | ✅ Usually fine |
| **Crystal** | Small black dot | ✅ Acceptable if small |
| **Feather** | Crack-like | ⚠️ Avoid if large or near edge |
| **Cloud** | Hazy | ⚠️ Large areas affect brilliance |
| **Needle** | Pin-like | ✅ Usually fine |
| **Twinning Wisp** | Thread-like | ⚠️ Many affect light performance |
| **Knot** | Crystal breaking surface | ❌ Try to avoid |
| **Cavity** | Hole | ❌ Try to avoid |
| **Chip** | Broken edge | ❌ Try to avoid |
| **Bruise** | Impact mark | ❌ Try to avoid |

**Location Matters**: Central inclusions more visible; edge inclusions easier to set/hide.

### Market Knowledge

**Regional Price Differences**:
- **New York**: Rapaport baseline, typically -20% to -35% (depending on grade)
- **Hong Kong/Shenzhen**: Round typically 5-10% below NY; Fancy shapes vary more
- **India**: Lower prices but quality varies
- **Dubai**: Middle East market, prefers Fancy shapes

**Seasonal Factors**:
- **Nov-Jan**: Peak season (Christmas, NY, CNY prep), prices firm
- **Feb-Mar**: Slight dip after Valentine's
- **Apr-May**: Hong Kong show, Las Vegas (JCK), active market
- **Jun-Aug**: Traditional slow season, more negotiating room
- **Sep-Oct**: HK show, Christmas prep, prices rise

**Investment vs Commercial Grade**:
- **Investment**: D-F, IF-VVS, 3EX, 5ct+, retains value well
- **Commercial**: G-J, VS-SI, various cuts, 1-3ct, fast turnover

## Excel Techniques for Diamond Business (Learned 2026-01-30)

### Advanced Lookup Functions

**INDEX-MATCH** (more flexible than VLOOKUP):
```excel
=INDEX(return_range, MATCH(lookup_value, lookup_range, 0))
```
- Can look left-to-right or right-to-left
- Faster performance on large datasets

**XLOOKUP** (Excel 365):
```excel
=XLOOKUP(lookup_value, lookup_range, return_range, [if_not_found], [match_mode])
```
- Cleaner syntax
- Default exact match
- Can specify default value if not found

### Conditional Formatting Applications

Useful examples for diamond inventory:
- **Carat highlighting**: >5ct in green, 3-5ct in yellow
- **Duplicate GIA detection**: Highlight duplicate Cert No in red
- **Price anomaly**: Flag items ±20% from average

### Data Validation

Set restrictions for data entry:
- **Carat**: Must be number, >0
- **Color**: Dropdown list (D/E/F/G/H/I/J...)
- **Clarity**: Dropdown list (IF/VVS1/VVS2/VS1/...)
- **Shape**: Dropdown list (RBC/EM/PS/OVAL/CU/RAD...)

### Pivot Table Applications

Diamond inventory analysis:
- Group by Shape: Total carats, total value
- Distribution by Color/Clarity
- Analysis by Carat ranges (1-2ct, 2-3ct, 3-5ct, 5ct+)

### Dynamic Array Functions (Excel 2021/365) - Learned 2026-01-30

**FILTER** - Auto-filter data:
```excel
=FILTER(inventory_range, inventory[Shape]="RBC", "No data")
```
- Returns all matching rows automatically
- No manual copy-paste needed

**SORT / SORTBY** - Auto-sort:
```excel
=SORTBY(inventory, inventory[Carat], -1, inventory[Color], 1)
```
- `-1` = descending, `1` = ascending
- Multiple sort levels (Carat first, then Color)

**UNIQUE** - Extract unique values:
```excel
=UNIQUE(inventory[Shape])
```
- Quick list of all different shapes for dropdown menus

**LET** - Define variables (cleaner formulas):
```excel
=LET(
  carat, B2,
  price_per_ct, VLOOKUP(...),
  total, carat * price_per_ct,
  total * 0.95
)
```

### Text Processing Functions (Excel 2024) - Learned 2026-01-30

**TEXTBEFORE / TEXTAFTER** - Extract specific text:
```excel
=TEXTBEFORE("Parcel: US01/0046", ":")  // Returns "Parcel"
=TEXTAFTER("Parcel: US01/0046", ":")   // Returns " US01/0046"
```

**TEXTSPLIT** - Split text into columns:
```excel
=TEXTSPLIT("10.5-D-VVS1-EX", "-")
// Automatically splits into multiple columns
```

### Advanced Lookup Techniques - Learned 2026-01-30

**XLOOKUP** (improved features):
- Default exact match (no need to write FALSE)
- Can specify "if not found" value
- Can search from bottom to top

**XMATCH** - Upgraded MATCH:
```excel
=XMATCH("D", color_range, 0, -1)
// Last parameter -1 = search from last
```

### Practical Diamond Business Applications - Learned 2026-01-30

**Conditional Formatting with Formulas**:
- Highlight duplicate GIA No: `=COUNTIF($N:$N, $N2)>1`
- Flag price anomalies: `=ABS(D2-AVERAGE(D:D))/AVERAGE(D:D)>0.2`

**Dynamic Data Validation**:
- Combine with `UNIQUE` function for auto-updating dropdown options

**Quick Large Data Analysis**:
- `GROUPBY` (Excel 365) - Like Pivot Table but using functions
- `PIVOTBY` (Excel 365) - Auto summary analysis

### Power Query (ETL Tool) - Learned 2026-01-30
**Data Import & Transformation**:
- Auto-import and merge multiple Excel/CSV files
- Auto-clean data (remove blank rows, standardize formats)
- Set refresh rules - one-click update for all data
- Perfect for consolidating multiple stock lists

**Practical Applications**:
- Import all stock files from a folder automatically
- Standardize column names across different sources
- Remove duplicates and validate GIA numbers
- Create repeatable data cleaning workflows

### Power Pivot - Learned 2026-01-30
**Large Data Processing**:
- Handle millions of rows without slowing down
- Create data relationships (link tables by Cert No)
- Advanced calculated columns using DAX formulas

**DAX Formula Examples**:
```excel
// Calculate average price per carat
=AVERAGE([Memo Price]/[Crt])

// Count stones by shape
=CALCULATE(COUNTROWS(Inventory), Inventory[Shape]="RBC")
```

### VBA Automation - Learned 2026-01-30
**Automated Tasks**:
- One-click execution of repetitive tasks (batch formatting)
- Auto-generate reports and save with timestamp
- Custom functions for diamond calculations

**Example Use Cases**:
- Auto-format new stock lists to V9 standard
- Generate monthly inventory summary reports
- Validate data before processing

### Advanced Chart Techniques - Learned 2026-01-30
**Diamond Business Visualizations**:
- **Scatter Plot**: Show Carat vs Price relationship, identify outliers
- **Waterfall Chart**: Display price composition (base + premium)
- **Dynamic Charts**: Interactive charts with slicers (filter by Shape/Color)
- **Heat Maps**: Visualize inventory distribution by Carat/Color

### Advanced Conditional Formatting - Learned 2026-01-30
**Color Scales**:
- Show price gradient (green=low, yellow=medium, red=high)
- Visualize carat distribution across inventory

**Icon Sets**:
- Flag fast-moving items (🟢), slow-moving (🔴)
- Indicate stock age (📅)
- Mark high-value stones (💎)

## Daily Self-Learning Summary (Established 2026-02-01)
**Automated daily reflection and optimization routine**

### Schedule
- **Time**: 12:00 AM (Asia/Hong_Kong timezone)
- **Frequency**: Daily
- **Cron Job ID**: df7382f7-cff7-4b6f-999c-78893fd247e5

### Process
1. Review today's activities from `memory/YYYY-MM-DD.md`
2. Analyze learnings and skills acquired
3. Identify optimization opportunities
4. Write comprehensive summary in **Cantonese** including:
   - 今日工作總結
   - 學到嘅新知識/技能
   - 發現嘅問題同解決方法
   - 可以優化嘅地方
   - 明日改進計劃
5. Save to Apple Notes using `memo notes -a "AI 每日總結 - YYYY-MM-DD"`

### Output Location
- Apple Notes (created via memo CLI)
- Note title format: "AI 每日總結 - YYYY-MM-DD"

## Update Policy for Excel Techniques (Established 2026-01-30)
**Rule**: When learning new Excel techniques, proactively update MEMORY.md AND inform Josh about what was learned before updating.
**Process**:
1. Learn/discover new Excel technique
2. Inform Josh: "我學到新 Excel 技巧：[具體內容]」
3. Ask for confirmation or directly update MEMORY.md
4. Help with diamond stock lists, Rapaport pricing, and Excel formatting

## Token Management Strategy (Session Optimization - 2026-01-31)
To prevent session token overflow and maintain optimal performance:

### 1. Automatic Sub-agent Spawn (實行中)
**When to spawn sub-agent:**
- Processing >100 diamond records at once
- Reading and parsing large PDF files (>5MB)
- Batch Excel processing (multiple files)
- Long-running data extraction tasks
- Complex multi-step calculations

**Process:**
- Spawn isolated session with `sessions_spawn`
- Sub-agent handles heavy processing
- Returns summary/result to main session
- Main session remains lightweight

### 2. Session Status Monitoring (實行中)
**Trigger conditions for token check:**
- Every 10 messages
- Before starting complex tasks
- When conversation feels "heavy"

**Action if token usage >70%:**
- Summarize current context
- Propose starting fresh session with summary
- Ask user for confirmation

### 3. Conversation Summarization (實行中)
**Auto-summarize when:**
- Conversation >20 messages back-and-forth
- Multiple topics discussed
- Before switching major tasks

**Summary format:**
- Key decisions made
- Important data/info shared
- Outstanding questions/tasks
- Reference to files created/updated

### 4. Token Monitoring via Heartbeat (實行中)
**Heartbeat token check:**
- Periodic status check every ~1 hour
- Log token usage to heartbeat-state.json
- Alert if approaching threshold

### Implementation Checklist
- [x] Sub-agent spawn for heavy tasks
- [x] Pre-task token check
- [x] Auto-summarize long conversations
- [x] Heartbeat token monitoring
- [x] Document token management rules

## Identity & Workspace

### User
- **Name**: Ally / Josh (Diamond business context)
- **Business**: Diamond trading/stock management
- **Location**: Hong Kong / Shenzhen context
- **Tools**: Excel, Rapaport, GIA certificates

### Assistant
This context helps me assist with:
- Diamond pricing calculations
- Stock list formatting (V9 standard)
- Rapaport PDF reading
- Excel automation and techniques
- GIA certificate lookups

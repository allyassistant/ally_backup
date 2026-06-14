-- AppleScript for Mac Excel 2019
-- Auto-setup conditional formatting: Type Y in column A, entire row turns green
-- Usage: Open stock_mac.xlsx in Excel, then run this script

tell application "Microsoft Excel"
    activate
    
    -- Get the active workbook and worksheet
    set wb to active workbook
    set ws to active sheet
    
    -- Define the data range (A2 to P136 for 135 items)
    set dataRange to range "A2:P136" of ws
    
    -- Select the range
    select dataRange
    
    -- Delete any existing conditional formats first
    try
        delete conditional format dataRange
    end try
    
    -- Add conditional formatting rule
    -- Format: Formula-based, =$A2="Y", Green fill
    tell ws
        make new conditional format at end with properties ¬
            {format type:formula based, formula1:"=$A2=\"Y\""}
    end tell
    
    -- Apply green fill to the rule (light green)
    set format of conditional format 1 of dataRange to {interior color index:4} -- 4 = Light Green
    
    -- Add another rule for "y" (lowercase)
    tell ws
        make new conditional format at end with properties ¬
            {format type:formula based, formula1:"=$A2=\"y\""}
    end tell
    set format of conditional format 2 of dataRange to {interior color index:4}
    
    display dialog "✅ 設定完成！\n\n在 Checked 欄 (A欄) 打 Y，整行都會變綠色。\n\n提示：\n- 儲存檔案後下次開啟會保留設定\n- 可以為唔同狀態設定唔同顏色（修改腳本）" buttons {"確定"} default button "確定"
end tell

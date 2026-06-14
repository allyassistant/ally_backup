#!/bin/bash
#
# Create Qwen3 Excel Training Calendar Events
# Run this once to setup the recurring daily event in Apple Calendar
#

echo "Creating Qwen3 Excel Training schedule in Apple Calendar..."

# Create AppleScript to add calendar event
osascript << 'EOF'
tell application "Calendar"
    tell calendar "Home" -- 你可以改成其他日曆名稱
        -- 創建每日重複事件 3:00 AM - 9:00 AM
        set startDate to current date
        set time of startDate to 3 * hours -- 3:00 AM
        
        set endDate to current date
        set time of endDate to 9 * hours -- 9:00 AM
        
        make new event at end with properties {
            summary:"Qwen3 Excel Training Session",
            description:"Daily automated Excel training for Qwen3 AI assistant.\n\nTopics covered:\n- Advanced formulas\n- PivotTables\n- Power Query\n- VBA\n- Python + Excel\n\nNote: This runs in isolated session.",
            start date:startDate,
            end date:endDate,
            recurrence:"FREQ=DAILY;UNTIL=20260701T000000Z" -- 持續到 2026-07-01 (約5個月)
        }
    end tell
end tell
EOF

echo "✓ Calendar events created successfully!"
echo "Check your Apple Calendar 'Home' for 'Qwen3 Excel Training Session'"

#!/bin/bash
#
# Quick Session Recovery - After /reset, read latest backup summary
#

echo "🔍 Checking for previous session backup..."
echo ""

# Find the most recent backup note in Ally's Chat History
LATEST_NOTE=$(osascript << 'EOF'
tell application "Notes"
    set targetFolder to folder "Ally's Chat History"
    set allNotes to notes of targetFolder
    set noteCount to count of allNotes
    
    if noteCount = 0 then
        return "NO_NOTES"
    end if
    
    -- Get the latest note (by modification date)
    set latestNote to item 1 of allNotes
    set latestDate to modification date of latestNote
    
    repeat with i from 2 to noteCount
        set currentNote to item i of allNotes
        set currentDate to modification date of currentNote
        if currentDate > latestDate then
            set latestNote to currentNote
            set latestDate to currentDate
        end if
    end repeat
    
    return "TITLE:" & name of latestNote
end tell
EOF
)

if [ "$LATEST_NOTE" = "NO_NOTES" ]; then
    echo "⚠️  No previous backup found."
    echo "Starting fresh session."
    exit 0
fi

echo "📄 Found: $LATEST_NOTE"
echo ""
echo "✅ To view full content:"
echo "   1. Open Apple Notes"
echo "   2. Go to 'Ally's Chat History' folder"
echo "   3. Open the latest note"
echo ""
echo "💡 Tip: You can ask me to summarize or continue from specific topics mentioned in the backup."

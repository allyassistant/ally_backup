on run argv
  set toAddr to item 1 of argv
  set subjText to item 2 of argv
  set bodyText to item 3 of argv
  set ccAddr to item 4 of argv
  set bccAddr to item 5 of argv
  set attPaths to item 6 of argv
  set doSend to item 7 of argv as boolean
  
  tell application "Mail"
    set outMsg to make new outgoing message with properties {subject:subjText, content:bodyText}
    tell outMsg
      make new to recipient with properties {address:toAddr}
      if ccAddr is not "" then
        make new cc recipient with properties {address:ccAddr}
      end if
      if bccAddr is not "" then
        make new bcc recipient with properties {address:bccAddr}
      end if
    end tell
    if attPaths is not "" then
      set AppleScript's text item delimiters to ","
      set pathList to every text item of attPaths
      repeat with p in pathList
        set theFile to POSIX file p as string
        tell content of outMsg
          make new attachment with properties {file name:theFile as alias}
        end tell
      end repeat
    end if
    if doSend then
      send outMsg
    end if
    return id of outMsg
  end tell
end run

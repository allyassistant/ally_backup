# Code Review Report: failover_detector.sh

**Date:** 2026-03-25  
**Reviewer:** Sub-agent (Kimi)  
**Script:** `/Users/ally/.openclaw/workspace/scripts/failover_detector.sh`

---

## Summary

The script has **2 critical bugs** and **1 minor issue** that need fixing. The PEER_TASK extraction logic works for most cases but has an edge case with escaped quotes.

---

## 🚨 Critical Bugs

### 1. Function Called Before Definition (Line 150 vs 183)

**Problem:** `get_peer_recent_messages` is called on line 150 but defined on line 183.

```bash
# Line 150 - CALLED HERE
PEER_MSGS=$(get_peer_recent_messages)

# Line 183 - DEFINED HERE  
get_peer_recent_messages() { ... }
```

**Impact:** Bash will fail with "command not found" when trying to call the function.

**Fix:** Move the function definition to the top of the script, before it's called.

```bash
# Add this near the top, after the variable declarations
get_peer_recent_messages() {
    local peer_channels="1473343330170572904 1473384999003619500 1473383064565710929 1473376125584670872"
    local messages=""
    
    for channel_id in $peer_channels; do
        local last_msg=$(/opt/homebrew/bin/openclaw message read --channel discord --target channel:$channel_id --limit 3 2>/dev/null | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//')
        if [ -n "$last_msg" ]; then
            messages="$messages\n  $channel_id: ${last_msg:0:50}..."
        fi
    done
    
    echo -e "$messages"
}
```

---

### 2. PEER_TASK Fallback Doesn't Work (Line 152)

**Problem:** The `|| echo "待機中"` fallback never triggers because grep/sed exit with code 0 even when there's no match.

```bash
# Current (broken):
PEER_TASK=$(ssh ... | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*"current_task" *: *"\([^"]*\)".*/\1/' || echo "待機中")
```

**Test Results:**
```bash
# With no match:
Result: '' (empty string, fallback NOT triggered)

# Expected:
Result: '待機中'
```

**Fix Options:**

**Option A: Use pipefail (recommended)**
```bash
PEER_TASK=$(set -o pipefail; ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${PEER_SSH_USER}@$PEER_IP "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/current_task.json 2>/dev/null" 2>/dev/null | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*"current_task" *: *"\([^"]*\)".*/\1/' 2>/dev/null || echo "待機中")
```

**Option B: Check if result is empty**
```bash
PEER_TASK_RAW=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${PEER_SSH_USER}@$PEER_IP "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/current_task.json 2>/dev/null" 2>/dev/null)
PEER_TASK=$(echo "$PEER_TASK_RAW" | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*"current_task" *: *"\([^"]*\)".*/\1/')
[ -z "$PEER_TASK" ] && PEER_TASK="待機中"
```

---

## ⚠️ Edge Cases in PEER_TASK Extraction

### Test Results for Current Regex

| Test Case | Result | Status |
|-----------|--------|--------|
| Normal JSON | `Processing L1 Generator` | ✅ Pass |
| Extra spaces around colon | `Multiple   Spaces Test` | ✅ Pass |
| Empty task value | (empty) | ⚠️ Falls through to default |
| `null` value (no quotes) | (empty) | ⚠️ Falls through to default |
| Missing field | (empty) | ⚠️ Falls through to default |
| Chinese characters | `處理Stock - 多筆資料(123)` | ✅ Pass |
| **Escaped quotes inside value** | `Testing \` | ❌ **Broken** |
| Single line JSON | `Single line test` | ✅ Pass |

**Issue with escaped quotes:**
```json
{"current_task": "Testing \"quotes\" inside"}
# Extracts: "Testing \
# Should be: Testing "quotes" inside
```

**Impact:** Low - unlikely to have escaped quotes in task descriptions.

---

## 🔧 Minor Issues

### 1. Inefficient Multiple SSH Connections

The script makes **9 separate SSH connections** per run. This creates unnecessary overhead.

**Could optimize by:**
- Combining heartbeat + task reading into one SSH call
- Caching results for the duration of the script

**Not critical** - works correctly, just inefficient.

---

### 2. PEER_MSGS Function Issues

The `get_peer_recent_messages` function:
1. **Not defined before use** (critical bug #1)
2. Uses `echo -e` which may not work consistently across systems
3. Has no error handling for `openclaw message read` failures

---

## ✅ What Works Well

1. **Dual-layer check logic** (SSH + Heartbeat) is sound
2. **Status tracking** with `LAST_STATUS_FILE` prevents duplicate notifications
3. **Proper SSH options** (`ConnectTimeout=5`, `StrictHostKeyChecking=no`)
4. **Date parsing** with fallback to "unknown"
5. **Detector pattern** for who-triggered-failover is clever

---

## Recommended Fixes (Priority Order)

### Priority 1: Critical
1. **Move `get_peer_recent_messages` function to top of file** (before line 68)
2. **Fix PEER_TASK fallback** using Option A or B above

### Priority 2: Nice to Have
3. Consider using `jq` for JSON parsing instead of grep/sed (more robust)
4. Add validation that `openclaw` CLI is available before using it

---

## Patch File

```diff
--- a/scripts/failover_detector.sh
+++ b/scripts/failover_detector.sh
@@ -25,6 +25,22 @@ OFFLINE_THRESHOLD=3  # 3 minutes
 CURRENT_UTC=$(date -u +%s)
 
+# ======== Function Definitions (must be before use) ========
+get_peer_recent_messages() {
+    local peer_channels="1473343330170572904 1473384999003619500 1473383064565710929 1473376125584670872"
+    local messages=""
+    
+    for channel_id in $peer_channels; do
+        local last_msg=$(/opt/homebrew/bin/openclaw message read --channel discord --target channel:$channel_id --limit 3 2>/dev/null | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//')
+        if [ -n "$last_msg" ]; then
+            messages="$messages\n  $channel_id: ${last_msg:0:50}..."
+        fi
+    done
+    
+    echo -e "$messages"
+}
+
 # ======== State tracking file ========
 LAST_STATUS_FILE="$HOME/.openclaw/workspace/ha-state/last_status_${PEER_ID}"
 LAST_SSH_FILE="$HOME/.openclaw/workspace/ha-state/last_ssh_${PEER_ID}"
@@ -149,7 +165,9 @@ if [ "$LAST_STATUS" = "online" ] && [ "$CURRENT_STATUS" = "offline" ]; then
     PEER_TS_HKT=$(TZ=Asia/Hong_Kong date -r $PEER_EPOCH "+%Y-%m-%d %H:%M" 2>/dev/null || echo "unknown")
     # Get peer's recent Discord messages AND current task
     PEER_MSGS=$(get_peer_recent_messages)
-    # Get peer's current task from their heartbeat
-    PEER_TASK=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${PEER_SSH_USER}@$PEER_IP "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/current_task.json 2>/dev/null" 2>/dev/null | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*"current_task" *: *"\([^"]*\)".*/\1/' || echo "待機中")
+    # Get peer's current task from their task file
+    PEER_TASK=$(set -o pipefail; ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${PEER_SSH_USER}@$PEER_IP "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/current_task.json 2>/dev/null" 2>/dev/null | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*"current_task" *: *"\([^"]*\)".*/\1/' 2>/dev/null || echo "待機中")
     MESSAGE="⚠️ **Failover 通知**\n\n$PEER_NAME 已離線！\n\n原因: $REASON\n\n最後 Heartbeat：$PEER_TS_HKT\n\n📝 **對方做緊：**\n$PEER_TASK\n\n📝 **對方最近訊息：**\n$PEER_MSGS\n\n我已經準備好接手，有需要既話喺任何 channel @我就得！"
     /opt/homebrew/bin/openclaw message send --channel discord --target channel:$CHANNEL_ID --message "$MESSAGE" 2>&1 || echo "Failed to send"
     echo "$(date): Failover triggered - $PEER_NAME is offline"
@@ -180,15 +198,3 @@ fi
 
 # Update last status
 echo "$CURRENT_STATUS" > "$LAST_STATUS_FILE"
-
-# ======== Function: Get Peer's Recent Discord Messages ========
-get_peer_recent_messages() {
-    local peer_channels="1473343330170572904 1473384999003619500 1473383064565710929 1473376125584670872"
-    local messages=""
-    
-    for channel_id in $peer_channels; do
-        local last_msg=$(/opt/homebrew/bin/openclaw message read --channel discord --target channel:$channel_id --limit 3 2>/dev/null | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//')
-        if [ -n "$last_msg" ]; then
-            messages="$messages\n  $channel_id: ${last_msg:0:50}..."
-        fi
-    done
-    
-    echo -e "$messages"
-}
```

---

## Conclusion

The script has solid logic but **needs 2 critical fixes before deployment**:

1. Move the `get_peer_recent_messages` function to the top of the file
2. Add `set -o pipefail` to the PEER_TASK extraction command

After these fixes, the script should work correctly for the failover notification flow.

# Conversation Context Handoff Research Report

## Executive Summary

This report analyzes the current HA (High Availability) architecture between Ally (Mac A) and Bliss (Mac B) and proposes implementation strategies for "conversation context handoff" during failover events.

---

## 1. What is "Conversation Context"?

### Definition
Conversation context is the **stateful information** that allows an AI assistant to maintain continuity across interactions. When a failover occurs, the taking-over bot needs this context to seamlessly continue conversations.

### Components of Conversation Context

| Component | Description | Priority |
|-----------|-------------|----------|
| **Recent Messages** | Last N messages from each channel (Discord, WhatsApp, Signal) | P0 - Critical |
| **Session State** | Current active sessions, in-progress tasks, pending responses | P0 - Critical |
| **Active Issues** | In-progress `.issues/active/` items with current step | P1 - High |
| **User Preferences** | Recent preferences expressed in conversation | P1 - High |
| **Memory References** | L0/L1 summaries currently being referenced | P2 - Medium |
| **Pending Tool Calls** | Any incomplete browser actions, file operations | P2 - Medium |
| **Router Decisions** | Current `.router-decision.json` state | P3 - Low |

### Current State Analysis

**Existing Context Storage:**
```
~/.openclaw/workspace/
├── .router-decision.json        # Current routing decision
├── memory/session-state.json    # Legacy session tracking
├── .issues/active/              # Active task tracking
└── memory/YYYY-MM-DD.md         # Daily conversation logs
```

**Current Gap:**
- No real-time conversation context capture
- Failover only sends: "I'm ready to take over"
- Peer cannot see what was being discussed

---

## 2. Where is Context Stored in OpenClaw?

### 2.1 Gateway-Level Storage

```
~/.openclaw/
├── gateway.log                  # Real-time gateway activity
├── agents/
│   └── {agent-id}/
│       └── sessions/
│           └── {session-id}.jsonl   # Session transcripts
├── delivery-queue/              # Pending message queue
│   └── failed/                  # Failed deliveries
└── memory/                      # System-wide memory
```

### 2.2 Workspace-Level Storage

```
~/.openclaw/workspace/
├── .state/                      # Runtime state
│   └── *.json                   # Various state files
├── memory/
│   ├── session-state.json       # Pending tasks & in-progress work
│   ├── l0-abstract/             # 200-word daily summaries
│   ├── l1-overview/             # 600-word detailed summaries
│   └── YYYY-MM-DD.md            # Raw conversation logs
├── .issues/
│   ├── active/                  # Current tasks with progress
│   └── archive/                 # Completed tasks
├── .router-decision.json        # Last routing decision
└── ha-state/                    # HA coordination
    ├── ally/heartbeat.json
    └── bliss/heartbeat.json
```

### 2.3 Session Storage Format

Session files (`~/.openclaw/agents/{agent}/sessions/{id}.jsonl`) contain:
```json
{"type":"user","content":"...","timestamp":"..."}
{"type":"assistant","content":"...","timestamp":"..."}
{"type":"tool","name":"...","result":"...","timestamp":"..."}
```

### 2.4 Memory Hierarchy (L0/L1/L2)

| Level | Location | Content | Update Frequency |
|-------|----------|---------|------------------|
| L0 | `memory/l0-abstract/` | 200-word summary | Daily @ 00:05 |
| L1 | `memory/l1-overview/` | 600-word detailed | Daily @ 00:35 |
| L2 | `memory/YYYY-MM-DD.md` | Full raw logs | Continuous |

---

## 3. How to Capture Context from Offline Node?

### 3.1 Current HA Architecture

```
Ally (Mac A)                    Bliss (Mac B)
    │                               │
    ├── heartbeat.sh ───────────────┤ (via SSH)
    │                               │
    ├── failover_detector.sh ←──────┤ (checks peer)
    │                               │
    └── ha-state/ally/              └── ha-state/bliss/
            └── heartbeat.json              └── heartbeat.json
```

### 3.2 SSH-Based Context Retrieval

The current system already uses SSH for heartbeat checking. We can extend this:

```bash
# Current: Check heartbeat
ssh bliss@[TAILSCALE_BLISS_IP] 'cat ~/.openclaw/workspace/ha-state/bliss/heartbeat.json'

# Proposed: Retrieve conversation context
ssh bliss@[TAILSCALE_BLISS_IP] 'cat ~/.openclaw/workspace/ha-state/bliss/context-snapshot.json'
```

### 3.3 Context Capture Timing

| Trigger | Action | Data Captured |
|---------|--------|---------------|
| Every message | Append to session log | Full message history |
| Every 5 minutes | Write context snapshot | Recent messages + state |
| Failover detected | Full context pull | Complete conversation state |
| Session end | Archive to memory | Full session transcript |

---

## 4. Implementation Options

### Option A: HA Shared Folder with Context Snapshots (Recommended)

**Architecture:**
```
~/Desktop/OpenClaw-HA-Shared/    # Or use ha-state/ with SSH
├── ally/
│   ├── heartbeat.json
│   └── context-snapshot.json    # NEW: Updated every 5 min
├── bliss/
│   ├── heartbeat.json
│   └── context-snapshot.json    # NEW: Updated every 5 min
└── shared/
    └── failover-context.json    # NEW: Full context on failover
```

**Pros:**
- ✅ Fast failover (no SSH wait during failover)
- ✅ Bidirectional (both nodes can read/write)
- ✅ Version controlled (timestamp-based)
- ✅ Works with existing heartbeat infrastructure

**Cons:**
- ❌ Requires file sync (or SSH read)
- ❌ 5-minute staleness window

**Implementation:**
```bash
# context_snapshot.sh - Run every 5 minutes via cron
#!/bin/bash
NODE_ID=${NODE_ID:-ally}
CONTEXT_FILE="~/.openclaw/workspace/ha-state/${NODE_ID}/context-snapshot.json"

# Gather recent Discord messages
RECENT_MSGS=$(openclaw message read --channel discord --limit 10 --json 2>/dev/null || echo "[]")

# Gather active issues
ACTIVE_ISSUES=$(ls ~/.openclaw/workspace/.issues/active/*.md 2>/dev/null | wc -l)

# Get current session state
SESSION_STATE=$(cat ~/.openclaw/workspace/memory/session-state.json 2>/dev/null || echo "{}")

# Write snapshot
cat > "$CONTEXT_FILE" << EOF
{
  "node_id": "$NODE_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "recent_messages": $RECENT_MSGS,
  "active_issues": $ACTIVE_ISSUES,
  "session_state": $SESSION_STATE,
  "current_focus": "$(cat ~/.openclaw/workspace/.router-decision.json 2>/dev/null | jq -r '.taskType // "general"')"
}
EOF
```

---

### Option B: Memory-Based with Timestamps

**Architecture:**
```
~/.openclaw/workspace/memory/
├── failover-contexts/           # NEW
│   ├── 2026-03-25T12-00-00-ally.json
│   ├── 2026-03-25T12-05-00-ally.json
│   └── 2026-03-25T12-10-00-bliss.json
└── current-context.json         # Symlink to latest
```

**Pros:**
- ✅ Uses existing memory infrastructure
- ✅ Automatic cleanup via memory_cleanup.js
- ✅ Version history preserved

**Cons:**
- ❌ Requires SSH to read peer's memory
- ❌ More complex file management
- ❌ Slower retrieval

---

### Option C: Discord Message Reading (Currently Partially Implemented)

**Current Implementation:**
```bash
# In failover_detector.sh
get_peer_recent_messages() {
    local peer_channels="1473343330170572904 1473384999003619500 ..."
    for channel_id in $peer_channels; do
        local last_msg=$(openclaw message read --channel discord ...)
    done
}
```

**Pros:**
- ✅ Already implemented
- ✅ No file sync needed
- ✅ Persistent (Discord history)

**Cons:**
- ❌ Only captures Discord (not WhatsApp/Signal)
- ❌ No session state or pending tasks
- ❌ Limited to last few messages

**Enhancement:**
```javascript
// Enhanced Discord context reader
async function getFullDiscordContext() {
  const channels = [
    '1473343330170572904', // 🤖一般
    '1473384999003619500', // 🧑🏻‍💻編程
    '1473383064565710929', // 💼工作
    '1473376125584670872'  // ⚙️系統
  ];
  
  const context = {
    lastMessages: {},
    activeThreads: [],
    recentMentions: []
  };
  
  for (const channelId of channels) {
    const messages = await messageRead({channel: 'discord', target: `channel:${channelId}`, limit: 5});
    context.lastMessages[channelId] = messages;
  }
  
  return context;
}
```

---

## 5. Recommended Implementation

### Hybrid Approach: Option A + Enhanced Option C

**Why Hybrid?**
1. **Fast Failover**: Local snapshots (Option A) for immediate context
2. **Complete Picture**: Discord reading (Option C) for recent user messages
3. **Rich State**: Session state + active issues for task continuity

### Implementation Plan

#### Phase 1: Context Snapshot (Option A)

**New Files:**
```
~/.openclaw/workspace/scripts/
├── context_snapshot.sh          # Capture context every 5 min
├── context_reader.sh            # Read peer context via SSH
└── context_handoff.sh           # Execute during failover
```

**1. context_snapshot.sh:**
```bash
#!/bin/bash
# Run every 5 minutes via cron
# Captures: recent messages, active issues, session state

NODE_ID=${NODE_ID:-ally}
SNAPSHOT_FILE="$HOME/.openclaw/workspace/ha-state/${NODE_ID}/context-snapshot.json"

# Ensure directory exists
mkdir -p "$(dirname "$SNAPSHOT_FILE")"

# Get recent Discord messages from key channels
get_recent_messages() {
    local channels=("1473343330170572904" "1473384999003619500" "1473383064565710929")
    local messages="["
    local first=true
    
    for channel_id in "${channels[@]}"; do
        local msgs=$(/opt/homebrew/bin/openclaw message read --channel discord --target "channel:$channel_id" --limit 3 2>/dev/null | jq -c '.[]' 2>/dev/null)
        if [ -n "$msgs" ]; then
            if [ "$first" = true ]; then
                first=false
            else
                messages+=","
            fi
            messages+=$(echo "$msgs" | jq -s '.')
        fi
    done
    
    messages+="]"
    echo "$messages"
}

# Get active issues
get_active_issues() {
    ls "$HOME/.openclaw/workspace/.issues/active/"*.md 2>/dev/null | while read -r file; do
        basename "$file" .md
    done | jq -R -s -c 'split("\n") | map(select(length > 0))'
}

# Get session state
get_session_state() {
    cat "$HOME/.openclaw/workspace/memory/session-state.json" 2>/dev/null || echo '{}'
}

# Build snapshot
cat > "$SNAPSHOT_FILE" << SNAPSHOT
{
  "node_id": "$NODE_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "local_time": "$(date '+%Y-%m-%d %H:%M:%S %Z')",
  "recent_messages": $(get_recent_messages),
  "active_issues": $(get_active_issues),
  "session_state": $(get_session_state),
  "router_decision": $(cat "$HOME/.openclaw/workspace/.router-decision.json" 2>/dev/null || echo '{}')
}
SNAPSHOT

echo "Context snapshot written: $SNAPSHOT_FILE"
```

**2. Cron Entry:**
```bash
# Add to crontab
*/5 * * * * $HOME/.openclaw/workspace/scripts/context_snapshot.sh >> $HOME/.openclaw/workspace/logs/context_snapshot.log 2>&1
```

#### Phase 2: Failover Context Retrieval

**Modify failover_detector.sh:**
```bash
# After detecting peer offline, retrieve their context
retrieve_peer_context() {
    local PEER_IP="$1"
    local PEER_USER="$2"
    local PEER_ID="$3"
    
    # Retrieve peer's last context snapshot via SSH
    local PEER_CONTEXT=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
        "${PEER_USER}@${PEER_IP}" \
        "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/context-snapshot.json 2>/dev/null" 2>/dev/null)
    
    if [ -n "$PEER_CONTEXT" ]; then
        # Save to shared location for reference
        echo "$PEER_CONTEXT" > "$HOME/.openclaw/workspace/ha-state/last-peer-context.json"
        
        # Extract key info for notification
        local PEER_LAST_MSG=$(echo "$PEER_CONTEXT" | jq -r '.recent_messages[0].content // "N/A"' | cut -c1-100)
        local PEER_ACTIVE_ISSUES=$(echo "$PEER_CONTEXT" | jq -r '.active_issues | length')
        
        echo "Last message: $PEER_LAST_MSG"
        echo "Active issues: $PEER_ACTIVE_ISSUES"
    fi
}
```

#### Phase 3: Contextual Failover Message

**Enhanced Failover Notification:**
```bash
# In failover_detector.sh, when peer goes offline:

PEER_CONTEXT=$(retrieve_peer_context "$PEER_IP" "$PEER_SSH_USER" "$PEER_ID")

# Build contextual message
MESSAGE="⚠️ **Failover 通知**

$PEER_NAME 已離線！

原因: $REASON
最後 Heartbeat：$PEER_TS_HKT

📋 **對方正在處理：**
$(echo "$PEER_CONTEXT" | jq -r '.active_issues[]' | head -5 | sed 's/^/• /')

💬 **最近對話：**
$(echo "$PEER_CONTEXT" | jq -r '.recent_messages[0].content' | cut -c1-150)...

📝 **對方最近訊息：**
$PEER_MSGS

✅ 我已準備好接手，有需要既話喺任何 channel @我就得！

---
*接手內容已從對方最後狀態提取*"
```

### Phase 4: Session Recovery Integration

**Modify session recovery process:**
```javascript
// scripts/context_aware_recovery.js
const fs = require('fs');
const path = require('path');

function loadFailoverContext() {
    const contextPath = path.join(process.env.HOME, '.openclaw/workspace/ha-state/last-peer-context.json');
    
    if (fs.existsSync(contextPath)) {
        const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
        
        console.log('📋 從對方提取的內容：');
        console.log(`• 最後活動: ${context.timestamp}`);
        console.log(`• 活躍任務: ${context.active_issues?.length || 0} 個`);
        console.log(`• 最近訊息: ${context.recent_messages?.length || 0} 條`);
        
        return context;
    }
    
    return null;
}

module.exports = { loadFailoverContext };
```

---

## 6. Context Usage for Takeover

### When Failover Occurs

1. **Retrieve Context** (via SSH)
2. **Parse Key Information:**
   - Recent conversation topics
   - Active issues/tasks
   - Pending user requests
3. **Generate Takeover Summary:**
   - What was being discussed
   - What needs attention
   - Suggested next actions

### Example Takeover Flow

```
Bliss goes offline
    ↓
Ally detects (via heartbeat)
    ↓
Ally retrieves Bliss's context snapshot via SSH
    ↓
Ally sends contextual notification:
    "⚠️ Failover: Bliss offline
     
     📋 Bliss was working on:
        • Issue #061 - Template Engine
        • Issue #018 - Router threshold
     
     💬 Last message in #🤖一般:
        '研究一下點實現 conversation context handoff'
     
     ✅ Ally ready to continue"
    ↓
User can continue: "繼續研究緊嗰個 context handoff"
    ↓
Ally uses retrieved context to continue seamlessly
```

---

## 7. Code Examples

### Complete context_snapshot.sh
```bash
#!/bin/bash
# context_snapshot.sh - Capture conversation context for HA failover

set -euo pipefail

NODE_ID="${NODE_ID:-ally}"
WORKSPACE_DIR="${HOME}/.openclaw/workspace"
SNAPSHOT_FILE="${WORKSPACE_DIR}/ha-state/${NODE_ID}/context-snapshot.json"
LOG_FILE="${WORKSPACE_DIR}/logs/context_snapshot.log"

# Ensure directories exist
mkdir -p "$(dirname "$SNAPSHOT_FILE")" "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Get recent Discord messages (last 3 from each channel)
get_discord_context() {
    local channels=(
        "1473343330170572904:general"
        "1473384999003619500:programming"  
        "1473383064565710929:work"
        "1473376125584670872:system"
    )
    
    local context="{"
    local first=true
    
    for channel_info in "${channels[@]}"; do
        IFS=':' read -r channel_id channel_name <<< "$channel_info"
        
        local msgs
        msgs=$(/opt/homebrew/bin/openclaw message read \
            --channel discord \
            --target "channel:$channel_id" \
            --limit 3 2>/dev/null | jq -c '.[]' 2>/dev/null | head -3) || msgs=""
        
        if [ "$first" = true ]; then
            first=false
        else
            context+=","
        fi
        
        context+="\"$channel_name\":"
        if [ -n "$msgs" ]; then
            context+=$(echo "$msgs" | jq -s '.')
        else
            context+="[]"
        fi
    done
    
    context+="}"
    echo "$context"
}

# Get active issues with priority
get_active_issues() {
    local issues_dir="${WORKSPACE_DIR}/.issues/active"
    
    if [ ! -d "$issues_dir" ] || [ -z "$(ls -A "$issues_dir" 2>/dev/null)" ]; then
        echo "[]"
        return
    fi
    
    ls "$issues_dir/"*.md 2>/dev/null | head -10 | while read -r file; do
        local issue_id=$(basename "$file" .md | cut -d'-' -f1)
        local title=$(head -1 "$file" | sed 's/# //' | cut -c1-50)
        echo "{\"id\":\"$issue_id\",\"title\":\"$title\"}"
    done | jq -s '.'
}

# Get current session state
get_session_state() {
    local state_file="${WORKSPACE_DIR}/memory/session-state.json"
    if [ -f "$state_file" ]; then
        cat "$state_file"
    else
        echo '{"pendingTasks":[],"inProgress":{}}'
    fi
}

# Get router decision if available
get_router_decision() {
    local router_file="${WORKSPACE_DIR}/.router-decision.json"
    if [ -f "$router_file" ]; then
        cat "$router_file" | jq '{
            decision: .decision,
            complexity: .complexity,
            taskType: .taskType,
            timestamp: .timestamp
        }'
    else
        echo '{}'
    fi
}

# Build and write snapshot
main() {
    log "Starting context snapshot for $NODE_ID"
    
    local snapshot
    snapshot=$(cat << EOF
{
  "metadata": {
    "node_id": "$NODE_ID",
    "timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "timestamp_local": "$(date '+%Y-%m-%d %H:%M:%S %Z')",
    "version": "1.0"
  },
  "discord_context": $(get_discord_context),
  "active_issues": $(get_active_issues),
  "session_state": $(get_session_state),
  "router_decision": $(get_router_decision)
}
EOF
)
    
    echo "$snapshot" > "$SNAPSHOT_FILE"
    log "Snapshot written: $SNAPSHOT_FILE ($(echo "$snapshot" | wc -c) bytes)"
}

main "$@"
```

### Modified failover_detector.sh (Context Retrieval Section)
```bash
# Add to failover_detector.sh after detecting peer offline

retrieve_and_use_context() {
    local PEER_IP="$1"
    local PEER_USER="$2"  
    local PEER_ID="$3"
    local PEER_NAME="$4"
    
    log "Retrieving context from $PEER_NAME..."
    
    # Try to get peer's context snapshot
    local PEER_CONTEXT
    PEER_CONTEXT=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
        "${PEER_USER}@${PEER_IP}" \
        "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/context-snapshot.json 2>/dev/null" 2>/dev/null) || PEER_CONTEXT=""
    
    if [ -z "$PEER_CONTEXT" ]; then
        log "No context snapshot available from $PEER_NAME"
        return 1
    fi
    
    # Save for later reference
    local CONTEXT_FILE="$HOME/.openclaw/workspace/ha-state/last-peer-context.json"
    echo "$PEER_CONTEXT" > "$CONTEXT_FILE"
    
    # Extract key information
    local SNAPSHOT_TIME=$(echo "$PEER_CONTEXT" | jq -r '.metadata.timestamp_local // "unknown"')
    local ACTIVE_ISSUES=$(echo "$PEER_CONTEXT" | jq -r '.active_issues | length')
    local LAST_MSG=$(echo "$PEER_CONTEXT" | jq -r '.discord_context.general[0].content // "N/A"' | cut -c1-100)
    
    # Build contextual failover message
    local MESSAGE="⚠️ **Failover 通知**

$PEER_NAME 已離線！

📊 **對方最後狀態** (${SNAPSHOT_TIME}):
• 活躍任務: ${ACTIVE_ISSUES} 個
• 最近對話: ${LAST_MSG}...

$(if [ "$ACTIVE_ISSUES" -gt 0 ]; then
    echo "📋 **正在處理：**"
    echo "$PEER_CONTEXT" | jq -r '.active_issues[] | "• " + .id + ": " + .title' | head -5
fi)

✅ **Ally 已準備好接手！**
有需要既話喺任何 channel @我就得。"

    # Send notification
    /opt/homebrew/bin/openclaw message send \
        --channel discord \
        --target "channel:$CHANNEL_ID" \
        --message "$MESSAGE" 2>&1 || log "Failed to send notification"
    
    log "Contextual failover notification sent"
}

# Call in main failover logic:
# retrieve_and_use_context "$PEER_IP" "$PEER_SSH_USER" "$PEER_ID" "$PEER_NAME"
```

---

## 8. Summary & Recommendations

### Recommended Approach: Hybrid (Option A + Enhanced C)

| Aspect | Implementation |
|--------|---------------|
| **Storage** | `ha-state/{node}/context-snapshot.json` |
| **Update Frequency** | Every 5 minutes via cron |
| **Failover Retrieval** | SSH to read peer's snapshot |
| **Message Context** | Enhanced Discord reading as backup |
| **Session State** | Include `session-state.json` content |

### Implementation Priority

1. **P0 (Immediate)**: Deploy `context_snapshot.sh` on both nodes
2. **P1 (This Week)**: Modify `failover_detector.sh` to retrieve and use context
3. **P2 (Next Week)**: Enhance Discord message reading for richer context
4. **P3 (Future)**: Real-time context streaming via WebSocket/push

### Expected Outcome

After implementation:
- ✅ Failover notifications include: "Bliss was working on Issue #061..."
- ✅ User can say "繼續」and Ally knows what "繼續」means
- ✅ Active tasks don't get lost during failover
- ✅ Conversation continuity maintained across HA pair

### Files to Create/Modify

**New Files:**
- `scripts/context_snapshot.sh`
- `scripts/context_reader.sh`
- `scripts/context_aware_recovery.js`

**Modified Files:**
- `scripts/failover_detector.sh`
- `scripts/heartbeat.sh` (add context reference)
- Crontab (add 5-minute snapshot job)

---

*Report Generated: 2026-03-25*
*Research Agent: Sub-agent (Kimi K2.5)*
*Scope: HA Conversation Context Handoff for Ally/Bliss Pair*

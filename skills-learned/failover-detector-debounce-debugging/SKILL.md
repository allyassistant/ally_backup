---
name: failover-detector-debounce-debugging
description: Diagnose and fix failover detector debounce bugs where offline notifications stop sending — the status file write uses CURRENT_STATUS instead of NOTIFY_STATUS after the debounce filter, preventing state transitions.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-29T12:00:00.000Z
stability: experimental
---

## Workflow

1. **Pull both machines' failover detector scripts side by side.**
   SSH to each machine and read the script:
   ```bash
   ssh user@ally 'cat ~/scripts/failover_detector.sh'
   ssh user@bliss 'cat ~/scripts/failover_detector.sh'
   ```
   Compare the two versions to confirm they are identical after the fix.

2. **Run the detector on both machines and check recent logs.**
   ```bash
   ssh user@ally 'bash ~/scripts/failover_detector.sh && cat ~/logs/failover.log | tail -20'
   ssh user@bliss 'bash ~/scripts/failover_detector.sh && cat ~/logs/failover.log | tail -20'
   ```
   Look for the debounce entries: "debounce 1/2", "debounce 2/2", or the absence of the transition message.

3. **Identify the debounce state tracking bug.**
   In the script, locate the section near the end where `LAST_STATUS_FILE` is written. The bug is:
   ```bash
   # BUGGY — writes raw CURRENT_STATUS, bypassing debounce
   echo "$CURRENT_STATUS" > "$LAST_STATUS_FILE"
   ```
   The correct fix writes `NOTIFY_STATUS` instead:
   ```bash
   # FIXED — reflects the debounced notify-eligible state
   echo "$NOTIFY_STATUS" > "$LAST_STATUS_FILE"
   ```
   Without this fix, the debounce completes but the state file records the wrong value, so the transition from `online→offline` is never recorded and notifications are silently dropped.

4. **Apply the fix to both machines.**
   ```bash
   # On ally
   sed -i 's/echo "$CURRENT_STATUS" > "$LAST_STATUS_FILE"/echo "$NOTIFY_STATUS" > "$LAST_STATUS_FILE"/' ~/scripts/failover_detector.sh
   # On bliss
   sed -i 's/echo "$CURRENT_STATUS" > "$LAST_STATUS_FILE"/echo "$NOTIFY_STATUS" > "$LAST_STATUS_FILE"/' ~/scripts/failover_detector.sh
   ```
   Then verify the fix was applied:
   ```bash
   grep "LAST_STATUS_FILE" ~/scripts/failover_detector.sh
   ```

5. **Verify the fix with a deliberate offline trigger.**
   On the peer machine, write a stale heartbeat to force the detector to see the peer as offline:
   ```bash
   # Set heartbeat to 10+ minutes ago on the peer
   ssh user@bliss 'echo "2026-06-29T08:10:00Z" > ~/.openclaw/heartbeat'
   ```
   Run the detector on the primary machine twice (debounce is 2-run threshold):
   ```bash
   bash ~/scripts/failover_detector.sh
   sleep 65
   bash ~/scripts/failover_detector.sh
   cat ~/logs/failover.log | grep -E "debounce|offline|notify"
   ```
   Expected on run 2: "Peer offline detected → Discord notification sent" and `LAST_STATUS_FILE` shows `offline`.

6. **Restore real state and verify both sides recover.**
   If the peer was genuinely online, restore the heartbeat and confirm recovery notification:
   ```bash
   # Restore fresh heartbeat on peer
   ssh user@bliss 'date -u +"%Y-%m-%dT%H:%M:%SZ" > ~/.openclaw/heartbeat'
   # Run detector to trigger recovery
   bash ~/scripts/failover_detector.sh
   ```

7. **Check offline_since and peer_check_count state files on both sides.**
   ```bash
   cat ~/state/offline_since_ally   # created on first offline detection
   cat ~/state/offline_since_bliss  # created on first offline detection
   cat ~/state/peer_check_count_ally  # should be 0 after recovery
   ```
   These files track the timeline and help distinguish self-recovery from peer-failover events.

## Pitfalls

- ⚠️ SSH cache overwrites test heartbeat files — when you run the detector via SSH, it re-fetches the peer's live heartbeat and overwrites your fake stale file, making it impossible to trigger the offline condition. Work around this by checking the heartbeat locally on the machine where you run the detector, not via SSH.

- ⚠️ The debounce debits the `peer_check_count` file on every run regardless of outcome — if you restart the detector or cron mid-debounce, the counter resets and you lose the in-progress debounce cycle. Log entries are the authoritative record for debugging debounce state.

- ⚠️ `offline_since_<peer>` state files are only created on the first offline detection after the fix — if the peer never actually went offline since deployment, these files won't exist yet. Their absence is not a bug.

- ⚠️ `message delete` in OpenClaw may fail silently with "Unknown Message" — test notifications sent to Discord cannot always be retracted. Keep test runs short and verify the fix works on run 2 of the debounce before sending a live Discord notification.

- ⚠️ Two machines running the same failover detector script but with different model or cron configurations may have stale state files from past runs — always check both `last_status_ally` and `last_status_bliss` on each machine to reconstruct the true cross-machine state before diagnosing.

## Activation condition

Promote to status: active when the skill has been recalled (via skill-auto-suggest or direct invocation) ≥3 times in a rolling 7-day window with no quality regression or user override.

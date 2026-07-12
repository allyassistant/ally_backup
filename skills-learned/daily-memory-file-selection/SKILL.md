---
name: daily-memory-file-selection
description: "Select the largest valid memory file by size when newest-by-mtime would be a stale stub, with tail-append fallback for partial flushes. Use when: memory flush picks the newest file, mtime would select a stub, partial flush needs tail-append. Key capabilities: size-based selection, mtime fallback, partial-flush recovery."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-23T19:01:01.294Z
---

## Workflow

1. **Identify candidate files** — Run `ls -lS <dir>/*.json | head -20` to list files sorted by size DESC, capturing mtime, name, and byte count in one pass.

2. **Apply size-gated stub filter** — Skip any file ≤ 200 bytes as a stub (heartbeat pings, empty ack files). Only files > 200 bytes pass the filter. Example: `95b` stubs from `22:03` or `16:03` timestamps should be skipped automatically.

3. **Select by size DESC, not mtime** — From the filtered set, pick the largest file. The biggest by bytes is more likely to contain full output than the newest by mtime, which may be a fresh stub write.

4. **Append tail fallback when largest is < 6KB** — If the chosen file is smaller than 6 KB and a second file exists in the candidate set, append the last 100 lines of the second-largest file using `tail -n 100 <second_file> >> <chosen_file>` to reconstruct a full record.

5. **Verify total size before processing** — After appending, confirm combined output exceeds 6 KB. If still too small, log a warning and skip processing rather than feeding a truncated stub to downstream analysis.

6. **Test with stub injection** — Simulate a stub scenario by creating a `echo '{}' > stub.json` (95 bytes) and verifying the selector skips it and picks the real output file.

## Pitfalls

- ⚠️ Selecting by mtime alone — Newest file by mtime is often a fresh stub write (95 bytes) that contains no data; sorting by size DESC prevents picking empty or near-empty artifacts.
- ⚠️ Missing the size threshold — Without the 200-byte gate, heartbeat pings and empty ACK files pass through and get selected as the "newest" record, corrupting downstream analysis.
- ⚠️ Single-file-only assumption — Scripts that read only `files[0]` after sorting by mtime will fail when the newest entry is a stub; always apply size filter before indexing.
- ⚠️ No append fallback — When the biggest valid file is < 6 KB (e.g., a partial flush), downstream processing receives incomplete data; append logic recovers the missing tail from the second file.
- ⚠️ Hardcoded path assumptions — If the cron output directory changes (e.g., different date partition), the selector fails silently; use glob patterns or config-driven directory resolution.

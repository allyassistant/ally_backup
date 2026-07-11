---
name: subagent-investigation-orchestration
description: Verify a system claim by having a sub-agent cross-check source code and memory.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T03:01:00.000Z
---

## Workflow

1. **Pre-gather context** — Before spawning, read the relevant source files and memory files with `exec` / `read` to build a compressed context brief. Do NOT send raw conversation history to the sub-agent; extract only the relevant facts, file paths, and known SDK contracts.

2. **Spawn M3 sub-agent** — Call `sessions_spawn` with a structured brief: target files, specific claims to verify, SDK contracts to check against. Pass the compressed context inline in the brief, not as attachments.

3. **Fact-check findings before delegation** — When M3 returns findings (especially bug reports or architectural claims), verify against the actual SDK source before creating issues or delegating fixes:
   - Read the SDK type definitions (`/opt/homebrew/lib/node_modules/openclaw/dist/types-*.d.ts`) to confirm field contracts.
   - Read the actual function implementations to confirm behavior.
   - If a finding is a false positive, discard it; do not create issues for it.
   - If verified, proceed to step 4.

4. **Delegate remediation** — For verified findings, create follow-up issues with the specific file:line citations from the fact-check. Use `exec` to call the issue creation API with structured payloads (title, body, labels).

5. **Present to user** — Summarize the verified findings in Cantonese with file:line citations. Send the summary to the relevant Discord channel via `message action=send`, then `NO_REPLY` to avoid duplicate output in the main session.

## Pitfalls

- ⚠️ Trusting M3 findings without verification — M3 can hallucinate SDK field names or misrepresent contract requirements. Always read the actual `.d.ts` or source before acting on bug reports.
- ⚠️ Sending raw conversation history to sub-agent — this exceeds token budgets and dilutes signal. Pre-gather and compress context before spawning.
- ⚠️ Creating issues for unverified findings — noise in the issue tracker that wastes future attention. Fact-check gate (step 3) is non-negotiable.
- ⚠️ Missing `sessionKey` in `api.runtime.subagent.run()` — the SDK requires `sessionKey: string` and `message: string` as `SubagentRunParams` fields. Passing `task` or `mode` is wrong. Verify the contract before trusting any spawn-related claims.
- ⚠️ Confusing model format — model identifiers are separate `provider` and `model` fields (e.g., `provider: minimax-portal, model: MiniMax-M3`), not a colon-joined string like `minimax-portal/MiniMax-M3`. M3 may generate the wrong format.
- ⚠️ `applyPatchSchema` only has `input` field — the schema does not include `path` or `file_path`. Any finding that assumes these fields is wrong.


## Absorbed from `subagent-fix-orchestration` (2026-06-20)

> **Provenance:** score=?, verdict=MERGE, merged via `scripts/merge_skills.js`
> **Original location:** `subagent-fix-orchestration/SKILL.md` (now in `_archive/merged-2026-06-20/subagent-fix-orchestration/`)

## Workflow

1. **Identify fixes with priorities**
   - 從上遊分析或 investigation session 取得完整 fix list
   - 每個 fix 標注優先級（P1/P2/P3）和預計實現時間
   - 確認 fix 之間是否有依賴關係

2. **Discover target script**
   - 用 `grep -r` 或 `find` 定位目標腳本
   - 優先搜索 workspace/scripts/ 目錄
   - 如果有多個候選，用 `read` 確認正確的目標
   - 記錄找到的路徑，供下一步使用

3. **Spawn M3 sub-agent with fix list**
   - 調用 `sessions_spawn` 啟動 M3 sub-agent
   - 在 spawn prompt 中清晰說明：
     - 目標腳本路徑
     - 完整 fix list（每項含優先級和描述）
     - 實現約束和預期行為
   - 附帶相關文件 context（read 目標腳本後傳遞）

4. **Yield and poll for completion**
   - 立即調用 `sessions_yield` 讓出控制權
   - 用 `process` 工具 poll sub-agent session
   - 設置合理 timeout（通常 120 秒）
   - 檢查 poll 結果，確認所有 fix 已實現

## Pitfalls

- ⚠️ **File discovery needs multiple attempts** — grep/find 可能第一次找不到正確腳本，需要調整 search term 或範圍。解決：用多個並行的 grep strategy 而不是單一嘗試

- ⚠️ **Spawn without explicit context causes fix/file mismatch** — sub-agent 可能搞混邊個 fix 應用於邊個文件。解決：在 spawn prompt 中明確列出每個 fix 對應的目標文件

- ⚠️ **Blind yield without poll timeout hangs session** — 如果 sub-agent 失敗或卡住，blind yield 會令 session 永遠等待。解決：總是在 poll 時指定 timeout，並實作 failure recovery 邏輯

- ⚠️ **Fix list without priority ordering leads to wrong sequence** — sub-agent 可能按錯誤順序實現 fix。解決：在 fix list 中明確標注優先級，用結構化格式（P1/P2/P3 + 描述）呈現

- ⚠️ **No file context provided at spawn time** — sub-agent 需要在實現前讀取目標文件。解決：在 spawn 前先 read 目標腳本，將關鍵內容傳遞給 sub-agent

## References

- `skills-learned/context-gather-subagent-orchestrate/` — 預先 gathered context 再 spawn M3 sub-agent 嘅標準模式
- `skills-learned/parallel-subagent-implementation/` — 多軌並行 sub-agent spawning（適用於多個獨立的 fix track）
- `skills-learned/subagent-m3-reliability/` — M3 sub-agent failure 診斷和恢復（包括 output token limit、API overload、partial completion）
- `skills-learned/subagent-context-overflow-recovery/` — 當 sub-agent 大型任務觸發 context overflow 時嘅範圍收窄策略


## Absorbed from `parallel-subagent-implementation` (2026-06-28)

> **Provenance:** M3 audit 2026-06-28, adoption=17.5% overlap with master, verdict=MERGE, source archived to `_archive/merged-2026-06-28/parallel-subagent-implementation/`
> **Reason for merge:** Source covers parallel multi-agent execution pattern (2–3 independent slices for concurrent angle analysis); complements master's Spawn step (step 2) when investigation needs multiple aspects resolved in parallel before fact-check.

## Workflow

1. **Decompose task into independent slices** — Identify 2–3 non-overlapping aspects that can be analyzed in parallel. E.g., for code migration: one agent does surgery, another does real bug fixes. For feature design: one agent does feasibility, another does concrete design.

2. **Spawn each M3 sub-agent with tight scope** — Use `sessions_spawn` for each agent. Pass compressed context (key files only), explicit line bounds (e.g., `index.mjs:367-460`), and a concrete deliverable specification. Include the exact file path, line range, and what constitutes success.

   ```javascript
   // Pattern for each spawn
   await sessions_spawn({
     agent_id: `m3-${AGENT_NAME}`,
     task: `You are a Node.js engineer. Task: ${SCOPE}. File: ${FILE_PATH}. Lines: ${LINE_RANGE}. Criteria: ${SUCCESS_CRITERIA}.`
   });
   ```

3. **Yield for parallel completion** — After all spawns, enter a yield/poll loop. Use `sessions_yield()` to wait for sub-agent results. Do NOT busy-poll — yield once per agent round-trip. For 2 agents, expect ~2–3 yields total before both complete.

4. **Read results from each sub-agent** — When `sessions_yield` returns a result, read the output directly or via `sessions_result`. Each agent produces a structured report with per-file changes, test results, and status.

5. **Synthesize into unified response** — Combine results from all agents:
   - Per-file change summary from each agent
   - Any conflicts or overlaps between agents' changes
   - Overall pass/fail status and next steps
   - Determine if re-spawn is needed for partial completion

6. **Verify with smoke tests** — Run the project's test suite (`npm test` or equivalent) after both agents have completed. If any agent failed, re-spawn with adjusted scope before verification.

## Pitfalls

- ⚠️ Token Plan budget exhaustion from parallel agents — 3 parallel M3 agents can burn through 60%+ of a Token Plan quota in one burst, leaving none for subsequent conversation turns. Distribute quota across agents by reducing max_tokens per agent or spawning sequentially for large tasks.
- ⚠️ File contention when two agents target the SAME file — If agent A surgery and agent B bug fix both touch `index.mjs`, their changes can conflict. Always partition work by file or by clear line bounds to avoid merge conflicts.
- ⚠️ yield/poll deadlock if one agent stalls — A single long-running agent can block the entire yield loop. Set a reasonable timeout on each spawn and monitor progress. If one agent exceeds expected runtime, re-spawn it with a reduced scope rather than waiting indefinitely.
- ⚠️ Context overflow from concatenating 3 agent reports — Each M3 agent's final report can be 3–8KB. Combining 3 reports plus the main session context can exceed 32K tokens. Compress or summarize each report before inclusion in the final response.
- ⚠️ Results arriving out of order — Agents complete at different speeds; the faster agent's results are read first. Do not assume completion order — always check result status and completeness, not just arrival order.


## Absorbed from `subagent-m3-task-chunking` (2026-06-28)

> **Provenance:** M3 audit 2026-06-28, verdict=MERGE, source archived to `_archive/merged-2026-06-28/subagent-m3-task-chunking/`
> **Reason for merge:** Source covers reliability chunking (3–5 sub-tasks to avoid provider overload); the "verify output independently" step (chunking step 5) directly extends master's step 3 fact-check gate with stronger independent-verification pattern.

## Workflow

1. **Assess task complexity** — count distinct files, decision points, and estimated tool calls. If the task exceeds ~200 tool calls or 10 minutes of estimated runtime, trigger chunking.

2. **Decompose into 3–5 focused units** — split by file boundary, concern area, or phase. Each sub-task must be independently verifiable without cross-subtask state. Avoid interdependent sub-tasks that require sequential execution.

3. **Spawn sub-agents in parallel** via `sessions_spawn` — use the same model tier (M3) for all chunks unless a chunk is trivially scoped (then M2.7 is acceptable). Pass each sub-agent a compressed, self-contained context block.

4. **Wait for completion** — monitor each sub-agent's yield/poll cycle independently. Track which chunks complete vs. stall or timeout.

5. **Verify output independently** (critical step, extends master's step 3) — do NOT trust sub-agent completion reports at face value. Before presenting results to the user, the main session must spot-check the actual system state:
   - For file edits: `read` the modified files directly
   - For cron changes: run `cron get` or `cron list` to confirm payload updates
   - For config changes: verify the targeted config files contain the expected values
   Report only what you have independently confirmed.

6. **Merge and synthesize** — collect verified outputs from all sub-agents into a unified result. Flag any sub-agent that failed or produced unverifiable output.

## Pitfalls

- ⚠️ Spawning sub-agents with interdependent chunks — Chunk A must read Chunk B's output before proceeding, creating a sequential bottleneck that defeats parallelization. Always design chunks to be independently executable.

- ⚠️ M3 sub-agents report success optimistically — A sub-agent may report completion while actual system state remains unchanged (e.g., file write silently failed, cron payload not updated). Always run independent spot-checks before claiming success to the user.

- ⚠️ Sending too much context to each sub-agent — Over-compressed or over-bloated context causes token overflow or degraded output quality. Pre-gather only the minimum files each chunk needs before spawning.

- ⚠️ No timeout per chunk — If individual sub-agents lack a timeout, a stalled chunk can block the entire pipeline. Set a reasonable per-chunk timeout and fail fast if exceeded.

- ⚠️ Assuming all chunks succeeded because most did — A 4-of-5 success rate still means one chunk silently failed. Always enumerate each chunk's status individually before synthesizing.

## Edge Cases

- **All chunks fail**: Fall back to running the task in the main session, or chunk more aggressively (2–3 sub-tasks of smaller scope).

- **Sub-agent yields with partial output**: Read the partial output, reconstruct meaning, and report what was verified. Do not fabricate completion.

- **Token overflow during spawn**: Apply adaptive thinking fallback (reduce context scope) before respawning. Never blindly retry with the same context budget.

- **User explicitly wants single-sub-agent**: Respect the explicit instruction. Chunking is a reliability optimization, not a hard requirement.

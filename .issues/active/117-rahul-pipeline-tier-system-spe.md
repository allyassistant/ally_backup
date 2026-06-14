# Issue #117 — Rahul Pipeline: 完善 Tier System + Spec Consistency Check Automation

## 目的

Rahul Pipeline（Spec-first → Consistency Check → Code → Validator → Fix）已經證實可行，但目前全靠 Ally 主動記憶同執行。需要一個 classifier / helper script 輔助 classify tier，同埋確保 Spec Consistency Check 唔會漏。

## 背景資料

2026-05-27 完成咗 Rahul Pipeline 嘅 deep test：

- Test target：`validateConfig()` 加到 config loader，包含 8 條 Cannot Do traps
- Validator impartial 成功 detect P0 gap（error 被 try/catch 吞咗）
- 但 Cannot Do trap #2 被 violate — root cause 係 spec 有 conflicting constraints（「唔改 error handling」 vs「error 要 propagate」）
- M2.7 independent analysis 指出應該喺 spec review phase 就 catch 呢個 contradiction

結果後嘅改進（已 deploy）：
1. **AGENTS.md** — 加咗 Spec Consistency Check step + Pipeline Tier System（🟢 Express / 🟡 Standard / 🔶 Pipeline / 🔴 Full+Human）
2. **`.spawn/validator.template`** — 加咗 Security Surface Check + Architecture Drift Check
3. **`.spawn/spec_writer.template`** — 加咗「Constraints I'm Uncertain About」section
4. **`.spawn/code_fix.template`** — 加咗「conflicting constraints → stop and ask」規則

Now the pipeline is documented but **manual**. No automation enforces it.

## 技術分析

### 選項 A：Classifier Script（輕量）

Create a helper script that takes a task description and returns a recommended tier:

```bash
node scripts/pipeline_classifier.js "Add validateConfig to config_loader.js"
# Output: 🔶 Pipeline (reason: non-obvious logic, shared module)
```

**Pro：** 唔使改 OpenClaw config，唔使等 hook fix
**Con：** Ally 要記得自己 call，唔會 auto-stop

### 選項 B：Spawn Guard Wrapper

Create a wrapper that intercepts code spawns:

```bash
node scripts/spawn_guard.js --task "add validateConfig" --files "config_loader.js"
# Prompts Ally: "🟡 Standard or 🔶 Pipeline?"
# Then adds Cannot Do + template to the spawn prompt automatically
```

**Pro：** 確保 Cannot Do + 正確 template 自動加落 spawn prompt
**Con：** Overhead for simple fixes

### 選項 C：Hybrid（推薦）

- Classifier script for reference
- Spawn prompt 自動注入 Cannot Do + ACs + scope block
- Ally still makes final call on tier

### ️ Scope Block 自動注入

另外值得考慮嘅係：每次 spawn code task 時自動加呢個 block 落 prompt：

```markdown
📋 Scope
─────────────
✅ In scope: [TBD]
❌ Out of scope: [TBD]
🛑 Abort if: [TBD]
```

### 可學習嘅教訓

從 deep test 學到：
- **Valid contradictions** need human judgment — even the best auto-checker can't resolve "don't change error handling" vs "errors must propagate" without context
- **Tier should be dynamic** — a fix that starts as 🟢 Express might escalate to 🔴 Full+Human if it reveals unexpected complexity during spec writing
- **Validator impartial is narrow but deep** — it checks spec compliance well, but can't catch business logic errors even with the new security/arch checklist

## 實作步驟

### Phase 1：Classifier Script（估 2-3 小時）
- [ ] Create `scripts/pipeline_classifier.js` — regex-based tier classifier
- [ ] Input: task description + file paths + change type
- [ ] Output: recommended tier + reason + risk flags
- [ ] Options: `--dry-run` (show recommendation) / `--prompt` (output template block)

### Phase 2：Spawn Guard（估 3-4 小時）
- [ ] Create `scripts/spawn_guard.js` — wrapper that:
  - [ ] Reads pipeline_classifier recommendation
  - [ ] Prompts Ally to confirm tier
  - [ ] Auto-injects Cannot Do block + ACs + scope block into spawn prompt
  - [ ] Catches common mistakes (e.g. 🟢 tier for >3 files)
- [ ] Print the full spawn-ready prompt to stdout

### Phase 3：Integration（估 1-2 小時）
- [ ] Update Tool Decision Tree to reference spawn_guard
- [ ] Test with 3-5 varied tasks
- [ ] Log any misclassifications for tuning

## 結論

Recommended: **Phase 1 + 2**（classifier + spawn guard wrapper）
Not worth: full automation via OpenClaw hooks（OpenClaw lacks pre-message hooks, would need workaround）

Decision pending: Josh to confirm Phase 1 scope / priority.

## Links
- AGENTS.md → Tool Decision Tree step 5 + Human Checkpoints section
- `.spawn/spec_writer.template` — 加咗「Constraints I'm Uncertain About」
- `.spawn/validator.template` — 加咗 Security Surface + Architecture Drift Check
- `.spawn/code_fix.template` — 加咗 conflicting constraints stop rule
- AGENTS.md → Pipeline Tier System section
- memory/2026-05-27 — Full pipeline deep test discussion

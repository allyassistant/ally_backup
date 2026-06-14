# Plugin-level Skill Auto-Inject vs Path F (AGENTS.md + Manual Query)
*Sub-agent M3 deep analysis | 2026-06-14 05:22 HKT | For: Discord #🧑🏻‍💻編程*

> **Subagent task：** 評估 Josh 嘅新 proposition — 用 plugin-level auto-inject（類似 route-enforcer）取代 AGENTS.md + 手動 catalog query。同 #143 skill-matcher plugin rollout 嘅 read-only 失敗經驗對比，畀最終 recommendation。

---

## 0. 確認理解 Josh 嘅 Proposition

**Josh 嘅問題（paraphrased）：**
> 「如果唔靠 AGENTS.md 提醒自己去 query catalog，而係用同 Smart Router Plugin 一樣嘅 mechanism — 喺 **before model 開工之前**，由 plugin 層自動幫你 check 有冇啱用嘅 skill — 會唔會更好？」

**即係：** `route-enforcer` 用 `before_prompt_build` hook inject routing label 入 system prompt。如果同樣 mechanism，另一個 plugin 喺 `before_prompt_build` 入面自動 query skill catalog → inject 相關 skill details → 咁 agent 根本唔使靠自己「記住去查」。

**核心假設：** 由 plugin 自動做 recall 比由 LLM 自己 recall 更 deterministic、更可靠。

---

## 1. 關鍵數據發現（重要！改變分析前提）

> 以下 4 個 facts 直接影響 verdict，先列出嚟。

### Fact A：skill-learner plugin **已經** inject 完整 skill catalog 入 every prompt

`~/.openclaw/extensions/skill-learner/index.mjs:228`：
```js
api.on("before_prompt_build", async () => {
  const categories = buildCategorizedSkills();  // 由 skills/ + skills-learned/
  if (Object.keys(categories).length === 0) return;
  const block = renderCategorizedSkills(categories);
  return { prependSystemContext: block };  // <categorized_skills>...</categorized_skills>
}, { priority: 5 });
```

**現時每個 message 嘅 system prompt 已經包含** `<categorized_skills>` block，內有**全部 52 個 active skills 嘅名 + description**。LLM 已經睇到所有 skills，**由 LLM 自己決定用邊個**。

**呢個係「LLM 揀」vs「Plugin 揀」嘅 fundamental design 取捨 — 已經有了。** Josh 嘅 proposition 唔係「建立由 plugin 揀嘅 mechanism」，而係「**改變**設計由 plugin 揀」。

### Fact B：#143 read-only phase 嘅 metrics 數據 = 0 bytes

```
$ ls -la ~/.openclaw/workspace/.skill_matcher_metrics.jsonl
ls: .skill_matcher_metrics.jsonl: No such file or directory
```

**Read-only phase 從未產生過任何 metric entry。** 2 日後（2026-06-11）就直接 archived 0/7 progress。**完全冇 baseline data 證明 threshold 0.15 係 work 或唔 work**。

### Fact C：skill-matcher plugin 同 route-enforcer 共用 priority 10 + 同一個 hook

```
skill-matcher priority: 10
route-enforcer priority: 10
skill-learner priority: 5
```

**Plugin 排序衝突風險：**
- 3 個 plugins 共享 `before_prompt_build` hook
- skill-learner 先 inject <categorized_skills>（全部 52 skills）
- route-enforcer 再 inject [ROUTER: X]（短 string，6 個 values）
- 若 revive skill-matcher：會 inject <skill_suggestions>（sub-set）

**每個 plugin 都 `prependSystemContext`** = 3 層 stack。**冇人驗證過疊加之後嘅 token cost**。

### Fact D：#143 plugin directory 已被刪除，但冇 issue 記錄點解

- Issue #143 status = archive
- `~/.openclaw/extensions/skill-matcher/` 不存在
- `~/.openclaw/openclaw.json` 冇 `skill-matcher` entry
- 最後 memory entry 關 skill-matcher = 2026-06-09 deploy + 2026-06-11 archive
- **冇任何「點解 archive」嘅 explicit decision record**

可能原因：plugin auto-archived by system？手動清？冇追到。**呢個係 dead artifact 嘅高風險訊號**。

---

## 2. Q1-Q5 系統性分析

### Q1：Plugin-level auto-inject 係咪好過 AGENTS.md + manual catalog query？

**Short answer：** **未必好，可能更差。**

| 維度 | Plugin auto-inject (Josh) | AGENTS.md + manual (Path F) |
|------|--------------------------|----------------------------|
| **Determinism** | ✅ 100% — 一定 inject | ❌ LLM 唔記得就冇 |
| **Token cost** | ❌ 每 turn 都加 context（3-8KB / hook） | ✅ 只 LLM 查詢時先 load |
| **Latency** | 🟡 Hook overhead（5-30ms per turn） | ✅ 零（LLM 決定） |
| **False positive cost** | 🔴 高 — LLM 被引導去用錯 skill | 🟢 低 — LLM 自己忽略唔啱嘅 |
| **False negative cost** | 🟡 Threshold 設高就 miss | 🟢 LLM 識得自己 browse 全部 |
| **Tunability** | 🟡 Config field 改 threshold（但 #136 證明 OpenClaw config schema 唔接受 custom field） | 🟢 Edit AGENTS.md text 即時 |
| **Maintenance** | 🔴 新 plugin + priority conflict + 4+ plugins 共享 hook | 🟢 Edit text，reversible |
| **Rollback** | 🔴 Disable plugin + restart gateway | 🟢 Edit text 1 行，reload 即可 |
| **Testability** | 🟡 改 config → restart → 觀察 | 🟢 Edit text → 即時 |

**關鍵：Fact A 講過 — skill-learner 已經 inject 全部 catalog。** AGENTS.md 加 trigger 句子 = LLM 識得「用之前 list 一過 skills」。Plugin auto-inject = 改變現有 design 為「plugin 揀 → LLM 跟」。

**結論：** Plugin 嘅好處只係 determinism。但 determinism 帶嚟嘅 cost（context bloat + false positive 風險）喺 skill matching 場景遠比 routing label 場景高（routing label = 6 個 discrete values，skill = 50+ 個 fuzzy 匹配）。

### Q2：#143 嘅 learnings 係咩？點解 read-only 後冇 promote？

**Lessons from #143 (with evidence)：**

| 教訓 | Evidence | 對 Josh proposition 嘅影響 |
|------|----------|-----------------------------|
| **1. Plugin 設定再完整，冇 data = 0 進展** | 0/7 progress, metrics.jsonl 唔存在 | Active injection 比 read-only 嚴重 10x（read-only 只 log，active mislead LLM）。**冇 baseline 就跳 active = 冇 guard rail** |
| **2. 共享 hook + 共用 priority = 衝突風險未驗證** | skill-matcher priority 10 = route-enforcer priority 10 | 加 active injection = 必然疊加 3 個 hook（skill-learner + route-enforcer + new），**未測試** |
| **3. Threshold 0.15 從無 data backing** | Issue #143 直接列「要等 data」但等唔到 | 冇 data → threshold 係**猜**，active injection 用猜嘅 threshold = 必然有 noise |
| **4. Disabled channels 反映 channel-specific 風險** | `#🤖一般` + `#⚙️系統` disabled | 連 read-only logging 都有 channel filter，**active injection 喺 SPAM / noise channel = 必然 false positive** |
| **5. Plugin 可以 silently 死咗冇人知** | Directory 消失、冇 decision log、冇 metrics | Revival 同樣會 silently 失敗，**冇 owner** |

**根本死因：唔係技術問題，係 process 問題。** Read-only phase 設計有 4 個 success criteria、Day 0-7 timeline — 但**從 Day 2（2026-06-11）直接 archive 冇 promote**，完全跳過 Day 4 review / Day 5-8 conservative / Day 9 final review。冇 evidence 證明 read-only criteria 通過或失敗，**只是被其他 priority 蓋過（systemEvent 修複 / route-enforcer bug / npm update）**。

### Q3：Plugin-level auto-inject vs Path F (catalog indexer + agent query) — 邊個更好？

**Trade-off Matrix（決定性 factors）：**

| 因素 | Plugin auto-inject | Path F (catalog indexer + agent query) |
|------|--------------------|----------------------------------------|
| **設計哲學** | Plugin = gatekeeper, LLM 跟 | LLM = decision-maker, plugin = librarian |
| **同現有架構嘅相容性** | ❌ 推翻 skill-learner 嘅「inject all + LLM 揀」 | ✅ 加強 skill-learner（用佢嘅 data）+ 加 AGENTS.md trigger |
| **Token 成本** | 🔴 3-8KB per turn（× 200 turns/day = 1.5MB/day context） | 🟢 只喺 LLM 查詢時 load (~50-200 chars) |
| **Threshold tuning 嘅 feedback loop** | 🔴 需要 production data → 冇 data → 靠估 | 🟢 AGENTS.md 文字改完即時見效 |
| **#143 嘅失敗可移植？** | 🔴 0/7 失敗直接 carrier over | ✅ 唔同 architecture，唔同 surface |
| **可逆性** | 🔴 Disable plugin + restart | 🟢 Revert text edit 1 行 |
| **Skill curation 嘅 incentive** | 🟡 Plugin 屏蔽低質 → 反而**冇 incentive 改善 curation** | 🟢 LLM 見到全部 → 逼 curation 變好 |
| **可解釋性** | 🟡 「plugin 揀咗呢個」= 黑盒 | 🟢 LLM 自己解釋點解用 |
| **Complexity** | 🔴 +1 plugin、+1 hook 衝突、+1 metrics cron、+1 disabled-channels config | 🟢 +20 行 AGENTS.md text |

**結論：係 competitive 但 Path F 全面優勝。** Plugin 唯一 win 係 determinism，但喺 skill matching 嘅 noisy domain，determinism 反而係 liability。

**佢哋係 competitive，定 complementary？** 技術上可以兩者並存（plugin 做 candidate filter → LLM 做 final pick），但**咁只係增加 complexity 冇增加 value**。Path F 嘅「agent 自己 query」已經包含 LLM 嘅 filtering logic。

### Q4：如果揀 plugin route，應該 revive #143 / extend route-enforcer / 開新？

| 方案 | Effort | Risk | Verdict |
|------|--------|------|---------|
| **A. Revive #143 skill-matcher** | 中（重寫 v2.0 + 修所有 known issues + 重做 read-only phase） | 🔴 高（#143 從 Day 0 到 archive 冇 data 證明 threshold works） | ❌ 唔建議。Revival 唔解決「冇 data」嘅根本問題 |
| **B. Extend route-enforcer 加 skill matching** | 中（+ 1 hook function + config schema 限制） | 🔴 高（#136 證明 route-enforcer config schema 唔接受 custom field，#139 證明 hook 易有 conflict） | ❌ 唔建議。Single responsibility violation，route-enforcer 已經做緊 model override + routing label，加 skill = 過度複雜 |
| **C. 開新 plugin from scratch** | 高（從 0 寫 + read-only phase 重做） | 🟡 中（可避 #143 嘅 bugs，但同樣有「冇 data」問題） | 🟡 可行但冇強烈理由。Anthropic 嘅 `disable-model-invocation: true`（#161 Phase 1）仲未做，**嗰個先係 source-of-truth 問題** |
| **D. Extend skill-learner** | 低（skill-learner 已經 inject catalog，加 matching logic 就得） | 🟢 低（共用現有 data） | 🟡 可行但有架構問題（skill-learner 嘅 purpose 係「queue writer」+「inject all」，加 matching = 改 purpose） |

**我的 verdict：** **D 最可行但需要小心 design**，否則落到 #143 同一個 trap。**A/B/C 都唔建議**。

**但更重要嘅問題：喺解決「plugin 揀 skill」之前，應該先解決「點解 LLM 揀唔到」：**
- 52 skills = LLM 揀錯嘅機率本來就高
- 7.14% junk-in-prod 反映 curation 有問題
- Anthropic `disable-model-invocation: true`（#161）先係 root solution

### Q5：同現有 active issues 嘅關係（#136, #139, #158）

| Issue | 對 Plugin proposition 嘅影響 |
|-------|------------------------------|
| **#136 Smart Router Fallback 抑制** | ✅ **直接 evidence：** OpenClaw config schema 嚴格（`additionalProperties: false`），**plugin config 唔可能加新 field**。要加 skill matching config 要走 env var 或 JS patch，**唔 standard 唔 maintainable** |
| **#139 Route-Enforcer sessions_spawn override Bug** | ✅ **直接 evidence：** Route-enforcer 嘅 `before_model_resolve` hook 曾經 hijack explicit `model=` param，因為冇檢查 explicit set。**Plugin hook 易 silent fail 影響用戶 explicit choices** — skill injection 嘅同類風險更高（用戶冇辦法 disable 個別 skill inject） |
| **#158 Skill Reviewer vs Anthropic** | ✅ **直接 evidence：** Anthropic 用「人 review」做 quality boundary，**用 LLM 取代人 = self-reinforcing risk**。Plugin injection = 將「LLM 揀」變「plugin 揀」= **同樣 quality boundary 問題**，只係換咗個 source |
| **#161 FakeMaidenMaker 改進 Phase 1** | ✅ **同步性：** 呢個 issue 嘅 Phase 1 已經包括「Activation control: `disable-model-invocation: true`」— 呢個係 Anthropic 官方嘅 skill 設計 pattern，**比 plugin matching 更標準、更可逆、更 source-of-truth** |

**結論：3 個 active issues 都 support 「唔好做 plugin auto-inject，做 AGENTS.md / frontmatter 改進」。**

---

## 3. Devil's Advocate（反方論點）

> 以下 4 點刻意攻擊我嘅 anti-plugin 立場，要 Josh 自行衡量。

### 反 1：Context bloat 唔係真問題

**反駁：** skill-learner 已經 inject 完整 catalog（~6KB），50+ skills descriptions 每個 ~100 chars。Plugin 改為 inject sub-set（top 3-5 個 matching skills）= **token cost 反而下降 5-10x**。

**回應：** ✅ 呢點 valid。Context bloat 嘅 worry 假設 inject 全部，但 plugin matching 嘅 point 就係 inject 少啲。**但：**
1. Token cost 下降假設 matching accuracy 高。Threshold 0.15（#143）= 50% 機會 inject 多過 1 個 false positive
2. False positive 嘅 cost 唔止 token — **LLM 跟住用錯 skill = 錯嘅 output**
3. Token cost 下降 vs false positive cost 上升 = trade-off 唔明顯

### 反 2：False positive cost 唔一定高

**反駁：** AGENTS.md + manual 都會有 false positive — LLM 揀咗個**唔啱嘅** skill 用。Plugin auto-inject 嘅 false positive = LLM 用咗 plugin 推薦嘅錯 skill。Manual 嘅 false positive = LLM 自己從 50 個揀錯。**前者更 bounded（top 3 candidate），後者完全 unbounded**。

**回應：** ✅ 呢點 partially valid。**但：**
- Plugin inject 嘅 candidate set = LLM 嘅 **anchoring bias**。LLM 會偏向用 plugin 推薦嘅（System 1 心理學），manual 模式反而有 exploration
- 「Plugin 揀得啱」假設 plugin 嘅 matching algorithm 做得比 LLM 好。**但 LLM 自己就係 best semantic matcher**，用 keyword / embedding / simple heuristic = 必然差過 LLM 理解 context

### 反 3：#143 嘅 silent death 唔代表方向錯，可能只係 effort 不夠

**反駁：** #143 死於冇 data = 0/7 progress。**可能只係冇人 commit 跟進**，唔係方向錯。技術設計（read-only phase + threshold + metrics）合理。**Revive + commit 跟 7 日 = 可能 work。**

**回應：** 🟡 呢點 partially valid。**但：**
- Read-only phase 7 日 → 失敗 → archive。同一個環境再行 7 日 = 預期 outcome 一致
- 真正問題唔係 read-only 失敗，係**冇 promote 嘅 commitment**。Revive 都係同樣 commitment problem
- 而且 active injection（Josh 想要嘅）= 失敗 cost 10x higher。**先要 7 日 active = 高風險**

### 反 4：Path F 假設 LLM 識得自己查 — 呢個假設可能錯

**反駁：** 「LLM 自己 browse catalog」假設 LLM 識得、記得、會主動查。實際：52 skills descriptions = 6KB，LLM 可能 skip。**Plugin auto-inject 反而保證 LLM 一定見到 candidate**。

**回應：** ✅ 呢點 valid。**但：**
- skill-learner 已經 inject 全部 → LLM 「一定見到」係 guaranteed
- 真正問題唔係「見唔到」，係「揀唔到」。Solution 唔係 plugin 預選，係
  - **更好嘅 curation**（#161 Phase 1 + Phase 2 嘅 allowed-tools + progressive disclosure）
  - **更好嘅 descriptions**（#161 Phase 1 嘅三段公式）
  - **更少嘅 skills**（junk rate 7-15% → 應該 quarantine junk）
- 即係 #158 嘅結論：**Quality > Quantity，源頭 curation 比 recall mechanism 更重要**

---

## 4. Final Recommendation

### 🟢 Recommendation：**Path F + Anthropic frontmatter（HYBRID）**

**結構：**
1. **AGENTS.md** — 加 1 段「Skill Recall Trigger」（~10 行）
   - 講明：見到 categorized_skills block → 必須先 scan → 用「[做咩] + [幾時用]」pattern 揀 → 唔啱就 ignore
   - 補：明確「點樣評估 skill fit」decision tree
2. **#161 Phase 1** — `disable-model-invocation: true` frontmatter（Anthropic 官方 pattern）
   - Default = model 自動 invoke
   - Override = Josh explicit call
   - 解決「太多 skill 同時 trigger」問題
3. **#161 Phase 1** — 三段 description 公式重寫（[做咩] + [幾時用] + [關鍵能力]）
   - 改善 LLM 自己 recall 嘅 precision
4. **保留 skill-learner 嘅 `<categorized_skills>` block**（事實上佢就係 Path F 嘅「indexer」）
5. **❌ 不做 plugin auto-inject**

### Rationale

| 點 | Plugin auto-inject | Path F + Anthropic |
|----|--------------------|--------------------|
| **Determinism** | ✅ | 🟡（依賴 LLM 跟 AGENTS.md） |
| **Token cost** | 🔴 | 🟢 |
| **Reversibility** | 🔴 | ✅ |
| **Curation incentive** | ❌ 屏蔽問題 | ✅ 強迫源頭改善 |
| **Source of truth** | ❌ Plugin 邏輯（多個 truth） | ✅ Anthropic 標準 frontmatter |
| **Complexity** | 🔴 +1 plugin | 🟢 +AGENTS.md text + frontmatter |
| **跟 #161 同步** | ❌ 唔相關 | ✅ 直接 reuse #161 Phase 1 output |
| **#143 教訓 reuse** | ⚠️ 風險 carrier over | ✅ 唔同 architecture |
| **#136 教訓 reuse** | ⚠️ Schema 限制 | ✅ 完全 bypass |
| **#158 direction 一致** | ⚠️ 偏離 quality-first | ✅ Quality-first 路線一致 |

### 點解唔做 plugin

1. **Fact A — skill-learner 已經 inject catalog**。Plugin 改變現有 design 嘅 cost 唔值得
2. **Fact B — 0 data**。冇 baseline threshold = active injection 必然有 noise
3. **Fact C — Hook conflict**。+1 plugin = 4 plugins 共享 hook，token + ordering 風險
4. **Fact D — Silent death 冇 decision log**。Revival 嘅 commitment 同樣脆弱
5. **#161 已經喺度做 source-of-truth 嘅 skill quality 改善**。**Plugin injection 喺 1 個月後就會過時**（當 #161 完成，skill 質素提升、LLM recall 自然改善）

---

## 5. Rollback / Recovery Strategy

### 如果 Josh 揀 Path F（推薦）

| Stage | Action | Rollback if fail |
|-------|--------|------------------|
| **Week 1** | AGENTS.md 加 Skill Recall Trigger section（純 text edit） | Revert text 1 行，零成本 |
| **Week 1-2** | #161 Phase 1: 3 skills audit + `disable-model-invocation: true` frontmatter | Frontmatter revert 1 行 |
| **Week 2-3** | #161 Phase 1: 三段 description formula apply top-20 skills | Per-skill edit，reversible |
| **Week 3-4** | 觀察 LLM recall 改善（hit rate via post-hoc audit 10 messages/day） | Pause #161 Phase 1 已完成嘅部分 |
| **Decision Day 30** | 如果仍然唔夠 → 再考慮 plugin route（不過我哋會有 4 週嘅 data，比 #143 嘅 0 data 強） | N/A |

### 如果 Josh 堅持揀 plugin route（Devil's advocate 接受）

| Stage | Action | Rollback if fail |
|-------|--------|------------------|
| **Stage 0** | 開 #162 tracking issue，先寫 design doc，唔郁 code | Close issue 0 cost |
| **Stage 1** | 新 plugin `skill-suggester` v0.1 read-only 14 日（**double** #143 嘅 7 日，吸取教訓） | Disable plugin，restart gateway |
| **Stage 2** | Daily metrics + Discord #⚙️系統 digest + circuit breaker（任何 1-trip → rollback） | Already disabled |
| **Stage 3** | Conservative phase 7 日 — inject **top 1 candidate only**（避免 top 3 嘅 false positive） | Revert to read-only |
| **Stage 4** | Active phase 7 日 — inject top 3，aggressive threshold | Revert to conservative |
| **Decision Day 28** | 如果 hit rate ≥ 60% AND false positive ≤ 10% → keep。否則 archive | N/A |

**關鍵安全機制：**
- **永遠 stage 0 = write design doc first**（避免 #143 嘅 commit drift）
- **永遠 stage 1 read-only ≥ 14 日**（#143 7 日 唔夠）
- **永遠 1-trip circuit breaker**（#143 冇 safety net）
- **永遠 1 owner**（避免 silent death）

### Hard constraints（任何 route 都要守）

1. **唔好改 route-enforcer plugin**（single responsibility，#139 已經證明 hook 易 silent fail）
2. **唔好 extend skill-learner 加 matching**（佢嘅 purpose 係 queue writer，唔好 blur）
3. **所有 plugin 改動要過 .spawn/code_fix.template + verify_edit.js**（#146 嘅 P0 lessons）
4. **每次改完要 smoke test 1 個真實 message flow**（#158 嘅 LLM judge silent broken 教訓）

---

## 6. Closing Thoughts

**Josh，你嘅 proposition 嘅 direction 係合理嘅 — recall mechanism 確實係問題。** 但 solution 唔喺 plugin 層，而係喺 **content quality** 層（frontmatter + descriptions + curation）。**`disable-model-invocation: true` + 三段 description formula 比 plugin matching 更 direct、更 source-of-truth、更 Anthropic 標準。**

**最諷刺嘅 observation：** 你嘅 proposition 嘅 #143 失敗原因，**唔係技術錯，係 process + commitment 錯**。同一個組織做多次同樣嘅嘢 = 高概率同樣失敗。**先做 #161（curation），再做 plugin（如果仲需要），次序唔好倒。**

**務實 timeline：**
- 短期（1-2 週）：#161 Phase 1 description audit + activation control
- 中期（3-4 週）：觀察 LLM recall hit rate，collect data
- 長期（5-6 週）：**有 data 先再考慮 plugin route**（#143 嘅 0 data trap 唔好再踩）

**Bottom line：** Path F + Anthropic frontmatter 係低風險、高可逆、跟 #158 direction 一致嘅 solution。Plugin auto-inject 係 high risk、low reversibility、#143 failure carrier over。

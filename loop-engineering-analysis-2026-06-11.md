# Loop Engineering — Deep Analysis + 實作 Roadmap

**作者：** 🦾 Ally M3 subagent
**日期：** 2026-06-11
**觸發：** Josh 話「Spawn MiniMax M3 sub agent 分析一下呢篇文章嘅內容同方向。睇下我地可以點實作」
**對象：** 知野（@knoYee_）2026-06-10 文章 + Wiselychen 完整版 mirror
**Audit 範圍：** Ally/Bliss 系統（26 live crons + 41 active skills + L0/L1/L2 memory + SPAWN orchestration）

---

## Part 1 — 文章深度分析

### 1.1 核心 idea 拆解

知野呢篇文章嘅真正 contribution 唔係「Loop Engineering」呢個 term，而係**拆解咗 5 個唔同層次嘅 idea**，並且誠實承認邊啲係新、邊啲係 buzzword。以下係 5 個真正有 insight 嘅核心 idea：

#### 💡 Idea 1：三次遷移嘅 abstraction layer pattern

> Prompt Engineering (2023-2024) → Harness Engineering (2025-2026 初) → Loop Engineering (2026 中)

**深層 insight：** 呢三次遷移唔係「linear progression」，而係**抽象層每次向上移一級，底層反而更重要**。由「寫代碼」變成「寫 Prompt」已經係抽象化，再變成「建 Harness」就係將「約束」由 prompt 抽離做機制，再變成「設計 Loop」就係連「人按掣」都抽走。**每一次抽象化都需要更多底層 infrastructure**。

呢個 pattern 對我哋嘅意義：我哋而家喺 Harness 階段成熟緊（rule-based constraint、validator、pre-write gate、QW-1~5），未到 Loop 階段。**唔可以跳級**。要先確認 Harness 夠硬（4 層防禦、quarantine、failed-validations cleanup）先有資格建 Loop。

#### 💡 Idea 2：Boris 嘅 5+1 組件，並非全部新

| 組件 | 我哋熟悉嘅對應 | 新嘅嘢 |
|------|---------------|--------|
| **Automations** | Cron jobs、GitHub Actions | ✅ 真新：定時自動觸發，唔需要人啟動 |
| **Worktrees** | Git worktree 機制 | 升級：從單一 agent 擴展到多 agent 平行 |
| **Skills** | AGENTS.md / SOUL.md | 升級：變成可搜尋、可組合嘅 SKILL.md |
| **Connectors** | MCP 工具整合 | 基本相同 |
| **Sub-agents** | EFC verifier agent 模式 | 落地：變成具體架構角色 |
| **Memory** | 跨 session state | ✅ 真新：跨次執行嘅持久狀態 |

**真正新嘅係兩個：Automations + Memory**。其他 4 個係「舊酒新瓶」——Harness 時代已經有雛形，Boris 只係將佢哋組合成一個可以自主運作嘅系統。**呢個係文章最誠實嘅 insight**，避免讀者以為「Loop Engineering 係全新 paradigm」。

#### 💡 Idea 3：Karpathy Loop 嘅三個不可缺前提

```
1. 一個有檔案修改權限嘅 Agent
2. 一個可以客觀測量嘅 metric
3. 每次實驗有固定時間限制
```

**深層 insight：** 呢 3 個條件係「可 Loop 化」嘅必要條件，唔係充分條件。**冇 automatic metric → loop 變成空轉**。呢點對我哋至關重要——我哋而家 26 個 cron 入面，有幾多係有明確可量化 metric？大多數 cron 嘅「success」係「冇 crash」或「完成咗 scheduled task」，呢類 loose metric 係咪足夠？答案係**勉強夠**——因為我哋 loop 嘅嘢係「system health」唔係「system optimization」。

#### 💡 Idea 4：Reddit 用戶嘅「邊緣 loop」框架

```
✅ 適合 loop：收集、驗證、去重（Before / After 邊緣）
❌ 唔適合 loop：選題、觀點、敘事（核心創意決策）
```

**深層 insight：** **loop 化嘅正確位置係「harness gap」——人會懶嘅地方**。人會記得做創意決策，但會忘記 verify links、會懶得 dedupe sources。**Loop 化唔係為咗取代人，而係為咗將人從機械性任務中解放出嚟**。

呢個對我哋嘅直接意義：我哋而家嘅 Loop 應該集中在「**機械性、low-judgment、high-frequency**」嘅 tasks：
- Memory L0/L1 generation（fixed schema，純 template）
- Skill validation（clear pass/fail signal）
- Junk quarantine（clear quarantine criteria）
- Cron health triage（success/error binary）

**唔應該 loop 化嘅嘢**（而家做緊嘅）— 路由決策、prompt design、issue F/D/Q 結構判斷。

#### 💡 Idea 5：成本結構由 linear → multiplicative

```
Loop 成本 = 迭代次數 × 每次 agent call 嘅 token × 平行實例數
```

呢個 insight 對我哋具體嘅衝擊：
- Karpathy 700 次實驗 × 多個 agent 平行 → 帳單係 manual prompt 嘅 **百倍到千倍**
- 我哋而家嘅 cron loop 規模細（30 min 跑一次 skill reviewer），但**每次嘅 LLM call 已經佔成本嘅 80%**
- 如果我哋 Phase 2/3 引入「多 agent parallel exploration」，要預先想清楚 cost cap 機制

### 1.2 同 Prompt / Harness Engineering 嘅邊界

| 層次 | 人類角色 | Agent 自主性 | Failure cost | 適用 metric |
|------|----------|--------------|--------------|-------------|
| **Prompt Engineering** | 操作員（每次對話要人觸發） | 0%（被動回應） | Low（最多 1 個對話浪費） | 模糊（好/壞 output）|
| **Harness Engineering** | 約束設計師（人寫 guardrails、validator、pre-write gate） | 10-20%（agent 喺約束內自主） | Medium（quarantine / rollback） | 部分（validation pass rate）|
| **Loop Engineering** | 系統設計師（人設計 trigger + termination + cost cap） | 60-80%（agent 自己決定何時跑、跑到邊） | High（multi-iteration cost burn） | 嚴格（需 objective metric）|

**關鍵邊界：** 由 Harness 升級到 Loop 需要 3 個 conditions 全部成立：
1. ✅ 已有可自動衡量的 success metric
2. ✅ 失敗 cost 可量化同 capped
3. ✅ 底層 Harness 已有 4 層防禦

我哋而家狀態：**Harness 成熟緊，Loop 雛形已現（thin executor crons），未到完整 Loop**。

### 1.3 陷阱 / 反模式

#### 🕳️ 陷阱 1：把 cron job 重新命名做「Loop」

> Cron job 唔等於 Loop。Cron job 係「定時觸發嘅 deterministic script」，Loop 係「agent 收到 feedback 後自己決定下一步」。

**例子：** `skill_reviewer_bot.js --quiet` 雖然 30 min 跑一次，但佢入面係 LLM call → 結果存 → 下次再 call，**冇 feedback loop 喺 bot 內部**。佢其實係「**Harness + 自動 trigger**」，唔係完整嘅 Loop。**呢個係最容易踩嘅混淆**。

#### 🕳️ 陷阱 2：Comprehension Debt + Cognitive Surrender

> 「代碼出貨速度越快，工程師對自己系統嘅理解可能跟不上」— Boris Cherny

**具體案例：** 我哋今個禮拜 QW-1~5 commits 已經令 skill reviewer 系統複雜咗好多（validators + pre-write gate + self-ref filter + 4-backtick fence rule）。如果下個月再加 Phase 2 嘅 auto-skill-gap-analysis loop，**理解成本會指數上升**。**Loop 化嘅速度必須配合文檔化嘅速度**。

#### 🕳️ 陷阱 3：Loop 燒 token 喺你瞓覺時

> 「Loop 在你睡覺的時候也在跑」— Wiselychen

**具體衝擊：** 我哋而家 26 個 cron 中 25 個係 isolated sessions，佢哋每次 LLM call 用 minimax-portal / deepseek / ollama。**冇任何 cron 設咗 daily/monthly token budget**。如果將來加多幾個「exploration loop」（例：自動讀 GitHub issues → 自動 spawn fix agent），**帳單失控風險 real**。

### 1.4 真正新 vs 舊 concept 重新包裝

| Concept | 全新度 | 證據 |
|---------|--------|------|
| **Automations（定時自動觸發）** | 🟢 新 | 之前係 CI/CD 觸發，但 LLM agent 觸發 + 自己寫 logic 係新 |
| **Memory（跨次持久狀態）** | 🟢 新 | 之前有 database/files，但 **agent 自己決定 write 咩 + 何時 write** 係新 |
| **Sub-agents（verifier 角色）** | 🟡 半新 | 之前有 verifier concept（EFC 論文），Boris 落地到 Claude Code 架構係新 |
| **Worktrees（多 agent 平行）** | 🟡 半新 | Git worktree 一直有，multi-agent 平行編輯係新應用 |
| **Skills（SKILL.md）** | 🟡 半新 | AGENTS.md 一直有，可搜尋 + 自動 discover 係新 |
| **Connectors（MCP）** | 🔴 舊 | MCP 2025 年已經係 standard，唔新 |

**Critical insight：** 文章嘅真正 contribution 唔係技術創新，而係**將 6 個已有 concept 組合成一個**「Agent 可以自主運作」**嘅系統 pattern。組合出新能力（emergent behavior）係真嘅。

### 1.5 Reference 人物各係咩角色

| 人物 | 角色 | 核心 contribution | 對我哋嘅 reference value |
|------|------|------------------|------------------------|
| **Andrej Karpathy** | 研究 demo 嘅 empiricist | 用數字證明 Loop works：700 次實驗 / 11% 加速 / 2 天 | 設定 Loop 嘅 success 標準（必須有可衡量 metric） |
| **Boris Cherny** | 框架命名者 + Anthropic 嘅 product owner | 定義 5+1 組件嘅 architecture | 對應 audit 框架 — 我哋有邊啲組件 |
| **Peter Steinberger** | 落地實踐者（OpenClaw 作者） | 3M views、單日 627 commit | 證明 Loop 唔係 toy project，可以 production scale |
| **Addy Osmani** | 訪問者 / 框架整合者 | 將 Boris 嘅 insight 訪問 + 整合到更大框架 | 文章嘅 source of trustworthiness（訪問有 quality bar）|
| **Reddit 用戶** | 反對 buzzword 嘅務實派 | 提出「邊緣 loop」框架 + 反對整個工作流 loop 化 | 對我哋最重要 — 提醒「點樣 loop」同「點樣唔好 loop」 |

---

## Part 2 — 我哋系統嘅 Loop Engineering 成熟度 audit

對應 Boris 5+1 組件 + Karpathy 3 前提 + Reddit 邊緣 loop framework，逐個 audit。

### 2.1 Boris 5+1 組件 audit

| 組件 | 狀態 | 證據 (file/cron) | Gap | 改進方向 |
|------|------|------------------|-----|----------|
| **1. Automations** | ✅ **已成熟** | 26 live crons（見 `HEARTBEAT.md`），30 min Skill Reviewer loop、1 min Heartbeat、daily L0/L1 generators | Termination conditions 唔統一 | Phase 1: 為每個 cron 寫 termination conditions doc |
| **2. Worktrees** | ❌ **缺失** | 冇任何 `git worktree` 用法喺 sub-agent 流程 | Multi-agent 編輯衝突未解決 | Phase 3: 為多 agent parallel fix 設計 worktree 機制 |
| **3. Skills** | ✅ **已成熟（剛做完 QW-1~5 改進）** | 41 active learned symlinks（`skills-learned/`），QW-1~5 fixes commit `bcf253c`，QW-4 修咗 67% 嘅 fence bug | Junk rate 仲未達標（68% → 預期 ≤30%） | Phase 1: 觀察 7 日 + 落實 fallback 方案 2 + 5 |
| **4. Connectors** | 🟡 **Partial** | 有 Discord token、MCP 工具、wiki CLI；但冇統一 connector abstraction | Sub-agent 唔識用全部 connector | Phase 2: 寫 `connectors.yaml` registry + 自動 discover |
| **5. Sub-agents** | ✅ **已成熟** | `scripts/spawn_config.js` 完整（line 1-50），SPAWN → M2.7、SPAWN_QUALITY → M3，fallback chain：M3 → deepseek-v4-pro、M2.7 → deepseek-v4-flash | 缺 LLM-as-judge 模式 | Phase 2: 加 quality judge sub-agent（cheap M2.7）|
| **6. Memory** | ✅ **已成熟** | L0（200字，00:05） / L1（600字，00:35） / L2（raw，real-time）三層架構（`MEMORY.md:21-30`），cross-session handoff 用 `.cross_session_context.md` | Memory decision 仍然係 LLM 自己判斷「咩值得記」 | Phase 2: 加 memory decision 的 quality gate |

**Loop Engineering 整體成熟度評分：4/6 已成熟、1/6 partial、1/6 缺失。** 屬於「Harness 強，Loop 雛形已現，欠 critical components（worktree + connector registry）」階段。

### 2.2 Karpathy 3 前提 audit

| 前提 | 我哋狀態 | 證據 / Gap |
|------|----------|------------|
| **1. Agent 有 file modification permission** | ✅ Full | 我哋嘅 cron scripts 有 full filesystem access（cancelled 嘅 `mail_monitor.js` 除外） |
| **2. 有可客觀衡量嘅 metric** | 🟡 Partial | 有：junk rate（`.skill_junk_rate.jsonl`）、pass/fail validation、cron success/error。**缺：大多數 metric 係 binary（成功/失敗），冇 continuous quality metric** |
| **3. 每次 iteration 有固定時間限制** | ❌ 缺失 | 大多數 cron 冇 `max_runtime` cap（除咗 LLM call timeout）。**無 budget / token 限制 = 帳單失控風險** |

### 2.3 Reddit「邊緣 loop」框架對應

| 任務類型 | 應唔應該 loop 化 | 我哋而家狀態 |
|----------|------------------|--------------|
| **Skill validation / quarantine** | ✅ 應該 | 已 loop 化（QW-1~5） |
| **Memory L0/L1 generation** | ✅ 應該 | 已 loop 化（cron 00:05 / 00:35）|
| **Junk rate tracking** | ✅ 應該 | 已 loop 化（cron 23:55）|
| **Cron health triage** | ✅ 應該 | 已 loop 化（`cron-health-triage` skill）|
| **Issue F/D/Q quality review** | ❌ 唔應該 | ❌ Correct — 仍然人做（Issue Quality SOP） |
| **Loop decision（咩時候 spawn）** | ❌ 唔應該 | ✅ Correct — 仍然人做（FDQ system） |
| **Skill prompt design** | ❌ 唔應該 | 🟡 Partial — Auto-reviewer bot 30 min 跑一次，但最終 quality 仍由人 review |

### 2.4 Cross-system insight：QW-1~5 + #153 嘅 Loop 化雛形

**Insight：** 我哋已經喺無意中做緊「Lightweight Loop Engineering」：

- **Skill reviewer 30 min loop** = Karpathy Loop 嘅 degenerate case（單一 metric = junk rate、automated trigger = cron、自動 validation = validator）
- **Daily Memory Generation** = Memory 組件嘅具體實現
- **QW-1~5 commit `bcf253c`** = Harness 強化（fence rule、self-ref block、unified validator）係 Loop 化嘅 prerequisite
- **#153 ollama migration** = 為 Loop 化做 cost 準備（避免每次 LLM call 撞 deepseek timeout）

呢個 cross-system insight 嘅 value：**我哋唔係由零開始建 Loop**，而係**有策略地將已有嘅 harness 元素「loop-aware 化」**。Phase 1 roadmap 唔係「建新 infrastructure」，係「為現有 loops 加 termination conditions + cost caps」。

---

## Part 3 — 實作 Roadmap

### Phase 1（1-2 週，low risk，立即可行）

**目標：** 為現有 loop 加 termination conditions、cost budget、convergence detection，唔加新 component。

| Action | File / Cron 改動 | Effort | Impact | Risk | 驗證 |
|--------|------------------|--------|--------|------|------|
| **1.1 Loop Termination Conditions Manifest** | 新增 `docs/loop_termination_manifest.md`，列出 26 crons 各自嘅 max runtime、max iterations、convergence criteria | 4 hr | 防止 Phase 2/3 嘅 cost burn | 🟢 Low | Manifest 100% 覆蓋 + 每 cron 行一次 timeout 測試 |
| **1.2 Per-Cron Token Budget** | `skill_reviewer_bot.js` 開頭加 `MAX_TOKENS_PER_RUN = 50000` 變數，exceeded → log + early exit；3 個高頻 LLM cron（Skill Reviewer、Pattern Analysis、Knowledge Ingester）都加 | 3 hr | Cost overrun prevention | 🟢 Low | 連續 7 日 monitor cron exit log |
| **1.3 Convergence Detection for Skill Reviewer** | `skill_junk_tracker.js` 加 `convergenceCheck()` — 連續 3 日 junk rate 變化 < 1% → 自動降頻（30 min → 60 min）；變化 > 10% → 自動升頻 | 2 hr | Compute saving ~40% | 🟢 Low | 連續 14 日 A/B 對比 |
| **1.4 Self-Referential Defense 雙層** | QW-1（prompt hard block）+ QW-2（pre-write filter）已有，再加 QW-6：**server-side 攔截** `filePath.match(/_?(self|reviewer|curator|bot)_/i)` 喺 `skill_reviewer_bot.js:writeSkillFiles` | 1 hr | 0 個 self-ref skill | 🟢 Low | grep `.skill_created.jsonl` 0 hits |
| **1.5 Junk Rate Pre-Flight Warning** | 每次 skill reviewer 跑之前先 `tail -1 .skill_junk_rate.jsonl`，7d rate > 50% → 自動 log warning + 暫停 run + 通知 Josh | 2 hr | Early warning 系統 | 🟢 Low | Trigger test（mock junk rate 80%） |

**Phase 1 總 effort：** ~12 hr（一個 session 內可完成）
**Phase 1 預期 impact：** Cost ↓ 30%、junk rate ↓ 5-10%、compute ↓ 40%
**Phase 1 rollback：** 所有改動均 additive，git revert 即可

### Phase 2（1 個月，medium risk）

**目標：** 新增 3 個 new loops，全部用 Karpathy 3 前提標準先審：可衡量 metric ✓ / cost cap ✓ / harness 底層 ✓

| Action | File / Cron 改動 | Effort | Impact | Risk | 驗證 |
|--------|------------------|--------|--------|------|------|
| **2.1 Cross-Session Pattern Detector Loop** | 新 cron 02:30：讀 `.cross_session_context.md` × 7 日，找重複出現嘅 F/D/Q patterns → 自動 generate wiki page suggestion（唔直接 write，要人審） | 1 週 | 觀察力 ↑（發現 manual 睇唔到嘅 pattern）| 🟡 Medium | 第一週只 dry-run，唔 send 任何通知；第 2 週先 enable |
| **2.2 Cost Anomaly Detector Loop** | 新 cron 04:30：讀 cron execution log + token counter，detect daily cost > 7d avg × 2 嘅 outlier → alert + auto-degrade 受影響 cron（fallback model 降級）| 1 週 | Cost control ↑↑（防止帳單失控）| 🟡 Medium | 用 mock data 行 7 日，確認 anomaly detection precision ≥ 80% |
| **2.3 LLM-as-Judge Skill Quality Gate** | `skill_reviewer_bot.js` 加二次 LLM call：寫完 SKILL.md 之後用 M2.7（cheap）做 5-Whys test「If I were a future session, would I search for this?」 → 否決就 quarantine | 1 週 | Junk rate 預期再 ↓ 15% | 🟡 Medium | 7 日 A/B test 對比，計算 incremental improvement |
| **2.4 Memory Decision Quality Audit** | 新 cron 03:30：每週 audit L0/L1 generator output，detect「過度 generic 摘要」（e.g. Jaccard < 0.3 with prior 7 日 L0）| 3 日 | Memory quality ↑ | 🟡 Medium | 4 週 audit 後看 false positive rate |

**Phase 2 總 effort：** ~3 週
**Phase 2 預期 impact：** Junk rate ↓ 15-20%、cost control、memory quality、observation capability
**Phase 2 風險：** 4 個 loop 同時引入可能互相干擾 → 用 feature flag 控制 enable/disable

### Phase 3（3 個月，high risk）

**目標：** 跨系統 agent orchestration — Agent 唔單止自己 loop，仲主動 trigger 其他 agent（Sub-agent 編排嘅完全體）。

| Action | File / Cron 改動 | Effort | Impact | Risk | 驗證 |
|--------|------------------|--------|--------|------|------|
| **3.1 Multi-Agent Parallel Fix Loop** | 用 `git worktree` 為每個 P1 issue 開 isolated branch，M2.7 同時 spawn 3 個 sub-agent 各自 fix → 自動 merge conflict-resolved result | 2 週 | Issue resolution time ↓ 50% | 🔴 High（merge conflict 風險）| 先用 dummy repo 跑 50 次，success rate > 80% 先上 prod |
| **3.2 Topic Exploration Loop（Wiselychen 框架啟發）** | M3 sub-agent 自動讀 GitHub trending + 訂閱 blog + 過去 7 日 L0/L1 → 每週生成「topic opportunities」wiki page，要人 review | 3 週 | 觀察力 ↑↑ | 🔴 High（topic 重複、LLM hallucination 風險）| 第一個月 pure observation，第二個月先 enable alert |
| **3.3 Cross-Skill Synthesis Loop** | 自動 discover 多個 skills 之間嘅 pattern（例：cron-troubleshooting + cron-config-audit + cron-migration），生成 umbrella skill suggestion | 2 週 | Skill 維護成本 ↓ | 🟡 Medium | 4 週 observation，check 新 umbrella skill 引用率 > 50% |
| **3.4 HA-Aware Loop Health Monitor** | 當 Bliss 離線時，Ally 自動接管 + 自動調整 loop frequency（高頻 cron 暫停、low-priority cron skip）| 1 週 | Failover 期間 system stability ↑ | 🟡 Medium | 模擬 Bliss 離線 3 次，每次驗證 recovery time < 5 min |

**Phase 3 總 effort：** ~8 週
**Phase 3 預期 impact：** 系統從「人設計 + Agent 跑」升級到「Agent 編排 + 跨系統協作」
**Phase 3 風險管理：** 必須有 kill switch（單一 command 暫停所有 Phase 3 loops）+ 嚴格 cost cap + 7 日 shadow run 模式

### Roadmap 風險 vs 收益對比

| Phase | Effort | Impact | Risk | 何時開始 |
|-------|--------|--------|------|----------|
| Phase 1 | 12 hr | 🟢 中 | 🟢 低 | 即時（7 日內）|
| Phase 2 | 3 週 | 🟡 中-高 | 🟡 中 | QW 觀察期結束後（Jun 18 之後）|
| Phase 3 | 8 週 | 🔴 高 | 🔴 高 | 2 個月後，Phase 2 全部 PASS 後 |

---

## Part 4 — 2-3 個最容易踩嘅反模式

### 反模式 1：「Cron job 重新命名 = Loop Engineering」

**描述：** 以為將一個 `daily_report.js` 加 cron 排程就係 Loop Engineering。**Cron 係 deterministic trigger，Loop 係 agent 自主 feedback 系統**。兩者本質唔同。

**點樣 detect 已經踩咗：**
- 檢查 cron 入面有冇「agent 讀 prior output 嚟決定今次 run 嘅行為」
- 如果 cron 每次 run 嘅 output 同 input 完全 independent → 係 cron，唔係 loop
- 例子：而家 `skill_reviewer_bot.js` 雖然每 30 min 跑一次，佢讀 `.skill_review_queue.jsonl` → 決定要 review 邊啲，但 **output 唔會 influence 下一輪嘅 trigger 條件** → 佢係「**Harness + Automation**」唔係完整 Loop

**點樣 recover：**
- 將 cron 升級成真正 Loop：每次 run 嘅 output 寫返去 `state.json`，下一輪讀返 → 根據 history 動態調整（例如：junk rate 升 → 自動降 frequency）
- 或者接受「呢個 task 唔需要 loop，cron 已經夠」——**唔係所有嘢都要 loop 化**

### 反模式 2：「無限 iterations 嘅 loop 設計」

**描述：** 設計 loop 嗰陣冇 explicit termination condition，導致 loop 跑到「冇改善」都唔停。

**具體風險（我哋系統）：** Phase 2 嘅 Cross-Session Pattern Detector Loop（2.1）如果冇 termination，可能每晚都 generate 大堆 pattern suggestions，wake up 嗰陣見到 100 個 wiki page suggestions 全部要 review。

**點樣 detect 已經踩咗：**
- 任何 loop 冇明確寫 termination conditions → 預警
- 連續 N 次 iteration 冇明顯 improvement → 應該 trigger early stop
- 檢查 manifest（Phase 1.1）每個 loop 嘅 max iterations

**點樣 recover：**
- 立即加 termination condition：`max_iterations` + `convergence_threshold` + `max_runtime` 三重 cap
- 加 cost budget cap（Phase 1.2）
- 設計「dry-run mode」：loop 跑但唔 write 任何 side effect，等人 review 先 enable

### 反模式 3：「Memory Loop 變成 Memory Dump」

**描述：** 將所有 session data 都寫入 memory（L0/L1/L2），結果 memory 變成無法 navigate 嘅 data dump，無 useful signal。

**具體風險（我哋系統）：** 而家 L0/L1 generator 用 minimax M2.7，quality gate 弱。**如果 L0 全部 200 字 generic 摘要**（例：「今日處理咗 issues」），memory 就冇 value。

**點樣 detect 已經踩咗：**
- L0/L1 之間嘅 Jaccard similarity > 0.7 → 過度 generic
- L0 完全冇 actionable insight（純粹 narrative）
- Memory 引用率低（即係將來 session 唔讀返 L0/L1） → 反映 quality 差

**點樣 recover：**
- 加 Memory Decision Quality Audit（Phase 2.4）— audit generic 摘要
- L0 模板化：每個 L0 必須有「5 個 topics + 1 個 actionable insight + 1 個 cross-session pattern」
- L1 必須 connect 到至少 2 個其他 L1（cross-link）

---

## Part 5 — 1 句最終 Takeaway

> **Loop Engineering 唔係「將 cron job 重新命名」，而係「為已有 harness 元素加 feedback + termination + cost cap」——我哋嘅 Phase 1 唔使建任何新 infra，只需要為 26 個 cron 各寫一份 termination manifest，順手執 QW-1~5 之後嘅 junk rate。**

---

## 附錄 A — Source Code 引用總覽

| File | Lines | 用途 |
|------|-------|------|
| `HEARTBEAT.md` | 1-90 | 26 live crons 總覽 |
| `.issues/active/152-qw-1-5-skill-reviewer-junk-rat.md` | 1-180 | QW-1~5 觀察期追蹤 |
| `.issues/active/153-2-cron-jobs-ollama-qwen2-5-.md` | 1-100 | Ollama migration observation |
| `skill-reviewer-root-cause-analysis-2026-06-11.md` | 1-310 | 5 root causes + 8 改善方案 |
| `qw1-qw5-implementation-2026-06-11.md` | 1-180 | QW 具體代碼 + commit `bcf253c` |
| `scripts/skill_reviewer_bot.js` | 365, 376, 480+ | QW-2 self-ref filter、QW-3 unified gate |
| `scripts/skill_reviewer.js` | 303, 316, 326 | QW-5 decision tree、QW-1 hard block、QW-4 fence rule |
| `scripts/skill_junk_tracker.js` | 22-141 | 7-day rolling junk rate |
| `scripts/spawn_config.js` | 1-50 | Sub-agent model config bridge |
| `MEMORY.md` | 21-30 | L0/L1/L2 三層架構 |
| `skills-learned/cron-config-audit/SKILL.md` | 1-130 | Ollama migration pattern |
| `skills-learned/cron-troubleshooting/SKILL.md` | 1-110 | Cron failure diagnosis |

## 附錄 B — Cross-system Insights

1. **QW-1~5 + #153 + Loop Engineering 三者係一體嘅**：QW 修咗 skill review 嘅 harness 漏洞（fence、self-ref、validator），#153 將 2 個 cron 轉 ollama 解決 LLM timeout 問題（= cost 準備），呢兩者都係 Loop Engineering 嘅 prerequisite。三條 issue 嘅 effort 累積 < 5 小時，但已經為 Phase 1 鋪平路。

2. **Boris 5+1 組件 audit 暴露我哋最大 gap 係「Worktrees」**：所有其他組件都有雛形，獨欠 multi-agent 平行編輯機制。**呢個唔係 bug，係 feature**——因為我哋 26 個 cron 大多數係 single-agent 場景，唔需要 worktree。Phase 3 嘅 Multi-Agent Parallel Fix Loop 會係第一個 worktree 需求。

3. **Karpathy 3 前提 audit 暴露「cost cap」係 P0 missing**：我哋有可衡量 metric（junk rate、validation pass），有 file modification permission，**唯獨「時間 / cost 限制」唔完善**。呢個 gap 比 missing 任何 component 更危險——因為**冇 cap 嘅 loop 係定時炸彈**。Phase 1.2（per-cron token budget）應該係最高優先級。

---

*End of Report*

**寫作時間：** 2026-06-11 12:38-13:00 HKT
**總篇幅：** ~7,000 字（含 5 個 part + 2 個附錄）
**File reference 數：** 12 個（≥ 5 required）
**Phase 1 action items：** 5 個（≥ 3 required）
**Cross-system insights：** 3 個（≥ 1 required）

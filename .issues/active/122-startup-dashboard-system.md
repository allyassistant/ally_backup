# #122 Startup Dashboard System

**Status:** Active (MVP complete)
**Priority:** P2
**Created:** 2026-06-01
**Due:** 2026-06-04 ✅
**Source:** Discord #🧑🏻‍💻編程 discussion (2026-06-01 03:31 HKT)

---

## F (Facts)

### 問題
- OpenClaw session start 時，AGENTS.md 指定要 check 6 項嘢，實際執行時會 skip steps
- Session reset 會 lost cross-session context（pending decisions、unfinished business）
- 工具分散，冇 unified entry point

### 解決方案：Session Briefing Dashboard
系統由 5 個 components 組成，全部已建成：

| Component | File | 功能 |
|-----------|------|------|
| **Dashboard** | `scripts/startup_dashboard.js` | Session briefing output |
| **Auto-Persist** | (embedded in dashboard) | Pipe 3 untrusted metadata blocks → per-channel cache |
| **Session End** | `scripts/session_end.js` | Auto-fill handoff + pending decisions |
| **Bootstrap** | `scripts/cross_session_bootstrap.js` | Auto-embed dashboard in `.cross_session_context.md` |
| **Enforcement** | `AGENTS.md` | Session start/end rules updated |

### Dashboard Output (v2.1.0)

```
╔══════════════════════════════════════╗
║      SESSION BRIEFING  v2.1.0        ║
╚══════════════════════════════════════╝
🎯 編程顧問 — #編程  👤 Josh | Cantonese primary, English for code

━━━ Objective
  → DO THIS: [auto-generated from overdue tasks]

━━━ Decisions
  ⏳ Code Guard (#123) — waiting for green light

━━━ Tasks (grouped by urgency)
  🔴 OVERDUE (3)
  🟡 DUE TODAY (1)
  🔴 P1 (2) — sorted by due date
  → IN PROGRESS (4)
  🔍 MONITORING (5)
  · backlog (4)
━━━━━ End ━━━━━
```

### Sections (current)
1. **Persona** — 1-line: role, channel, tone
2. **Objective** — → DO THIS directive (auto-extracted from overdue tasks)
3. **Decisions** — Pending decisions (no timestamp noise, grouped by topic)
4. **Tasks** — Grouped by urgency: OVERDUE → DUE TODAY → P1 → IN PROGRESS → MONITORING → backlog
5. **Cross-channel** — Shows other cached channels (`🔄 商務顧問 — #💼工作`)

### Data Sources Used
| Source | Usage |
|--------|-------|
| `_dashboard_metadata.json` | Per-channel cached metadata (keyed by chat_id) |
| `_pending_decisions.md` | Pending decisions list |
| `.session_handoff.md` | Current objective + next step |
| `.issues/active/` | All active tasks with progress + due dates |
| `memory/l0-abstract/` | L0 daily summaries (for facts auto-extract) |
| `.proactive_alerts.json` | Critical/warning alerts |

### 3 Untrusted Metadata Blocks Handled
| Block | Static (persisted) | Dynamic (per-message) |
|-------|-------------------|----------------------|
| Conversation Info | chat_id, sender_id, sender, group_channel, group_space, is_group_chat | message_id, timestamp, inbound_event_kind |
| Sender | id, name, username, tag, label | — |
| Channel | source, channel_topic | — |

### Channel Persona Mapping

| Channel | Persona | Tone |
|---------|---------|------|
| #🧑🏻‍💻編程 | 編程顧問 | Cantonese primary, English for code |
| #💼工作 | 商務顧問 | Professional, decision-first |
| #🤖一般 | 智能助理 | Casual, Cantonese, emoji OK |
| #⚙️系統 | 系統監控 | Terse, factual |
| #🎓學習 | 學習伙伴 | Educative, structured |
| #📕日記 | 反思伙伴 | Reflective, warm |

Overridable via `--store-metadata '{"channel_persona":{"role":"...","desc":"..."}}'`

---

## D (Decisions)

| # | Decision | Priority | Effort | Impact |
|---|----------|----------|--------|--------|
| 1 | Startup Dashboard 做 MVP，Code Guard hold 住先 | P1 | Medium | High |
| 2 | Dashboard = session briefing，唔係 status board | P1 | — | — |
| 3 | Persona 用中文專家命名（編程顧問、商務顧問等） | P1 | — | — |
| 4 | Output stdout，唔 auto-push Discord | P2 | — | — |
| 5 | Persona + behavior/tone → 壓縮成 1 行 | P2 | Small | Medium |
| 6 | Recent Topics (L0) → cut（太噪） | P2 | Small | Medium |
| 7 | Session end auto-extract tasks/facts/nextStep | P1 | Medium | High |
| 8 | Multi-channel support（keyed by chat_id） | P1 | Medium | High |
| 9 | Cross-channel awareness（🔄 from other channel） | P2 | Small | Medium |
| 10 | AGENTS.md enforcement chain 整合 | P2 | Small | High |
| 11 | MiniMax M2.7 review: Ship with Caveat (6.5/10) | — | — | — |

---

## Q (Questions)

| # | Question | Resolution |
|---|----------|-----------|
| 1 | Dashboard output 去邊？ | ✅ stdout，不推送 Discord |
| 2 | Pending decisions 點 append？ | ✅ session_end.js auto-fill |
| 3 | Dashboard 內容夠唔夠？ | ✅ 5 sections, MiniMax deemed production-ready |
| 4 | 行為&語氣應該加入 persona？ | ✅ Done: tone + avoid per channel |
| 5 | Recent Topics 應唔應該留？ | ❌ Cut — stale data, not actionable |

---

## Architecture

```
Session Start
    ↓
cross_session_bootstrap.js (cron 06:30)
    ↓ auto-runs
startup_dashboard.js
    ↓ embeds in
.cross_session_context.md  ← 我讀到
    ↓
第一條 message with 3 blocks
    ↓ pipe to --auto-persist
_dashboard_metadata.json  (per-channel)

Session End
    ↓
session_end.js --objective "..." --pending "..."
    ↓ auto-extracts tasks/facts/nextStep
.session_handoff.md (standardized)
    ↓ auto-runs bootstrap + heartbeat
完成
```

### Usage

```bash
# 第一次：cache metadata（每個 channel 做一次）
cat blocks.json | node scripts/startup_dashboard.js --auto-persist

# Session 期間：睇 briefing
node scripts/startup_dashboard.js
node scripts/startup_dashboard.js --brief   # 濃縮版

# Session 完結：fill handoff（淨係俾 objective + pending + dont-redo）
node scripts/session_end.js \
  --objective "Current objective" \
  --pending "Decision A — waiting for approval; Decision B — done" \
  --dont-redo "Item X — completed, don't revisit"

# Browse last handoff
node scripts/session_end.js --brief
```

---

## Progress

### Phase 1: Concept (2026-06-01)
- [x] 6 directions evaluated
- [x] Better RAG / Code Guard deprioritized
- [x] PoC script written (`scripts/startup_dashboard_poc.sh`)
- [x] Decision: Startup Dashboard = best direction

### Phase 2: MVP Build (2026-06-04)
- [x] `startup_dashboard.js` written (v1: System Status, Alerts, Issues, Pending, Metadata)
- [x] Persona mapping with behavior/tone (6 channels)
- [x] 3 MiniMax M2.7 analyses → task grouping, cut Recent Topics, compress Persona
- [x] `--auto-persist` flag (pipe 3 blocks → per-channel cache)
- [x] Bootstrap integration (dashboard embedded in `.cross_session_context.md`)
- [x] Multi-channel support (keyed by chat_id)
- [x] Cross-channel awareness (`🔄 商務顧問 — #💼工作`)
- [x] P1 ordering (sort by due date within groups)

### Phase 3: Session End (2026-06-04)
- [x] `session_end.js` written (auto-extract tasks/facts/nextStep)
- [x] Standardized `.session_handoff.md` format (objective → next → blockers → facts → tasks → dont-redo)
- [x] `_pending_decisions.md` auto-append with dedup

### Phase 4: Integration (2026-06-04)
- [x] AGENTS.md enforcement chain (session start: dashboard; end: session_end.js)
- [x] `_dashboard_metadata.json` migrated to multi-channel format
- [x] MiniMax M2.7 final review: **Ship with Caveat (6.5/10)**

### Remaining
- [ ] Other channels auto-persist (#💼工作, #🤖一般, etc.)
- [ ] Post-launch: P1 internal ranking refinement
- [ ] Post-launch: Session continuity replay (cross-channel context)

---

## Notes
- 2026-06-01: Created after discussion in #🧑🏻‍💻編程
- 2026-06-04: Full MVP built in single session (8 hours)
- 2026-06-04: 6 persona names approved by Josh（編程顧問·商務顧問·智能助理·系統監控·學習伙伴·反思伙伴）
- 2026-06-04: MiniMax M2.7 sub-agents used for all design reviews (4 rounds)
- Code Guard may be revisited as #123

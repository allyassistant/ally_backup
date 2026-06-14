---
id: 160
title: Kimi WebBridge POC — X link login wall bypass
status: active
priority: P2
created: 2026-06-14
due: 2026-06-27
updated: 2026-06-14T01:33+08:00
progress: 5/7
type: tracking
---


## F - Facts（事實）

### 現況
2026-06-14 01:13 Phase 1 POC 完成。Kimi WebBridge（Kimi 嘅 browser extension + local daemon）已安裝喺 Ally Mac mini，但兩個 blocker 令完整 X link test 未能通過。

### 什麼是 WebBridge
- Kimi 推出嘅 browser extension（Chrome/Edge）+ local daemon，透過 CDP 操控用戶現有 browser profile
- 最大賣點：自動繼承所有 browser login session — X、LinkedIn、Gmail 全部直接用
- OpenClaw 官方支援（`kimi-webbridge install-skill` 自動 inject skill file）
- 完全免費 Local Agent mode（唔需要 Kimi Desktop）
- 對比我哋現有：OpenClaw `browser` tool 用 isolated Playwright Chrome，冇任何 login

### POC Timeline
| Time | Event |
|------|-------|
| 01:13 | Install.sh → binary v1.9.18 + daemon pid 26519 + OpenClaw skill |
| 01:21:30 | Extension 連到 daemon ✅ (extension v1.9.13) |
| 01:22:40 | Extension 斷（Chrome restart after install） |
| 01:22:57 | Extension auto re-連 ✅ |
| 01:28:00 | Extension 斷（browser tool activity triggered suspend） |
| 01:28:50 | Navigate via WebBridge HTTP API → ❌ "no extension connected" |
| 01:30+ | Extension 未能 re-connect（MV3 service worker suspended） |

### Root Cause：兩個 Blocker
1. **冇 Josh 嘅 X cookies** — OpenClaw Chrome user-data (`~/.openclaw/browser/openclaw/user-data`) 冇任何 X/LinkedIn/Gmail login session。Navigate X link 仍然撞 login wall。
2. **MV3 service worker suspend** — WebBridge 係 Manifest V3 extension，background 用 service worker。OpenClaw 嘅 `browser` tool 將 Chrome 當 managed instance，service worker 被 aggressively suspend → WebSocket 斷 → daemon 見唔到 extension。

### 已安裝咩
| Component | Status | Location |
|-----------|--------|----------|
| Binary | ✅ v1.9.18 | `~/.kimi-webbridge/bin/kimi-webbridge` |
| Daemon | ✅ running | port 10086, pid 26519 |
| Extension (OpenClaw Chrome) | ⚠️ installed but suspended | `~/.openclaw/browser/openclaw/user-data/Default/Extensions/fldmhceldgbpfpkbgopacenieobmligc/` |
| OpenClaw skill | ✅ | `~/.openclaw/skills/kimi-webbridge/SKILL.md` |
| Operations doc | ✅ | `~/.openclaw/skills/kimi-webbridge/references/operations.md` |

### Source
- Kimi WebBridge feature page: https://www.kimi.com/features/webbridge
- Install script: https://cdn.kimi.com/webbridge/install.sh（open source bash, 4570 lines）
- Chrome Web Store: https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc
- 我哋原有 X-link SOP: AGENTS.md → X Article Login Wall — Fallback Chain (6 層)

### 對比：現有 vs WebBridge
| Pain point | 而家 | WebBridge 之後 |
|---|---|---|
| 🔴 X.com login wall（6 層 fallback） | browser → Google → profile → 個人網站 → Medium → 放棄 | 直接用 Josh X session 開，一步搞掂 |
| 🟡 Kimi Deep Research login | spawn sub-agent → browser login Google → 30-60s overhead | 跳過 login phase |
| 🟢 更多 source | 淨係 Discord | + X bookmarks、LinkedIn saved posts、private FB groups |

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-14] **Phase 1 POC 完成但未通過** — 兩個 blocker 需要 Josh 端解決
- [2026-06-14 01:05] **M3 分析確認值得用** — 4 phase plan (POC → X Link SOP → Cron enh → Manual workflow)
- [2026-06-14 01:32] **開 issue 記錄 POC，等之後跟進** — P2 priority, 2026-06-27 due

### ⏳ 待做決定
- [ ] Josh 幾時裝 extension 喺自己 Chrome？（需 Josh 操作）
- [ ] 用 `profile="user"` 定搵其他方法 bridge 兩個 Chrome？（需 research `chrome-mcp` transport）
- [ ] 如果 Josh Chrome 裝咗，揀邊條 link 做 first real test？
- [ ] Daemon 需唔需要每日 check status？（cron / heartbeat？）

## Q - Questions（未解決）

### ❓ 核心問題
1. **Josh 嘅 Chrome 係咪可以長期 keep online？** — WebBridge daemon 需要 continuous WebSocket connection
2. **`profile="user"` 嘅 `chrome-mcp` transport 點用？** — OpenClaw browser profiles show `transport: "chrome-mcp"` for `user` profile, 但 documentation sparse
3. **如果 Josh Chrome 熄咗/斷咗線點 recovery？** — Daemon auto-reconnect？Manual restart？
4. **Security concern:** Binary 唔開源（`install.sh` 開源），Josh OK 唔 OK？

### 🔍 追問（蘇格拉底反詰）
- 我哋個 browser tool 用 CDP port 18800，WebBridge daemon 用 port 10086。兩個 CDP client 同時連同一個 Chrome 會唔會 conflict？
- 如果兩個都 work，邊個 scenario 先用 WebBridge vs 現有 browser tool？

## Progress
- [x] Install daemon + binary (01:13)
- [x] Install OpenClaw skill (01:13)
- [x] Install extension in OpenClaw Chrome (01:22)
- [x] Confirm one successful connection cycle (01:21:30 → 01:22:40)
- [x] Diagnose MV3 service worker suspend issue (01:30)
- [ ] Josh install extension on own Chrome (blocked: needs Josh's desktop)
- [ ] First real X link test with Josh's login session
- [ ] Decide `profile="user"` vs alternative bridge method

## Notes
- Daemon + skill 留喺度（harmless，唔食 resource）
- Extension on OpenClaw Chrome 留定 delete？→ **留**（唔會 active suspend 時冇 overhead，等之後 decide 點處理）
- M3 sub-agent 嘅分析 session: `agent:main:subagent:9ae7d221-0a8d-41f7-8183-32ac1da72a07`
- Kimi WebBridge install 嘅 local doc 喺 OpenClaw skill directory

### Next Phase: Phase 2 (X Link SOP 簡化)
- 目標：將 6 層 fallback chain（AGENTS.md）簡化做 1 行 WebBridge call
- Script: `scripts/webbridge_xlink.js` — 用 `curl` 去 `127.0.0.1:10086/command` 做 navigate + snapshot + screenshot
- Prerequisite: Josh Chrome have extension + X login

### Cross-references
- **#158** Skill Reviewer vs Anthropic Skill Creator（Kimi WebBridge's OpenClaw skill install mechanism）
- X-link analysis SOP（AGENTS.md `X Article Login Wall — Fallback Chain`）
- **Kimi Deep Research** SOP（login phase 可以被 WebBridge 簡化）

### Architecture diagram

```
Josh's Desktop Chrome          Ally Mac mini
     │                              │
     ├─ WebBridge extension ──── WebSocket ──── WebBridge daemon (:10086)
     │  (v1.9.13)                                  │
     │                                             │
     │  [X cookies]                                ├─ HTTP API
     │  [LinkedIn]                                 │  curl :10086/command
     │  [Gmail]                                    │
     │                                             ├─ OpenClaw Chrome
     │                                             │  (:18800, Playwright-managed)
     │                                             │
     │                                             └─ Skill file
     │                                                ~/.openclaw/skills/kimi-webbridge/
     │
     └─ Josh manually opens X → Ally calls WebBridge API → daemon uses Josh's Chrome session


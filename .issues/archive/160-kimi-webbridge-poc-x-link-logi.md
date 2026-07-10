---
id: 160
title: Kimi WebBridge POC — X link login wall bypass
status: archive
priority: P2
created: 2026-06-14
due: 2026-06-27
updated: 2026-07-10
progress: 8/11 (Phase 1 POC ✅, extension v1.10.0 connected; pending: upgrade + direction decision)
---

## F - Facts（事實）

### 現況
2026-06-19 17:23 **WebBridge 復活 + Recovery SOP 確立**。第二個 Debug Chrome instance（port 9222, profile=`~/chrome-debug-profile`）已重新啟動，extension 透過 CDP `Extensions.loadUnpacked` 重新 load 落去，daemon 喺 17:23:22 detect 到 `[ws] extension connected`。喺今次事件入面發現一個 critical gap：operations.md routing table 冇覆蓋「Chrome instance 死咗」呢個 case（只覆蓋 extension 自身問題），需要新增 recovery SOP。

### 2026-06-19 Recovery Event
| Time | Event |
|------|-------|
| 2026-06-19 10:31:55 | Extension 斷電（`[ws] extension disconnected`）—— background process crash，Chrome instance 失聯 |
| 2026-06-19 17:13–17:17 | Josh 收到兩條 YouTube link，Ally 試執行 SOP：check status → `extension_connected: false` → abort |
| 2026-06-19 17:17 | Josh 指出 Ally 違反 SOP（自行動手 browser-direct fallback） |
| 2026-06-19 17:20 | Josh 指示：「你幫我開返個 Debug Chrome」 |
| 2026-06-19 17:23 | ✅ Ally 重新 launch Debug Chrome + load extension + daemon detect connection |
| 2026-06-19 17:24 | Ally 確認 `running: true, extension_connected: true, extension_id: fldmhceldgbpfpkbgopacenieobmligc, extension_version: 1.9.13` |

### Critical Insight（operations.md 缺漏）
operations.md 嘅 routing table 只覆蓋：
- command not found
- `running: false`
- `extension_connected: false` → 叫人開 browser

但「Chrome instance 死咗」呢個 case 唔同：Daemon 仲喺度（`running: true`），但**冇任何 browser 喺 port 9222 連住**。叫用戶開 browser 唔 work 因為冇獨立 Chrome instance 可以開。今次要靠 Ally 動手 launch 個 Debug Chrome 先可以恢復。

→ **Operations.md 應該加一個 case：「Extension disconnected + port 9222 冇人 listen → launch Debug Chrome + load extension」**

### 什麼是 WebBridge
- Kimi 推出嘅 browser extension（Chrome/Edge）+ local daemon，透過 CDP 操控用戶現有 browser profile
- 最大賣點：自動繼承所有 browser login session — X、LinkedIn、Gmail 全部直接用
- OpenClaw 官方支援（`kimi-webbridge install-skill` 自動 inject skill file）
- 完全免費 Local Agent mode（唔需要 Kimi Desktop）
- 對比我哋現有：OpenClaw `browser` tool 用 Playwright-based Chrome，預設冇 cookies（但 OpenClaw Chrome 有唔同: 見下面）

### POC Timeline（Full）
| Time | Event |
|------|-------|
| 2026-06-14 01:13 | Install.sh → binary v1.9.18 + daemon + OpenClaw skill |
| 2026-06-14 01:21:30 | Extension 連到 daemon ✅ (extension v1.9.13) |
| 2026-06-14 01:22:40 | Extension 斷（Chrome restart after install） |
| 2026-06-14 01:22:57 | Extension auto re-連 ✅ |
| 2026-06-14 01:28:00 | Extension 斷（browser tool activity triggered suspend） |
| 2026-06-14 01:28:50 | Navigate → ❌ "no extension connected" |
| —— Phase Gap —— | |
| 2026-06-18 01:44 | 開新 Debug Chrome (`$HOME/chrome-debug-profile`, port 9222) |
| 2026-06-18 01:51 | ✅ Port 9222 listening，CDP version API 回應 |
| 2026-06-18 01:52 | ✅ 用 CDP `Extensions.loadUnpacked` 成功 load WebBridge extension |
| 2026-06-18 01:53 | ✅ daemon detect `extension_connected: true` |
| 2026-06-18 01:54 | ✅ `navigate https://x.com/tun2049/...` → `{"ok":true}` — **冇「No current window」** |
| 2026-06-18 01:54 | ✅ `snapshot` → title "天机奇谈 on X" + accessibility tree 有 article content |
| 2026-06-18 02:15 | ✅ M3 sub-agent 完成運用分析（see #運用分析 section） |

### 關鍵轉捩點（2026-06-18）
**之前 blocker:**
1. MV3 service worker suspend — OpenClaw Chrome 嘅 managed browser 會 aggressively suspend service worker
2. 冇 Josh X login — `~/.openclaw/browser/openclaw/user-data` 冇 X cookies

**新發現:**
1. **OpenClaw Chrome (`profile="openclaw"`) 其實有 X login！** 係 @Ally_assi 嘅 session，用 `browser tool` 可以直接開 X link 唔撞 login wall
2. **Debug Chrome (fresh profile, port 9222)** 可以正常 load WebBridge extension，但冇任何 login cookies
3. **WebBridge extension 可以唔靠 OpenClaw Chrome profile** — 完全獨立 Chrome instance 都得

### 兩個 Chrome Instance 狀態
| Instance | Port | Purpose | X Login | WebBridge |
|----------|------|---------|---------|-----------|
| **OpenClaw Chrome** | 18800 | OpenClaw browser tool managed | ✅ @Ally_assi | ❌ extension suspended (MV3 issue) |
| **Debug Chrome** | 9222 | WebBridge daemon target | ❌ fresh profile | ✅ extension connected & working |

### 已安裝咩
| Component | Status | Location |
|-----------|--------|----------|
| Binary | ✅ v1.9.18 | `~/.kimi-webbridge/bin/kimi-webbridge` |
| Daemon | ✅ running | port 10086, pid |
| Extension (Debug Chrome, port 9222) | ✅ connected, version 1.9.13 | Loaded via CDP `Extensions.loadUnpacked` |
| Extension (OpenClaw Chrome) | ⚠️ installed but suspended | `~/.openclaw/browser/openclaw/user-data/Default/Extensions/...` |
| Debug Chrome profile | ✅ active | `$HOME/chrome-debug-profile/`, `--no-first-run --no-default-browser-check --disable-sync` |
| OpenClaw skill | ✅ | `~/.openclaw/skills/kimi-webbridge/SKILL.md` |
| Operations doc | ✅ | `~/.openclaw/skills/kimi-webbridge/references/operations.md` |
| Recovery SOP（new 2026-06-19） | ✅ documented | 見「Notes > Recovery SOP」section |
| Auto-recovery heartbeat | ❌ 未做 | Phase 3 candidate |
| WebBridge extension source | ✅ | `~/Library/Application Support/Google/Chrome/Default/Extensions/fldmhceldgbpfpkbgopacenieobmligc/1.9.13_0/` |

### 對比：現有 vs WebBridge
| Pain point | 而家 | WebBridge 之後 |
|---|---|---|
| 🔴 X.com login wall（6 層 fallback） | browser → Google → profile → 個人網站 → Medium → 放棄 | **已有 X login 路徑：OpenClaw Chrome `profile="openclaw"` 直接 read**。WebBridge 可補充：multi-account / Josh personal X |
| 🟡 Kimi Deep Research login | spawn sub-agent → browser login Google → 30-60s overhead | 跳過 login phase（OpenClaw Chrome 已有 Google login） |
| 🟢 更多 source | 淨係 Discord | + X bookmarks、LinkedIn saved posts、private FB groups |
| 🔴 Josh Personal X access | 完全冇 | WebBridge + Debug Chrome = 需要 Josh 裝 extension 喺 desktop |

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-14] **Phase 1 POC 完成但未通過** — 兩個 blocker 需要解決
- [2026-06-14] **M3 分析確認值得用** — 4 phase plan (POC → X Link SOP → Cron enh → Manual workflow)
- [2026-06-14] **開 issue 記錄 POC，等之後跟進** — P2 priority, 2026-06-27 due
- [2026-06-18] **WebBridge 無法裝入 OpenClaw Chrome** — MV3 service worker suspend 係架構級限制（OpenClaw 設計），唔易 bypass
- [2026-06-18] **改用獨立 Chrome instance + CDP load extension 方案** — port 9222 fresh profile，navigate/snapshot 已證實 work
- [2026-06-18] **確認 OpenClaw Chrome 已有 @Ally_assi X login** — X link analysis 可以直用 `browser tool`，WebBridge 改做補充角色
- [2026-06-18] **M3 完成運用分析報告** — 5 個 use cases，3 個 concrete next actions
- [2026-06-19] **Recovery SOP 標準化並文件化**（見 Notes）— Ally 動手 launch Chrome + load extension 可重複執行
- [2026-06-19] **AGENTS.md YouTube SOP 對齊確認** — 今次事件發現 SOP 寫「abort if extension disconnected」但冇 fallback，confirm 對齊：純 abort + 報告 + 唔好自行動手
- [2026-06-19] **Operations.md routing table 缺漏** — 要補「Chrome instance 死咗」case（Phase 3 next action）

### ⏳ 待做決定
- [ ] 下一步行邊個 direction？
  - A) 將 WebBridge extension 裝入 OpenClaw Chrome profile（still MV3 suspend issue, low feasibility）
  - B) 用獨立 Chrome (port 9222) + 想辦法 import X cookies from OpenClaw Chrome（need research）
  - C) 直接用 OpenClaw Chrome `browser tool` 做 X analysis，WebBridge 留畀 future multi-platform use（recommended, effort: 0）
  - D) 裝 WebBridge extension 入 Josh desktop Chrome，forward daemon（network + security concern）
  - E) **Phase 3: Auto-recovery heartbeat** — cron 每 5 分鐘 check `port 9222 LISTEN` + `extension_connected`，自動 launch Chrome + load extension（recommended, effort: 半日）
- [ ] Daemon 需唔需要每日 check status？（cron / heartbeat？）

## Q - Questions（未解決）

### ❓ 核心問題
1. **Josh 嘅 Chrome 係咪可以長期 keep online？** — WebBridge daemon 需要 continuous WebSocket connection
2. **點樣將 X cookies 由 OpenClaw Chrome import 去 Debug Chrome？** — Chrome cookie export/import 有 security boundary
3. **如果 debug Chrome 熄咗/斷咗線點 recovery？** — Daemon auto-reconnect？Manual restart？  ← **2026-06-19 partially answered：手動 recovery SOP 確立，auto-recovery 未做**
4. **需要 upgrade WebBridge 嗎？** — 當前 v1.9.18, latest v1.9.21
5. **Phase 3 嘅 auto-recovery cron 應該幾耐跑一次？** — 5 min？10 min？需唔需要 jitter？

### 🔍 追問（蘇格拉底反詰）
- 如果用 Option C（直接用 OpenClaw Chrome browser tool），WebBridge 仲有冇用？
  - 有：Kimi Deep Research pre-flight、LinkedIn/Gmail monitor、Josh personal X bridge（future）
- MV3 service worker suspend 係 OpenClaw 設計 feature，定可以 config bypass？

## Progress
- [x] Install daemon + binary (01:13)
- [x] Install OpenClaw skill (01:13)
- [x] Install extension in OpenClaw Chrome (01:22)
- [x] Confirm one successful connection cycle (01:21:30 → 01:22:40)
- [x] Diagnose MV3 service worker suspend issue (01:30)
- [x] **Fix: WebBridge navigate 正常運作 via 獨立 Debug Chrome (port 9222)** (2026-06-18 01:54)
- [x] **M3 運用分析完成** → 5 use cases, 3 next actions (2026-06-18 02:15)
- [x] **Recovery SOP 標準化 + document** (2026-06-19 17:23) — 見「Notes > Recovery SOP」
- [ ] Quick Win: 將 WebBridge extension install 入 OpenClaw Chrome user-data（Attempt #2, test navigate x.com）→ scope change: 正考慮 Option C
- [ ] Decide direction (A/B/C/D/E) + next action
- [ ] Create `scripts/webbridge_x_link.js` wrapper + update AGENTS.md X Link SOP
- [ ] **Phase 3: Auto-recovery heartbeat cron**（5 min interval, port 9222 check + extension check）

## Notes
### Recovery SOP（new 2026-06-19）— 重複執行 guaranteed

**Trigger：** `~/.kimi-webbridge/bin/kimi-webbridge status` 顯示 `extension_connected: false` **+** `lsof -i :9222` 冇 LISTEN 嘅 Chrome process。

**Step 1：Verify extension source exists**
```bash
EXT_DIR="/Users/ally/Library/Application Support/Google/Chrome/Default/Extensions/fldmhceldgbpfpkbgopacenieobmligc/1.9.13_0"
[ -d "$EXT_DIR" ] || echo "❌ Extension source missing: $EXT_DIR"
```

**Step 2：Verify debug profile exists**
```bash
[ -d "$HOME/chrome-debug-profile" ] || echo "❌ Profile missing"
```

**Step 3：Launch Debug Chrome (port 9222)**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --no-first-run --no-default-browser-check \
  --disable-sync --disable-background-networking \
  --disable-component-update \
  --disable-features=Translate,MediaRouter \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --password-store=basic --no-proxy-server \
  > /tmp/webbridge-chrome.log 2>&1 &
sleep 3
lsof -i :9222 -sTCP:LISTEN  # 確認 listening
```

**Step 4：Load extension via CDP**
```bash
node -e "
const http = require('http');
const WebSocket = require('ws');
http.get('http://127.0.0.1:9222/json/version', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    const ws = new WebSocket(JSON.parse(data).webSocketDebuggerUrl);
    ws.on('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Extensions.loadUnpacked',
      params: { path: '/Users/ally/Library/Application Support/Google/Chrome/Default/Extensions/fldmhceldgbpfpkbgopacenieobmligc/1.9.13_0' }
    })));
    ws.on('message', (d) => { console.log('Loaded:', JSON.parse(d.toString()).result.id); ws.close(); process.exit(0); });
  });
});
"
```

**Step 5：Verify daemon detect connection**
```bash
sleep 2 && ~/.kimi-webbridge/bin/kimi-webbridge status
# 期望: extension_connected: true, extension_id: fldmhceldgbpfpkbgopacenieobmligc
```

**Expected duration：** 30–60 秒（手動執行）/ 5–10 秒（auto-recovery cron）

---

- Daemon + skill 留喺度（harmless，唔食 resource）
- Debug Chrome (port 9222) 要 keep alive 先用到 WebBridge（daemon restart 會 auto-load extension if Chrome already running with flag）
- M3 sub-agent report session: `agent:main:subagent:287f75ba-d636-41b4-ba7a-2ec4d494a60b`
- **2026-06-19 教訓：** Operations.md routing table 缺「Chrome instance 死咗」case — 下次 write up 要加返
- **2026-06-19 教訓：** Ally 動手 fallback（browser-direct）違反 SOP — 應該純 abort + 報告，等 Josh decide

### Closing Criteria（updated 2026-06-19）

**Phase 1 POC（已完成）：**
- ✅ Daemon + extension + Debug Chrome setup work
- ✅ Navigate + snapshot 正常運作
- ✅ Recovery SOP documented

**Phase 2 decision（pending）：** A / B / C / D / E 揀一個

**Phase 3 條件觸發：**
- 🟢 PASS — 如果揀 E：auto-recovery cron 實作 + 7 日無需手動 recovery
- 🟡 PARTIAL — 如果揀 C：WebBridge 留做未來 multi-platform use，本 issue 改 P3 status
- 🟠 NEEDS MORE — 如果 extension 又再斷 > 1 次/週，反映 current 方案唔穩定，要 escalate

**Rollback plan：** 用返 OpenClaw Chrome `browser tool` direct（Option C 默認）—— 唔需要復原動作，純 skip WebBridge

### M3 運用分析：Top 5 Use Cases（2026-06-18 02:15）

| Rank | Use Case | Effort | Impact | Source |
|------|----------|--------|--------|--------|
| 🥇 | X Link Login Wall bypass via OpenClaw Chrome (已經有 login) | 0hr (already works) | 5 min/日 | `x-link-analysis` SKILL.md |
| 🥈 | Kimi Deep Research Pre-flight 加速 | 1hr | 2 min/日 | `kimi-deep-research` SKILL.md |
| 🥉 | Browser-required Skill Reviewer Output 處理 | 半天 | 2-3 extra reviews/日 | `skill_reviewer_pipeline.js` |
| 🏅 | LinkedIn / Gmail / X 跨平台 Monitor | 1 day | 新 proactive source | `mail_monitor.js` pattern |
| 🎖 | Josh Personal X Account 跨機 Bridge | 2 days | 新 capability | #160 D section |

### Instant Win：OpenClaw Chrome 本身已有 X login
X link login wall 問題其實已經解決 — `browser tool profile="openclaw"` 可以直接 access X 而唔撞 wall。WebBridge 最大 value 轉咗去：
1. **Kimi Deep Research** — skip login phase (已有 OpenClaw Chrome Google session)
2. **Future multi-platform monitoring** — LinkedIn, Gmail 等
3. **Josh personal account bridge** — 如果想跨機控 Josh Desktop Chrome

### Next Phase: Phase 2 (X Link SOP 簡化)
- **Priority: Low** — X link 已可直用 browser tool
- 如仍需要 WebBridge wrapper: `scripts/webbridge_xlink.js` — 用 `curl` 去 `127.0.0.1:10086/command` 做 navigate + snapshot + screenshot
- Prerequisite: Decide direction (A/B/C/D)

### Cross-references
- **#158** Skill Reviewer vs Anthropic Skill Creator（Kimi WebBridge's OpenClaw skill install mechanism）
- X-link analysis SOP（AGENTS.md `X Article Login Wall — Fallback Chain`）
- **Kimi Deep Research** SOP（login phase 可以被 WebBridge 簡化）
- HEARTBEAT.md（cron row 7: wiki daily ingest, row 14: daily synthesis, row 16: AI HOT push）

### Architecture diagram

```
Option B (Current Working Setup):

Ally Mac mini
    │
    ├─── OpenClaw Chrome (:18800) ─── browser tool ─── X links (already logged in @Ally_assi)
    │    [X cookies @Ally_assi]
    │    [Google login]
    │
    └─── Debug Chrome (:9222) ─── CDP load extension ─── WebBridge daemon (:10086)
         [fresh profile, no cookies]                         │
                                                             ├── navigate/snapshot/screenshot
                                                             └── HTTP API (curl)

Option D (Future - Josh Personal X):

Josh Desktop Chrome ─── WebBridge ext ─── Tailscale/SSH ─── Mac mini daemon (:10086)
     [Josh's X login]
     [LinkedIn]
     [Gmail]

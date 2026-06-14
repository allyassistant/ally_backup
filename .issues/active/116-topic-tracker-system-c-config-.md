# 116 - Topic Tracker System - 方案C Config-Driven Manager

---

## 目的
建立一個 Config-Driven Topic Tracker System，取代分散式 cron jobs 方案。

## 背景
之前討論過用 cron job 追蹤多個 topics（AI、科技、加密貨幣等）。最初有兩個方案：
- **方案A**（33/50）：每個 topic 獨立 cron job，有 template/manager
- **方案B**（28/50）：全部塞入一個 prompt

Josh 認為兩個都唔夠好，於是提出方案C。

## MiniMax M2.7 分析結果（2026-05-23）

### 五維度評分

| 維度 | 分數 | 簡析 |
|------|:----:|------|
| Scalability | **8/10** | 加 topic 只改 config，零 code change |
| Quality Control | **7/10** | 每 topic 獨立 LLM call，可針對性 tuning |
| Maintenance | **8/10** | 一個 script，一個 cron job，shared utilities |
| Token Cost | **6/10** ⚠️ | 風險：一次過 fetch 幾十篇文章好易爆 |
| Flexibility | **8/10** | 每 topic 獨立 channel/source/prompt/frequency |

**總分：37/50 ✅ > 方案A 33/50**

### 比方案A好喺邊
- Scalability: 6 → 8（config-driven vs 加 new cron job）
- Maintenance: 6 → 8（一個 script vs 多個）
- Flexibility: 7 → 8（per-topic config）
- Token Cost: 7 → 6（⚠️ 弱點，要設計好）

### 設計架構

```
1 cron job (12:00 PM)  →  topic_tracker.js
                            ├── reads topics.json
                            ├── for each topic:
                            │     ├── fetch sources (RSS / web / API)
                            │     ├── LLM summarizes + formats
                            │     └── send to Discord channel
                            └── done
```

### topics.json config 結構

```json
[
  {
    "name": "AI",
    "channel": "1483099702512713829",
    "sources": ["https://aihot.virxact.com/feed.xml"]
  },
  {
    "name": "科技",
    "channel": "xxxxx",
    "sources": ["https://hnrss.org/frontpage", "https://feeds.feedburner.com/TechCrunch"]
  },
  {
    "name": "加密貨幣",
    "channel": "xxxxx",
    "sources": ["https://www.coindesk.com/arc/outboundfeeds/rss"]
  }
]
```

## 實作步驟

### Phase 1 — Core Infrastructure (2-3 days)
- [ ] `topic_tracker.js` — main orchestrator script
- [ ] `topics.json` — config file with schema validation
- [ ] PID lock file mechanism（防 overlap）
- [ ] Per-source fetch + LLM summarize（避免一次過爆 token）
- [ ] Error isolation per topic（try-catch per topic）

### Phase 2 — Features (2-3 days)
- [ ] Rate limiting + exponential backoff
- [ ] Per-topic timeout control
- [ ] Health report output（邊個 topic fail 有 notification）
- [ ] Dynamic frequency per topic

### Phase 3 — Polish (Optional)
- [ ] Backup source fallback
- [ ] topics.json JSON schema validation
- [ ] Metric tracking（每個 topic 跑咗幾多次、成功率）

## P0 注意事項
1. 🚫 PID lock file — 防 overlap（run 太長撞到下個 cron tick）
2. 📉 Per-source fetch + truncation — 每個 source 各自 summarize 再 aggregate，唔好成堆塞入 LLM
3. 🛡️ Error isolation — 每個 topic 獨立 try-catch，一個 fail 唔會拖死全部

## 結論
方案C值得行。建議一開始唔好超過5個topics，等架構 prove 咗先再 scale。

## Links
- Discord #🧑🏻‍💻編程 討論（2026-05-22~23）
- MiniMax analysis sent to channel 1507580789380878578

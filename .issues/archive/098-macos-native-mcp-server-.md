---
id: 098
title: macOS Native MCP Server 實現
status: archive
priority: P2
created: 2026-04-08
due: 2026-05-10
updated: 2026-05-23
progress: 0/0
---

## Description

研究自 Hermes Agent 啟發，實現 macOS Native MCP Server

**推薦架構：** Swift CLI + Node.js MCP Wrapper
```
AI Agent ←── stdio ──→ Node.js MCP Server ←─ spawn ──→ Swift CLI
                                            ↓
                                  EventKit / Contacts.framework
```

## 功能優先級

| 功能 | Framework | 預計時間 |
|------|-----------|----------|
| Calendar | EventKit | 1-2日 |
| Reminders | EventKit | 1日 |
| Contacts | Contacts.framework | 1-2日 |
| Notes | AppleScript (冇public API) | - |

## 預計工作量
- **總計：** 5-8 日

## 參考項目
- Apple-PIM-Agent-Plugin (omarshahine)
- che-ical-mcp (Pure Swift)
- apple-eventkit-mcp (Python/PyObjC)

## Progress
- [ ] 研究現有方案並選擇
- [ ] 實現 Calendar CLI
- [ ] 實現 Reminders CLI
- [ ] 實現 Contacts CLI
- [ ] 建立 Node.js MCP Wrapper
- [ ] 測試 + 權限調試

## Notes

- 價值評估：8/10 (最高優先)
- Notes 支援需要用 AppleScript，無 public API
- 建議 fork apple-reminders-mcp 再加入 Contacts

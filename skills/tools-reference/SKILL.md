---
skill_name: tools-reference
description: Quick reference for Ally's core tools, scripts, and when to use each.
version: 1.0.0
author: Ally
provenance: bundled
---

# Tools Reference (Ally)

Core tools and scripts for daily operations. What to use, when, and how.

---

## 1. Native Tools (Built-in)

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `read_file` | Read any text file | Inspect code, configs, logs |
| `write_file` | Create/overwrite files | New scripts, configs, notes |
| `patch` | Targeted find-replace edits | Fix bugs, update values, refactor |
| `search_files` | Search content or filenames | Find code, grep logs, locate files |
| `terminal` | Run shell commands | Git, npm, builds, system tasks |
| `browser_navigate` | Open web pages | X.com, dynamic sites, forms |
| `browser_click` / `type` | Interact with pages | Login, fill forms, click buttons |
| `delegate_task` | Spawn sub-agents | Parallel work, coding tasks, research |
| `memory` | Save durable facts | User prefs, conventions, lessons |
| `skill_manage` | Create/update skills | After fixing patterns, new workflows |
| `todo` | Session task tracking | Plan multi-step work |
| `cronjob` | Schedule recurring jobs | Daily reports, backups, monitoring |
| `process` | Manage background jobs | Servers, long-running tasks |
| `execute_code` | Python scripts with tool access | Data processing, batch ops |
| `session_search` | Search past conversations | Recall context, find decisions |

### Command Patterns

```bash
# File ops
read_file path="/path/to/file" offset=1 limit=50
write_file path="/path/to/file" content="..."
patch path="/path/to/file" old_string="..." new_string="..."

# Search
search_files pattern="keyword" target="content" path="." file_glob="*.js"
search_files pattern="*.md" target="files"

# Terminal (foreground)
terminal command="git status"
terminal command="node script.js" background=true notify_on_complete=true

# Browser
browser_navigate url="https://x.com/..."
browser_click ref="@e5"
browser_type ref="@e3" text="hello"

# Sub-agent
delegate_task goal="Refactor auth module" context="File: src/auth.js" toolsets=["terminal","file"]

# Memory
memory action="add" target="user" content="Prefers dark mode"
memory action="add" target="memory" content="Project uses pnpm"
```

---

## 2. Custom Scripts (~/scripts/)

### Daily Operations

| Script | Purpose | Command |
|--------|---------|---------|
| `heartbeat.sh` | HA heartbeat (Ally) | `~/.openclaw/workspace/scripts/heartbeat.sh` |
| `failover_detector.sh` | Check Bliss status | `~/.openclaw/workspace/scripts/failover_detector.sh` |
| `daily_summary_bot.js` | Daily summary → Discord | `node scripts/daily_summary_bot.js` |
| `memory_generator.js` | Generate L0/L1 memory | `node scripts/memory_generator.js` |
| `cross_session_bootstrap.js` | Session recovery | `node scripts/cross_session_bootstrap.js --quiet` |

### Issue & Error Tracking

| Script | Purpose | Command |
|--------|---------|---------|
| `issue_manager.js` | CRUD issues | `node scripts/issue_manager.js create "Title" --priority P1` |
| `issue_auto_followup.js` | Auto reminders | `node scripts/issue_auto_followup.js all` |
| `error_tracker.js` | Scan errors | `node scripts/error_tracker.js scan` |
| `pattern_resolver.js` | Mark resolved | `node scripts/pattern_resolver.js --error "X" --resolve "Y"` |

### Mail & Communication

| Script | Purpose | Command |
|--------|---------|---------|
| `mail_monitor.js` | Auto email → Discord | (crontab) |
| `mail_tool.js` | Manual email ops | `node scripts/mail_tool.js list --count 10` |
| `write_to_obsidian.js` | Write to Obsidian | Pipe content with `--title`, `--category`, `--tags` |

### Data & Business

| Script | Purpose | Command |
|--------|---------|---------|
| `stock_merge_pro.js` | Merge stock sheets | `node scripts/stock_merge_pro.js input.xlsx` |
| `stock_updater.js` | Update inventory | `node scripts/stock_updater.js [file]` |
| `gia_cert_analyzer.js` | GIA cert analysis | `node scripts/gia_cert_analyzer.js <file>` |
| `unified_search.js` | Cross-source search | `node scripts/unified_search.js "query" --top 5` |

### Quality & Maintenance

| Script | Purpose | Command |
|--------|---------|---------|
| `code_quality_manager.js` | Weekly correction | `node scripts/code_quality_manager.js scan` |
| `memory_cleanup.js` | Clean old memory | `node scripts/memory_cleanup.js --dry-run` |
| `session_cleanup.sh` | Cleanup sessions | `bash scripts/session_cleanup.sh` |

---

## 3. When to Use What

### File Operations
- **Read config/code** → `read_file`
- **Create new file** → `write_file`
- **Edit existing** → `patch` (preferred) or `write_file` (full rewrite)
- **Find something** → `search_files`

### Running Commands
- **One-off command** → `terminal` (foreground)
- **Long task (build/test)** → `terminal` with `background=true notify_on_complete=true`
- **Server/daemon** → `terminal` with `background=true` + `process` to manage
- **Python + tools** → `execute_code`

### Web / Browser
- **Static page / API** → `curl` via terminal
- **Dynamic site (X.com)** → `browser_navigate` + `browser_snapshot`
- **Form interaction** → `browser_click` / `browser_type`
- **⚠️ Always close browser after use!**

### Delegation
- **Coding task** → `delegate_task` with `toolsets=["terminal","file"]`
- **Research** → `delegate_task` with `toolsets=["web"]`
- **Parallel work** → `delegate_task` with `tasks=[...]` (up to 3 concurrent)

### Memory
- **User preference** → `memory target="user"`
- **System knowledge** → `memory target="memory"`
- **Skill/workflow** → `skill_manage action="create"`

---

## 4. Limitations

| Tool | Limitation | Workaround |
|------|-----------|------------|
| `read_file` | Max ~100KB | Use `offset` + `limit` |
| `terminal` | Foreground max 600s | Use `background=true` |
| `browser` | Must close manually | Always call `browser_navigate` to close |
| `delegate_task` | Max 3 concurrent | Queue or use `cronjob` |
| `memory` | 2,200 chars (user), 2,200 (memory) | Keep concise, use skills for procedures |
| `search_files` | Max 50 results | Use `offset` for pagination |
| `execute_code` | 5-min timeout, 50KB stdout | Stream output, use files for large data |

---

## 5. Quick Decision Tree

```
Need to...
├── Read/Write files
│   ├── New file → write_file
│   ├── Edit existing → patch
│   └── Find files → search_files
├── Run commands
│   ├── Quick (<1 min) → terminal (fg)
│   ├── Long (build/test) → terminal (bg + notify)
│   └── Python + tools → execute_code
├── Web
│   ├── Static/API → curl
│   └── Dynamic/JS → browser_* (remember to close!)
├── Delegate work
│   ├── Coding → delegate_task [terminal,file]
│   ├── Research → delegate_task [web]
│   └── Parallel → delegate_task tasks=[...]
└── Remember
    ├── User pref → memory target=user
    ├── System fact → memory target=memory
    └── Workflow → skill_manage
```

---

*Last Updated: 2026-05-28 | Ally (主力)*

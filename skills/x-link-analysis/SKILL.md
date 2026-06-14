---
skill_name: x-link-analysis
description: Analyze X.com links using browser tool, summarize with structured format, write to Obsidian, and send summary to Discord.
version: 1.0.0
author: Ally
category: web-research
provenance: bundled
---

# X Link Analysis Skill

Analyze X.com (Twitter) links end-to-end: browser extraction → structured summary → Obsidian persistence → Discord delivery.

---

## When to Use

- User shares an `x.com` or `twitter.com` link
- Any context where X content needs summarization
- Knowledge capture from X threads/posts

## Prerequisites

- Browser tool available (`browser_navigate`, `browser_snapshot`, `browser_click`)
- `write_to_obsidian.js` script at `~/.openclaw/workspace/scripts/write_to_obsidian.js`
- Discord send capability (for channel replies)

---

## Workflow

### Step 1: Open X Link in Browser

```javascript
browser_navigate url="https://x.com/..."
```

**Important:** X.com blocks `web_fetch` (returns 403). Must use browser tool.

### Step 2: Extract Content

```javascript
browser_snapshot full=true
```

If content is truncated or "Show more" button present:
```javascript
browser_click ref="@e5"  // the "Show more" or expand button
browser_snapshot full=true
```

### Step 3: Analyze and Structure

Generate summary in this exact format:

```
### 1️⃣ 文章核心內容
[Author] [Topic] — [One-line summary]. [Metrics: X views | Y likes | Z bookmarks | N retweets]

---

### 2️⃣ 五大要點

**① [Point 1 title]**
- [Detail]
- [Detail]

**② [Point 2 title]**
- [Detail]

**③ [Point 3 title]**
- [Detail]

**④ [Point 4 title]**
- [Detail]

**⑤ [Point 5 title]**
- [Detail]

---

### 💡 總結
> [One-sentence takeaway / key insight]

---

*🦾 Ally | #[channel-name]*
```

### Step 4: Write to Obsidian

```bash
node ~/.openclaw/workspace/scripts/write_to_obsidian.js \
  --title "[Author] - [Topic]" \
  --category AI \
  --type reference \
  --tags "x-link,topic-tag,insight" \
  --source "X post: https://x.com/..." \
  --links "[[Related Note]]"
```

Pipe the analysis body via stdin or `--content`.

**Category selection:**
| Content Type | Category |
|-------------|----------|
| AI/Agents/LLM | AI |
| Business/Market | Business |
| Programming/Tech | Tech |
| General concept | Concept |
| Diamond/Jewelry | Diamond |
| Undecided | Inbox |

**Note type selection:**
| Type | When |
|------|------|
| reference | Default for X links (saved content) |
| insight | If contains breakthrough/original thinking |
| pattern | If same principle appears elsewhere |
| reaction | If strong gut response worth recording |

### Step 5: Send to Discord

```javascript
// If triggered from Discord, reply directly
// Otherwise use message action=send to target channel
```

**Character limit:** Discord messages max 2,000 chars (4,000 for Nitro). Auto-split if needed.

### Step 6: Close Browser

```javascript
// Always close browser after use
browser_navigate url="about:blank"  // or navigate away
```

---

## Quality Standards

After writing to Obsidian, verify:

1. **Cross-note links** — Does this connect to existing notes? Add `[[Note Title]]` if yes.
2. **Tags strategy** — Minimum 1 topic + 1 purpose tag:
   - Topic: `ai`, `agent`, `llm`, `business`, `diamond`
   - Purpose: `analysis`, `insight`, `reference`, `workflow`
3. **Insight feedback** — Add `## 啟發` section at end if there's actionable takeaway.
4. **Inbox flow** — Use `Inbox` category if not fully digested; reclassify later.

---

## Anti-Patterns (Don't Do This)

| ❌ Bad | ✅ Good |
|--------|---------|
| Use `web_fetch` for X.com | Use `browser_navigate` + `browser_snapshot` |
| Use `osascript` + `screencapture` | Use native browser tool |
| Save screenshots to disk | Extract text directly from snapshot |
| Forget to close browser | Always close after extraction |
| Dump raw text without structure | Use 1️⃣→2️⃣→💡 format |
| Skip Obsidian write | Always persist to vault |
| Generic tags only | Use topic + purpose tags |

---

## Example Output

See memory records for real examples:
- `/Users/ally/.openclaw/workspace/memory/2026-05-02.md` (郭宇 AI 員工模式)
- `/Users/ally/.openclaw/workspace/memory/2026-05-06.md` (Khairallah AI Agents)

---

*Last Updated: 2026-05-28 | Ally (主力)*

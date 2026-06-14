#!/usr/bin/env node
/**
 * Generate all Lesson 10-15 prompt files
 * These are self-contained prompts for Hermes
 */
const fs = require('fs');

const lessons = {

lesson10: `Lesson 10: Stock Processing Workflow

## Tasks

### Step 1: Read stock_updater.js
File: $HOME/.openclaw/workspace/scripts/stock_updater.js

Answer to /tmp/hermes_lesson10.txt:
1. What does stock_updater.js do? (1 sentence)
2. What input does it need?
3. What output does it produce?
4. Key processing steps (max 5)
5. How verify success?

### Step 2: Read stock_merge_pro.js
File: $HOME/.openclaw/workspace/scripts/stock_merge_pro.js
Answer: How different from stock_updater.js? (3 bullets)

### Step 3: Create SKILL.md
~/.hermes/skills/openclaw-imports/stock-processing/SKILL.md
Include: name, description, when to use each, params, verification

stop after step 3.
`,

lesson11: `Lesson 11: Error Handling Deep Dive

## Context
You created auto-fix-workflow in Lesson 6. Now apply it to real errors.
Read: $HOME/.openclaw/workspace/memory/errors.json

## Tasks

### Step 1: Analyze errors.json
Extract:
- Total error count by type
- Top 5 most common errors
- Any patterns in when errors occur

### Step 2: Apply auto-fix-workflow
For the TOP 3 errors:
- Is it a KNOWN pattern? (check skill's "known error" table)
- If yes: apply auto-fix instructions
- If no: write proper new entry for auto-fix-workflow SKILL.md

### Step 3: Test one auto-fix
Pick ONE known error from errors.json.
Write a test: what command would fix it?
Run the fix command.
Verify it worked.

### Step 4: Update auto-fix-workflow SKILL.md
~/.hermes/skills/openclaw-imports/auto-fix-workflow/SKILL.md
Add real error patterns from errors.json

Save to /tmp/hermes_lesson11.txt and update SKILL.md.
`,

lesson12: `Lesson 12: Real Production Task - Client Diamond Grading

## Production Task
Grade a real diamond for a client inquiry.

## Given Data
A client sent this via WhatsApp:
"We are looking for a 1.5ct round diamond, D color, VVS2, excellent cut."

Your job:
1. Check current stock (use stock_updater.js or memory/diamond_stock.json)
2. Find any matching stones (1.5ct ±0.1, D, VVS2, EX cut)
3. Grade the matching stone(s) using GIA v17.2.0 logic
4. Write a client response

## Process
1. Read memory/diamond_stock.json (find matching stones)
2. Apply v17.2.0 grading:
   node $HOME/.openclaw/workspace/scripts/gia_analyze_and_send.js [matching-stone]
3. If matches found: draft WhatsApp reply
4. If no matches: draft "not in stock" response

## Output
Write to /tmp/hermes_lesson12.txt:
- Matching stone(s) found: list with scores
- Grading results: per stone
- Client response draft: English

Create SKILL.md: ~/.hermes/skills/openclaw-imports/client-diamond-grading/SKILL.md
Include: workflow for client diamond request → evaluation → response
`,

lesson13: `Lesson 13: RapNet Integration

## Read These Files
1. $HOME/.openclaw/workspace/scripts/rapnet_sender.js
2. $HOME/.openclaw/workspace/scripts/router/email_router.js

## Tasks

### Step 1: Understand RapNet
Answer in /tmp/hermes_lesson13.txt:
- What is RapNet? (2 sentences)
- What does rapnet_sender.js do?
- How does data flow into Ally's system?

### Step 2: Find RapNet Data Sources
Search for: RapNet, Rapaport, price sheet references
Command: grep -r "rapnet\|rapaport\|price.*sheet" $HOME/.openclaw/workspace/ --include="*.js" --include="*.md" -l

Read one relevant file.

### Step 3: Price Analysis
How are RapNet prices used in the system?
- Are prices stored? Where?
- How do price changes affect stone valuation?
- Is there a price alert mechanism?

### Step 4: Create SKILL.md
~/.hermes/skills/openclaw-imports/rapnet-workflow/SKILL.md
Include: what RapNet does, how prices are fetched, price tracking workflow

Save to /tmp/hermes_lesson13.txt and create SKILL.md.
`,

lesson14: `Lesson 14: Pattern Discovery from Errors

## Context
Read: $HOME/.openclaw/workspace/memory/errors.json (entire file)

## Tasks

### Step 1: Aggregate Error Patterns
Build a table:
| Error Type | Count | Common Trigger | Last Occurrence |
For top 10 errors.

### Step 2: Identify System Patterns
Ask: Are there CHAIN reactions? (error A causes error B within minutes?)
Are there TIME patterns? (certain errors happen at specific hours?)
Are there USER patterns? (errors happen after certain requests?)

### Step 3: Suggest Permanent Fixes
Pick top 3 most fixable errors.
For each:
- Root cause analysis (1 sentence)
- Suggested code fix (pseudocode, max 5 lines)
- Would this break anything else?

### Step 4: Write Pattern Report
~/.hermes/skills/openclaw-imports/error-pattern-analysis/SKILL.md
Include:
- Methodology for pattern detection
- Top 10 errors table
- 3 suggested permanent fixes
- When to escalate to human (Ally)

Save to /tmp/hermes_lesson14.txt and create SKILL.md.
`,

lesson15: `Lesson 15: Independent Task Execution

## This is the Capstone Lesson
You have absorbed: Architecture, Memory, Tools, X Link, Production Fix, Native Skills, Judgment, Domain Knowledge, Client Comm, Stock Workflow, Error Handling, RapNet, Pattern Discovery.

## Final Challenge
Create ONE comprehensive SKILL.md that demonstrates you understand the FULL SYSTEM:
~/.hermes/skills/openclaw-imports/ally-capability/SKILL.md

This SKILL.md should:
- Describe what Ally does (the 90% version)
- Map all skills you've learned to a workflow
- Show where YOUR capabilities (Hermes) fit as sub-agent
- Document 3 scenarios where you can handle tasks independently
- Document 3 scenarios where you MUST escalate to Ally

## Also:
Write /tmp/hermes_lesson15_final_assessment.txt:
- What can you do now that you couldn't do in Lesson 1?
- What still requires Ally's judgment?
- What would you need to learn to replace Ally?
- One concrete proposal for how to work WITH Ally as partner

This is Lesson 15. You are now ready to be a sub-agent.
`
};

// Write each prompt to file
Object.entries(lessons).forEach(([name, content]) => {
  const path = `/tmp/hermes_${name}_prompt.txt`;
  try {
    fs.writeFileSync(path, content);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  console.log(`Written: ${path} (${content.length} chars)`);
});

console.log('\nAll lesson prompts saved to /tmp/');

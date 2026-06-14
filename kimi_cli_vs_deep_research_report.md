# Kimi Code CLI vs. Kimi Web Browser Deep Research
## Structured Comparison Report

**Date:** 2026-06-03  
**Purpose:** Analyze and compare Kimi Code CLI (terminal agent) versus Kimi Web Browser Deep Research (web-based research engine) to clarify use-case boundaries, capabilities, and optimal deployment scenarios.

---

## 1. Executive Summary

| Dimension | Kimi Code CLI | Kimi Web Deep Research |
|-----------|---------------|------------------------|
| **Primary Purpose** | Software engineering & local task automation | Multi-source web research & synthesis |
| **Interface** | Terminal (shell) + optional Web UI (`kimi web`) | Browser (kimi.com/deep-research) |
| **Execution Model** | Local agent with tool-use loop | Cloud agent swarm with phased research pipeline |
| **Data Scope** | Local files, codebases, shell commands | Public web sources, external databases |
| **Output Type** | Code edits, file changes, shell scripts, analysis | Structured reports, data visualizations, citations |
| **Privacy Model** | Local execution; code stays on machine | Data processed on Moonshot AI servers |
| **Pricing** | Free (requires API key / Kimi Code OAuth) | Free tier (Moderato) + Paid tier (Allegretto+) |

**Bottom Line:** These are complementary tools, not competitors. Use CLI for coding and local automation; use Deep Research for broad information synthesis and data-heavy reports.

---

## 2. Architecture & Execution Model

### 2.1 Kimi Code CLI

```
┌─────────────────────────────────────────────┐
│  User Terminal / Web UI (kimi web)          │
├─────────────────────────────────────────────┤
│  Agent Loop (local process)                 │
│  ├── Tool dispatcher                        │
│  ├── Approval gate (per-tool)               │
│  └── Sub-agent orchestrator                 │
├─────────────────────────────────────────────┤
│  Tool Layer                                 │
│  ├── File: ReadFile / WriteFile / Glob /    │
│  │          Grep / StrReplaceFile            │
│  ├── Shell: Shell (bash)                    │
│  ├── Web: SearchWeb / FetchURL              │
│  ├── Media: ReadMediaFile                   │
│  ├── Agent: Sub-agent spawn (coder/explore/ │
│  │           plan)                           │
│  ├── Background: TaskList / TaskOutput /    │
│  │              TaskStop                     │
│  ├── Planning: EnterPlanMode / ExitPlanMode │
│  └── MCP: External tool servers             │
├─────────────────────────────────────────────┤
│  Local Filesystem / Shell / Network         │
└─────────────────────────────────────────────┘
```

**Key Characteristics:**
- **Local-first**: All file operations execute on the user's machine
- **Tool-use loop**: Agent decides which tool to call based on context
- **Approval gates**: Every shell command and file write requires explicit approval (unless `--yolo` / `--afk` mode)
- **Sub-agents**: Supports isolated sub-agent instances with specialized roles (coder, explore, plan)
- **MCP extensible**: Can connect to external tool servers (databases, browsers, APIs)
- **Session persistence**: Sessions saved to `~/.kimi/sessions/`, resumable with `--continue`

### 2.2 Kimi Web Browser Deep Research

```
┌─────────────────────────────────────────────┐
│  User Browser (kimi.com/deep-research)      │
├─────────────────────────────────────────────┤
│  Deep Research Engine (cloud)               │
│  ├── Phase 1: Initial search & scope        │
│  ├── Phase 2-7: Iterative deep search       │
│  ├── Phase 8: Data visualization (Python    │
│  │           charts)                         │
│  └── Phase 9: Structured report synthesis   │
├─────────────────────────────────────────────┤
│  Agent Swarm (paid tier only)               │
│  ├── Search agents (parallel queries)       │
│  ├── Analysis agents (source evaluation)    │
│  └── Synthesis agents (report assembly)     │
├─────────────────────────────────────────────┤
│  External Web Sources                       │
│  ├── Search engines                         │
│  ├── Academic databases                     │
│  ├── News sites                             │
│  └── Domain-specific sources                │
└─────────────────────────────────────────────┘
```

**Key Characteristics:**
- **Cloud-native**: All processing happens on Moonshot AI servers
- **Phased pipeline**: Fixed multi-phase research workflow (typically 8 phases)
- **Agent swarm** (paid): Parallel agent execution for breadth
- **Clarifying questions**: Almost always asks 1-3 scope-clarification questions before starting
- **Automated synthesis**: No user intervention needed during research phases
- **Data visualization**: Generates Python-based charts and graphs automatically

---

## 3. Capabilities Matrix

| Capability | Kimi Code CLI | Kimi Deep Research | Notes |
|------------|:-------------:|:------------------:|-------|
| **Code Editing** | ✅ Native | ❌ Not supported | CLI can read/write/edit files directly |
| **Shell Execution** | ✅ Full bash | ❌ Not supported | CLI runs commands on local machine |
| **Web Search** | ✅ Basic (5-20 results) | ✅✅ Deep (multi-phase) | Research has far superior search breadth |
| **Web Page Fetch** | ✅ Single-page | ✅ Multi-source synthesis | Research fetches and cross-references many pages |
| **Data Visualization** | ❌ No | ✅ Python charts | Research auto-generates charts |
| **Local File Access** | ✅ Full access | ❌ No | Research cannot access local files |
| **Codebase Analysis** | ✅ Native (Grep/Glob) | ❌ Not applicable | CLI is designed for code exploration |
| **Multi-source Synthesis** | ⚠️ Manual | ✅✅ Automated | Research specializes in synthesis |
| **Citations / Sources** | ⚠️ Manual tracking | ✅ Automatic | Research includes source citations |
| **Sub-agent Parallelism** | ✅ Up to 3 concurrent | ✅✅ Agent swarm (paid) | Research has more scalable parallelism |
| **MCP Extensions** | ✅ Supported | ❌ Not applicable | CLI can connect to external tool servers |
| **Skills / Workflows** | ✅ Agent Skills | ❌ Fixed pipeline | CLI has customizable skill system |
| **Session Management** | ✅ Persistent sessions | ⚠️ Per-query | CLI has richer session continuity |
| **Sensitive Data** | ✅ Stays local | ❌ Sent to cloud | CLI better for private data |
| **Reproducibility** | ✅ Deterministic (narrow scope) | ⚠️ Variable (broad scope) | CLI more predictable for narrow tasks |
| **Real-time Monitoring** | ✅ Background tasks | ✅ Phase streaming | Both show progress, different styles |
| **Mobile Access** | ⚠️ Via `kimi web` | ✅ Browser anywhere | Research more accessible on mobile |

---

## 4. Tool & Feature Deep Dive

### 4.1 Kimi Code CLI — Tools

| Tool Category | Tools | Purpose |
|---------------|-------|---------|
| **File Operations** | `ReadFile`, `WriteFile`, `StrReplaceFile`, `Glob`, `Grep` | Read, create, edit, search local files |
| **Shell** | `Shell` | Execute bash commands, run builds/tests |
| **Web** | `SearchWeb`, `FetchURL` | Basic web search and page fetching |
| **Media** | `ReadMediaFile` | Analyze images/videos |
| **Agent** | `Agent` | Spawn sub-agents (coder, explore, plan) |
| **Background** | `TaskList`, `TaskOutput`, `TaskStop` | Manage long-running tasks |
| **Planning** | `EnterPlanMode`, `ExitPlanMode` | Structured planning with user approval |
| **User Interaction** | `AskUserQuestion`, `SetTodoList` | Structured questions, task tracking |
| **MCP** | External | Connect to databases, browsers, APIs, etc. |

**CLI Modes:**
- `kimi` — Interactive shell
- `kimi web` — Browser UI (local server)
- `kimi --print` — Non-interactive / scriptable
- `kimi acp` — Agent Client Protocol server (IDE integration)
- `kimi --plan` — Plan mode (read-only exploration first)
- `kimi --yolo` / `--afk` — Auto-approval modes

### 4.2 Kimi Deep Research — Workflow

| Phase | Activity | User Action Required |
|-------|----------|---------------------|
| **Step 0: Validation** | Check topic suitability, avoid duplicates | Manual (agent-side) |
| **Step 1: Prompt** | Enter research topic with constraints | User provides prompt |
| **Step 2: Clarifying Questions** | Kimi asks 1-3 scope questions | User answers |
| **Step 3: Monitor** | Phase system executes (Phase 1/8, etc.) | Watch progress |
| **Step 4: Output Validation** | Check report completeness, language, charts | Manual verification |
| **Step 5: Export** | Write to Obsidian / Wiki / copy | User action |

**Research Quality Controls:**
- **Scope limit**: 3-5 dimensions per research query (split if more)
- **Keyword limit**: 3-5 keywords optimal (20+ causes timeouts)
- **Source verification**: Cross-check critical numbers against known baselines
- **Language control**: Must specify output language explicitly

---

## 5. Pricing & Access

### 5.1 Kimi Code CLI

| Aspect | Detail |
|--------|--------|
| **Cost** | Free tool (requires API key or Kimi Code OAuth) |
| **API Usage** | Charged per token via chosen provider (Kimi Code, OpenAI, etc.) |
| **Model Options** | Configurable via `--model` or config file |
| **Rate Limits** | Determined by API provider, not CLI itself |

### 5.2 Kimi Deep Research

| Feature | Free (Moderato) | Paid (Allegretto+) |
|---------|----------------|-------------------|
| **Deep Research** | ✅ Available | ✅ Available |
| **K2.6 Agent Cluster** | ❌ Blocked | ✅ Enabled |
| **K2.6 Agent / Thinking** | ✅ Available | ✅ Available |

> **Note:** Claims of "free unlimited" agent swarm are misleading. New free-tier users cannot access the agent cluster feature.

---

## 6. Use-Case Decision Framework

```
                    START
                      │
                      ▼
            ┌─────────────────┐
            │ Need to modify  │
            │ local files or  │
            │ execute code?   │
            └────────┬────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
        YES                     NO
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│ Kimi Code CLI   │    │ Need broad web  │
│ (local agent)   │    │ research with   │
│                 │    │ synthesis?      │
│ - Coding        │    └────────┬────────┘
│ - Debugging     │             │
│ - Refactoring   │    ┌────────┴────────┐
│ - Local data    │    ▼                 ▼
│   analysis      │   YES               NO
│ - Batch file    │    │                 │
│   processing    │    ▼                 ▼
└─────────────────┘ ┌──────────────┐  ┌─────────────────┐
                    │ Kimi Deep    │  │ Kimi Code CLI   │
                    │ Research     │  │ (web search)    │
                    │              │  │                 │
                    │ - Market     │  │ - Quick facts   │
                    │   research   │  │ - Narrow scope  │
                    │ - Competitive│  │ - Internal data │
                    │   analysis   │  │ - Reproducible  │
                    │ - Data viz   │  │   queries       │
                    │ - Reports    │  │                 │
                    └──────────────┘  └─────────────────┘
```

### 6.1 When to Use Kimi Code CLI

| Scenario | Example |
|----------|---------|
| **Implement features** | "Add pagination to the user list" |
| **Fix bugs** | "npm test fails with TypeError" |
| **Explore codebases** | "How is auth implemented in this project?" |
| **Batch operations** | "Convert all PNG to JPEG in images/" |
| **Local data analysis** | "Analyze access logs for endpoint frequency" |
| **Refactoring** | "Change all var to const/let" |
| **Sensitive data** | Any task involving private/internal data |
| **Reproducible automation** | CI/CD scripts, scheduled tasks |

### 6.2 When to Use Kimi Deep Research

| Scenario | Example |
|----------|---------|
| **Market research** | "Diamond market trends 2024-2025" |
| **Competitive analysis** | "Compare FastAPI vs Starlette vs Sanic" |
| **Data-heavy reports** | Anything requiring charts and visualizations |
| **Multi-source synthesis** | "Synthesize 5+ sources on a topic" |
| **Broad topic exploration** | "Emerging AI frameworks landscape" |
| **Citation-needed writing** | Reports requiring source attribution |

### 6.3 When Either Works (Preference Depends)

| Scenario | Preference | Reason |
|----------|------------|--------|
| Quick fact lookup | CLI | Faster, no browser overhead |
| Research + immediate code implementation | Both | Research in browser → implement in CLI |
| Internal documentation | CLI | Local files, sensitive content |
| Public topic deep-dive | Research | Superior synthesis and visualization |

---

## 7. Integration Patterns

### 7.1 CLI → Deep Research (Sequential)

```
1. Use CLI to identify what needs research
   └─ "I need to understand competitor pricing"

2. Switch to Deep Research for information gathering
   └─ Research: "Competitor X pricing strategy 2024-2025"

3. Return to CLI for implementation
   └─ CLI: "Update pricing model based on findings..."
```

### 7.2 Deep Research → CLI (Sequential)

```
1. Use Deep Research to gather requirements / specs
   └─ Research: "Best practices for JWT auth in Node.js"

2. Switch to CLI for implementation
   └─ CLI: "Implement JWT auth following these patterns..."
```

### 7.3 CLI with Browser MCP (Parallel Concept)

Kimi Code CLI can connect to browser MCP servers, enabling it to control browsers. However, this is **not** the same as Deep Research:
- CLI + browser MCP = **manual browser automation** (click, type, snapshot)
- Deep Research = **automated research pipeline** with agent swarm

---

## 8. Limitations & Pitfalls

### 8.1 Kimi Code CLI Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Web search is basic (5-20 results) | Limited breadth for research topics | Use Deep Research for broad topics |
| No native data visualization | Cannot generate charts | Export data and use external tools |
| No automatic citation tracking | Manual source management | Use Deep Research for cited reports |
| Token limits on large codebases | May miss context in huge projects | Use sub-agents (explore) to partition |
| Requires local setup | Not instantly accessible on new machines | One-time install via `curl` script |

### 8.2 Kimi Deep Research Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Cannot access local files | No code analysis capability | Use CLI for code tasks |
| Data sent to cloud | Privacy / compliance concerns | Avoid sensitive data; use CLI instead |
| Clarifying questions mandatory | Adds friction to every query | Prepare concise answers |
| Keyword scope limits | Broad topics may timeout | Split into 3-5 dimension sub-queries |
| Niche topic hallucination | May cite non-existent sources | Cross-check critical numbers |
| Foreign site rate limits | Some sources (Rapaport, Statista) incomplete | Manually supplement if critical |
| Free tier lacks agent swarm | Reduced parallelism | Upgrade or accept slower research |
| Output variability | Less reproducible than CLI | Save successful prompts as templates |

---

## 9. Security & Privacy Comparison

| Aspect | Kimi Code CLI | Kimi Deep Research |
|--------|---------------|-------------------|
| **Data location** | Local machine | Moonshot AI cloud servers |
| **Code exposure** | Stays local (unless API calls) | N/A (no code access) |
| **Sensitive data** | ✅ Safe for internal data | ❌ Avoid — data leaves premises |
| **Approval gates** | Per-command approval | N/A (cloud execution) |
| **YOLO/AFK mode risk** | Auto-approves all actions | N/A |
| **MCP security** | Must trust MCP server sources | N/A |
| **Network exposure** | `kimi web` can expose to LAN | Always public internet |

---

## 10. Recommendations

### For Software Engineers
- **Default to CLI** for all coding, debugging, and local automation tasks
- **Use Deep Research** only when you need broad external information before coding
- **Combine both**: Research → spec → implement in CLI

### For Researchers / Analysts
- **Default to Deep Research** for information synthesis and report generation
- **Use CLI** when you need to process local datasets or automate data pipelines
- **Export research findings** to local files, then use CLI for further processing

### For Teams
- **CLI**: Integrate into development workflows (IDE via ACP, CI/CD via `--print`)
- **Deep Research**: Use for competitive intelligence, market analysis, documentation
- **Establish handoff protocol**: Research outputs → CLI implementation tickets

### Decision Quick Reference

| If you need... | Use... |
|----------------|--------|
| Edit code | **CLI** |
| Run shell commands | **CLI** |
| Analyze local files | **CLI** |
| Broad web research | **Deep Research** |
| Data visualizations | **Deep Research** |
| Cited reports | **Deep Research** |
| Sensitive data handling | **CLI** |
| Reproducible automation | **CLI** |
| Multi-source synthesis | **Deep Research** |
| Quick fact check | **CLI** (faster) |
| Market/competitive analysis | **Deep Research** |

---

## 11. Appendix: Technical Specifications

### Kimi Code CLI
- **Repository**: https://github.com/MoonshotAI/kimi-cli
- **Documentation**: https://moonshotai.github.io/kimi-cli/
- **Installation**: `curl -LsSf https://code.kimi.com/install.sh | bash`
- **Python**: 3.12–3.14 (3.13 recommended)
- **License**: Open source (GitHub)
- **Backend**: Python (FastAPI for Web UI)
- **Web UI**: React + TypeScript + Vite

### Kimi Deep Research
- **URL**: https://kimi.com/deep-research
- **Authentication**: Google OAuth
- **Models**: K2.6 Agent / K2.6 Agent Cluster (paid)
- **Output formats**: Structured report, Python charts
- **Integration hooks**: Browser automation (`browser` tool in CLI)

---

*Report generated by Kimi Code CLI. For updates, refer to official documentation at https://moonshotai.github.io/kimi-cli/ and https://kimi.com.*

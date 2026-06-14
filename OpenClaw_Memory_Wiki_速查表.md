# OpenClaw 2026.4.8 Memory/Wiki 速查表

## 🚀 快速開始

```bash
# 1. 啟用 plugin
openclaw plugins enable memory-wiki
openclaw gateway restart

# 2. 初始化
openclaw wiki init

# 3. 攝取內容
openclaw wiki ingest --inputPath ./doc.md --title "My Doc"

# 4. 編譯
openclaw wiki compile
```

---

## 📋 核心命令

### Wiki 管理
| 命令 | 說明 |
|------|------|
| `openclaw wiki init` | 初始化 vault |
| `openclaw wiki compile` | 編譯生成 digest |
| `openclaw wiki status` | 查看狀態 |
| `openclaw wiki lint` | 品質檢查 |

### 搜索
| 命令 | 說明 |
|------|------|
| `openclaw wiki search "keyword"` | 搜索 wiki |
| `openclaw memory search "keyword"` | 搜索記憶 |
| `openclaw wiki search "k" --corpus all` | 聯合搜索 |

### REM Preview
| 命令 | 說明 |
|------|------|
| `openclaw memory rem-harness` | 預覽 REM |
| `openclaw memory rem-harness --json` | JSON 輸出 |
| `openclaw memory promote-explain "key"` | 解釋候選 |
| `openclaw memory promote --apply` | 應用推廣 |

---

## 🌙 Dreaming 配置

```json
{
  "dreaming": {
    "enabled": true,
    "frequency": "0 3 * * *",
    "phases": {
      "light": { "enabled": true, "lookbackDays": 2 },
      "rem": { "enabled": true, "lookbackDays": 7, "minPatternStrength": 0.75 },
      "deep": { "enabled": true, "minScore": 0.8, "minRecallCount": 3 }
    }
  }
}
```

---

## 📝 Claim 格式

```markdown
- [claim::id] Claim text
  - status: supported|contested|refuted|superseded
  - confidence: 0.92
  - freshness: fresh|aging|stale
  - evidence:
    - source: path/to/file.md
      quote: "exact quote"
```

---

## 🟢 Freshness 等級

| 等級 | 時間 | 標記 |
|------|------|------|
| fresh | < 7 日 | 🟢 |
| aging | 7-30 日 | 🟡 |
| stale | > 30 日 | 🔴 |

---

## ⚡ 常用工作流

### 場景 1：預覽 REM 結果（唔寫入）
```bash
openclaw memory rem-harness --json
```

### 場景 2：檢查並應用推廣
```bash
# 檢查
openclaw memory promote --limit 10

# 應用
openclaw memory promote --apply
```

### 場景 3：每日維護
```bash
openclaw wiki bridge import
openclaw wiki compile
openclaw wiki lint
```

### 場景 4：矛盾檢測
```bash
openclaw wiki search "topic"
openclaw wiki lint
openclaw wiki get --lookup "claim-id"
```

---

## 📁 重要路徑

| 路徑 | 內容 |
|------|------|
| `.openclaw-wiki/` | Wiki vault |
| `.openclaw-wiki/cache/agent-digest.json` | Compiled digest |
| `memory/dreaming/DREAMS.md` | Dream 報告 |
| `memory/l0-abstract/` | L0 摘要 |
| `memory/l1-overview/` | L1 摘要 |

---

## 🔧 故障排除

| 問題 | 解決 |
|------|------|
| Plugin 唔載入 | `openclaw gateway restart` |
| Compile 失敗 | `openclaw wiki compile --full` |
| 搵唔到內容 | 檢查 `--corpus all` |
| Digest 過期 | 重新 `openclaw wiki compile` |

---

*快速參考 | 2026.4.8*

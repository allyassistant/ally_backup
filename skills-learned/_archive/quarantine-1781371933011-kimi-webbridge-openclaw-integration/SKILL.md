---
name: kimi-webbridge-openclaw-integration
description: 將 Kimi WebBridge Chrome extension + local daemon 整合入 OpenClaw，透過 CDP 控制現有瀏覽器 profile 以 bypass login wall。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T17:31:01.238Z
---

## Overview

Kimi WebBridge 係 Moonshot AI 出嘅瀏覽器 extension + local daemon 組合，透過 Chrome DevTools Protocol (CDP) 操控你**已登入**嘅瀏覽器 profile。最大價值：自動繼承所有 login session（X、LinkedIn、Gmail），解決 AI tool 常見嘅 login wall 問題。

OpenClaw 官方已支援 WebBridge (`kimi-webbridge install-skill` 會自動 inject skill file)。

## Workflow

### Phase 1: Install WebBridge Daemon

1. **Download and run official install script**:
   ```bash
   curl -fsSL https://kimi-webbridge.com/install.sh | bash
   ```
   安裝位置：`~/.kimi-webbridge/bin/kimi-webbridge`

2. **Start daemon** (install script 會自動啟動):
   ```bash
   ~/.kimi-webbridge/bin/kimi-webbridge daemon
   ```

3. **Verify daemon is running**:
   ```bash
   ~/.kimi-webbridge/bin/kimi-webbridge status
   ```
   預期輸出包含 `Daemon: vX.X.X ✅ running (port 10086)` 和 `Uptime: Xs`

### Phase 2: Install OpenClaw Skill

4. **Trigger OpenClaw skill installation**:
   ```bash
   ~/.kimi-webbridge/bin/kimi-webbridge install-skill
   ```
   會自動 inject skill file 到 `~/.openclaw/skills/kimi-webbridge/SKILL.md`

5. **Verify skill installed**:
   ```bash
   ls -la ~/.openclaw/skills/kimi-webbridge/
   cat ~/.openclaw/skills/kimi-webbridge/SKILL.md
   ```

### Phase 3: Install Chrome Extension

6. **Install extension in your Chrome** (需在你日常使用嘅 Chrome，唔係 server headless browser):
   - 打開 <https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc>
   - Click「Add to Chrome」
   - 按提示確認安裝

7. **Verify extension connected to daemon**:
   ```bash
   ~/.kimi-webbridge/bin/kimi-webbridge status
   ```
   預期輸出：`Extension: vX.X.X ✅ connected (fldmhceldgbpfpkbgopacenieobmligc)`

### Phase 4: Test X.com Login Wall Bypass (Optional POC)

8. **Test WebBridge navigate command**:
   透過 OpenClaw skill 執行 WebBridge navigate到你嘅 X session 測試:
   - 確認可以自動打開 X.com 並讀取已登入狀態嘅內容
   - 確認繞過 login wall

## Architecture

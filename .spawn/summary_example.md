# X Link / Article Analysis — Summary Example

呢個係合格既 Discord summary 範例（~500 字），用 @justhalfbit 篇 Ghostty 做例：

---

半格/HalfBit (@justhalfbit) 分享由 iTerm2 + oh-my-zsh 遷移至 Ghostty + Starship + 獨立 zsh 插件既完整方案。6.7 萬 views，844 bookmarks，有一鍵安裝 script。

**核心轉變：唔用重型 framework，用 modular 組件**
oh-my-zsh 框架本身要 load 300+ plugins 先啟動到，每次開新 window 都卡。作者拆咗做三層互不依賴既組件。每個只做好一件事。

**1. Ghostty 取代 iTerm2**
Zig 寫既終端模擬器，GPU 加速。冷啟動 <0.5 秒，iTerm2 要等。配置係單一純文字檔，改完 ⌘+Shift+, 即刻生效唔使重啟。支援半透明毛玻璃、Catppuccin Mocha theme、Maple Mono NF 字體。

**2. Starship 取代 oh-my-zsh themes**
Rust 寫既跨平台提示符。彩虹漸變色塊：紅(用戶)→橙(路徑)→黃(Git分支)→綠(語言版本)→紫(時間)。作者加咗換行（資訊行同 command 行分開），Git 狀態實時顯示（未 commit？提示符直接見到）。

**3. 五個 CLI 工具**
- fzf（最推薦）：Ctrl+R 模糊搜歷史命令，cd ** Tab 補全程徑
- zoxide：z + 幾個字母跳到常用目錄，用得越多越準
- eza/bat：替代 ls/cat，有顏色有語法高亮
- yazi：終端檔案管理器，三欄佈局全鍵盤操作

**啟發：**
Modular 取代 monolithic 既思維同我地既 tool philosophy 一致 — oh-my-zsh 就好似一個大 framework 管理你既 shell，但你根本唔需要 framework，獨立 plugin 做好一件事就夠。

---

## 進階：同一篇文既 Obsidian 版本（~900 字）

Obsidian note 同 Discord summary 用同一 content，但深度唔同。加咗：code/config snippet、technical detail、更多 cross-links。

```markdown
# 半格/HalfBit - Ghostty 終端配置 + 5現代CLI工具
Category: Tech | Type: reference
Tags: macos,terminal,cli,developer-tools,productivity
Links: [[Vox - Minimal AI Loop]], [[Alfred Workflow MacOS]]

半格 (@justhalfbit) 分享由 iTerm2 + oh-my-zsh 遷移至 Ghostty + Starship 既完整方案。6.7萬 views，844 bookmarks。

## 三層架構（互不依賴）
Ghostty（終端）+ Starship（提示符）+ zsh+3插件（shell增強）。

### Ghostty
Zig 寫既新一代終端模擬器。啟動 <0.5 秒，GPU 加速。
單一純文字 config（~/.config/ghostty/config），改完 ⌘+Shift+, reload。
iTerm2 強項：profile system、triggers、tmux integration。
但大部分用唔到，Ghostty 做終端本份做得更好。

### Starship
Rust 寫，跨平台。作者用 catppuccin-powerline preset，加咗換行。
Git 狀態實時顯示：未 commit / 未 push 提示符直接見到，唔使 git status。

### zsh Plugins（無 oh-my-zsh）
- zsh-autosuggestions：灰色歷史建議，→接受
- zsh-syntax-highlighting：未 Enter 已 show 對錯
- zsh-completions：git checkout Tab 列 branch

## 五個 CLI Tools
- **fzf**：Ctrl+R 搜歷史，** Tab 補全程徑，kill ** Tab 列 process
- **zoxide**：z + 字母跳到目錄，自動 decay 權重
- **eza**：替代 ls，alias ls/ll/lt
- **bat**：替代 cat，語法高亮
- **yazi**：三欄終端檔案管理器，全鍵盤操作

## 一鍵安裝
bash <(curl -fsSL https://raw.githubusercontent.com/justhalfbit/ghostty-terminal-config/main/install.sh)

## 啟發
同我地用既 tool philosophy 一致 — modular > monolithic framework。oh-my-zsh 像一個大 framework 管理 shell，但你唔需要 framework，獨立 plugin 做好一件事就夠。

Starship config 思路（base preset + 自己 tune）同 AGENTS.md 既 template + 自訂 rule 類似。
```

## Why this example works

| 標準 | Discord (~500字) | Obsidian (~900字) |
|------|-----------------|------------------|
| 開首一句總結 | ✅ 有 | ✅ 有 |
| 3-5 核心觀點 | ✅ 夠 | ✅ 更深入每個觀點 |
| 拎走 marketing | ✅ 有 | ✅ 有 |
| Connect workflow | ✅ 1-2 條 | ✅ 3-5 條 cross-links |
| Technical detail | ❌ 斬咗 | ✅ 有 Ghostty config path、Starship preset name、fzf ** Tab 用法 |
| 長度 | 300-800 字 | 500-1500 字 |
| 廣東話 bullet | ✅ | ✅ |

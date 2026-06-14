# Discord Channels Log — 2026-05-30

## #🤖一般 (1473343330170572904)

- **joshua_chan0209**: 收唔收到
- **Ally Assistant**: 收到 👍 清清楚楚
- **joshua_chan0209**: Testing
- **Ally Assistant**: 測試收到 👍
- **joshua_chan0209**: 啱啱set咗plugin inject tag，而家你係唔係每一句都睇到我講嘢內容前面有tag
- **Ally Assistant**: 唔見有喎。你啱啱send過嚟嘅message text淨係得「啱啱set咗plugin inject tag…」呢句，前面冇tag prefix。可能要check下plugin config先知道點解冇生效。
- **joshua_chan0209**: 而家呢？
- **Ally Assistant**: 比上次多咗啲metadata：Conversation info多咗inbound_event_kind，Sender block有你嘅id/name/username/tag，Discord channel metadata block有topic。但message content依然冇tag prefix。
- **joshua_chan0209**: 已經解決咗
- **Ally Assistant**: ✅ 見到了！而家每句都有清晰嘅 metadata 睇到。開咗 topic 同 sender info 都 expose 咗，路由準確度高好多 👍

## #💼工作 (1473383064565710929)

- **Ally Assistant**: 我覺得可以保留，呢句唔係 instructions（叫我手動加），而係**描述 tool 嘅行為**（mail_tool.js 會自動 append），對我嚟講係有用嘅 reminder 唔好重覆寫 signature。你點睇？
- **joshua_chan0209**: 咁keep住佢先
- **Ally Assistant**: 👍 keep 住先
- **joshua_chan0209**: 不過以後唔好自己send email出去
- **Ally Assistant**: 明白，以後 email 一律 draft mode 唔加 `--send`，俾你睇完你自己喺 Mail.app 搞掂 👍
- **joshua_chan0209**: 更正：以後都喺Discord比我睇咗你寫咗咩先，然後我話可以send先send
- **Ally Assistant**: 明白，新流程：1. 你喺 Discord 話我知 email 內容（廣東話）2. 我寫好英文 draft，post 喺呢個 **#💼工作** channel 3. 你睇完話可以 send 4. 我先用 `--send` 送出。唔會再自己偷步 send 出去 👍
- **Ally Assistant**: 📬 新郵件通知 — Arnold補充話nano-texture螢幕有防反光效果，適合長時間Office工作。另外佢再解釋Apple Business唔止係branding，仲有device management功能。
- **Ally Assistant**: 🧪 測試推送 — Mail monitor fix test - 如果見到呢個 msg 代表 fix 成功 ✅
- **Ally Assistant**: 📬 新郵件通知 — Anjali Diamonds 邀請：JCK Las Vegas 第二日，佢哋喺紐約 47 街嘅辦公室歡迎預約會議，想約嘅可以 book meeting。

## #🧑🏻‍💻編程 (1473384999003619500)

- **joshua_chan0209**: bliss 唔係 共用同一份 workspace filesystem
- **Ally Assistant**: 你啱，我錯。Bliss 唔 share filesystem — 兩部獨立 Mac mini，經 Tailscale SSH 溝通。如果兩部都開 wiki bridge 理論上可以互bridge，但實際上 Bliss 係 backend worker，有冇 wiki plugin enabled？你想 check 下 Bliss 有冇行緊 wiki？
- **joshua_chan0209**: 應該冇，因為我冇叫佢開
- **Ally Assistant**: 咁即係 bridge mode 同 isolated mode 對你嚟講**完全一樣** — Bliss 冇 wiki，冇嘢可以 bridge。唯一分別係 cron job 唔會再 error。
- **joshua_chan0209**: 咁01:00 嗰個wiki Cron job 同wiki bridge有咩分別
- **Ally Assistant**: 00:40 Wiki Bridge Import → 匯入跨instance memory artifacts，你得一部機所以 import 0 條。01:00 Wiki Daily Ingest → 匯入 MEMORY.md + 今日 L0 + L1，你每日都用到。
- **Ally Assistant**: 對比表格：Bridge Import 匯入其他 instance 嘅 memory（對你用唔到），Daily Ingest 匯入 MEMORY.md + 今日摘要（每日用到）。
- **joshua_chan0209**: 先暫停咗00:40 嘅wiki bridge
- **Ally Assistant**: 已暫停。今晚 00:40 唔會再 run。
- **joshua_chan0209**: 我上網查咗話：OpenClaw 嘅 Wiki Bridge 功能，喺部署同使用上其實**兩邊都得**，主要取決於你嘅開發環境同埋項目規模。不過最常見嘅玩法係**「本地運行（一部機用）＋遠端/雲端文檔同步」**嘅混合模式。

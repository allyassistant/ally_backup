```skills-learned/cron-failure-investigation/references/umbrella-consolidation-llm-fallback.md
# Weekly Correction Loop — LLM Fallback Chain 詳解

## 觸發位置

`scripts/lib/umbrella_consolidation.js:120`

```js
const cmd = `openclaw agent --local --json --model minimax-portal/MiniMax-M2.7 --message "$(cat ${tmpFile})" --thinking high 2>/dev/null`;

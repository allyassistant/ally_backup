# Script Inventory for Tools Reference

## Reference: Core Scripts Table

This file records the current state of each script referenced in tools-reference/SKILL.md.
Use `node scripts/verify_edit.js <script>` after any modification.

| Script | Purpose | Category | Dependencies | Testable |
|--------|---------|----------|-------------|----------|
| `scripts/mail_tool.js` | Apple Mail read/compose/reply | Communication | `lib/config.js` | Partial |
| `scripts/mail_monitor.js` | Auto-email monitoring → Discord | Communication | AppleScript, Discord | No |
| `scripts/stock_updater.js` | Stock list updates | Business | None | Yes |
| `scripts/stock_merge_pro.js` | Multi-sheet Excel merge | Business | ExcelJS | Yes |
| `scripts/code_quality_manager.js` | Code quality scanning | DevOps | Node built-ins | Yes |
| `scripts/write_to_obsidian.js` | Obsidian note writer | Knowledge | `lib/config.js` | Yes |
| `scripts/weekly_correction_loop.js` | Weekly behavior correction | DevOps | Multiple libs | Partial |
| `scripts/spawn_config.js` | Sub-agent config | System | `router/model_router.js` | Yes |

## Maintenance

When adding a new script to the tools-reference SKILL.md:
1. Add it to this inventory
2. Run `node scripts/code_quality_manager.js scan --quiet` to ensure it meets quality standards
3. Update the inline table in SKILL.md to match this reference

## Health Check

Run weekly:
```bash
for s in $(rg -oP '(?<=node scripts/)[a-z_]+\.js' ~/.openclaw/workspace/skills/tools-reference/SKILL.md); do
  [ -f "scripts/$s" ] && echo "✅ $s" || echo "❌ $s MISSING"
done
```

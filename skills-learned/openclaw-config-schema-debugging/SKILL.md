---
name: openclaw-config-schema-debugging
description: "Diagnose and work around OpenClaw's strict JSON schema config validation traps including additionalProperties:false blocks. Use when: config rejected by schema, additionalProperties:false blocks new field, env var workaround needed. Key capabilities: schema error trace, env var alternatives, dist JS patching."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T16:31:00+08:00
---

# OpenClaw Config Schema Debugging

## Workflow

1. **Confirm the symptom** — When you add a new config field to `openclaw.json` (e.g., `agents.defaults.fallbackNoticeMode: "silent"` or a field in a plugin config) and:
   - `openclaw gateway restart` (SIGUSR1) fails silently or returns an error
   - The gateway restarts but your field is **missing** on re-read
   - `openclaw doctor` fixes the config by stripping your field
   → **Suspect schema rejection**.

2. **Inspect the config schema** — OpenClaw validates `openclaw.json` against a JSON schema that uses `additionalProperties: false` on many namespaces:
   ```
   openclaw config.schema.lookup --path agents.defaults
   # or
   openclaw config.schema.lookup
   ```
   Key namespaces with `additionalProperties: false`:
   - `agents.defaults` — most commonly hit
   - `plugins.<name>` — plugin configs
   - `experimental` — even experimental flags are schema-locked
   - Most top-level blocks

   If the response shows `"additionalProperties": false`, any non-declared field will be **silently rejected** on gateway load.

3. **Verify the field was stripped** — After gateway restart, re-read the config file:
   ```bash
   node -e "c=require('/Users/ally/.openclaw/openclaw.json'); console.log(JSON.stringify(c.agents?.defaults, null, 2))"
   ```
   If your custom field is gone, schema validation removed it. This is not a file-write error — OpenClaw removed it at load time and wrote back the cleaned version.

4. **Check if `openclaw doctor` ran** — Bliss may auto-run `openclaw doctor` after a crash, which aggressively strips unknown fields. Check `~/.openclaw/logs/gateway.log` for "config validation" or "schema" entries.

5. **Choose a workaround** — There are three main approaches, in order of preference:

   **A. process.env (preferred)** — Use an environment variable instead of a config field:
   ```js
   // In the JS code that checks the config:
   if (process.env.YOUR_FEATURE_FLAG === "true") { ... }
   ```
   - Add to shell profile: `echo 'export YOUR_FEATURE_FLAG=true' >> ~/.zshrc`
   - **No schema changes needed** — env vars bypass OpenClaw's config validation entirely
   - Restart the gateway after setting: `openclaw gateway restart`
   - Verify: `echo $YOUR_FEATURE_FLAG` and `openclaw gateway status`

   **B. Use an existing allowed field** — If an existing field happens to match your use case (e.g., `commands.silentReply`), reuse it. Schema allows only declared fields.

   **C. Fork/PR to OpenClaw** — Add your field to the OpenClaw core schema and create a PR. This is the proper long-term solution but requires upstream changes.

6. **Apply JS patches to dist files** — For changes that can't be done via config (e.g., modifying runtime behavior of agent-runner or route-enforcer):
   - Locate the target file: `find ~/.openclaw -name "agent-runner.runtime-*.js" -type f`
   - Files in `dist/` are **minified/bundled JS** — editing them requires care:
     ```bash
     node --check ~/.openclaw/dist/path/to/file.js
     ```
   - **Hot reload (SIGUSR1) may not apply dist file edits** — A `openclaw gateway restart` might NOT reload the patched dist file. Always do a **full process restart** (stop + start, or reboot) to ensure the patch is loaded.
   - `openclaw doctor` does NOT revert dist file edits (it only strips unknown config fields) — so the patch persists across doctor runs.
   - The patch WILL be lost during npm updates of OpenClaw. Document the patch location and logic in a memory file or issue so it can be reapplied.

7. **Verify the workaround** — After applying your workaround:
   - Restart the gateway: `openclaw gateway restart`
   - Check gateway status: `openclaw gateway status`
   - Run a test scenario that triggers the affected behavior
   - Check gateway logs for errors related to your change

8. **Document the schema constraint** — Record the finding so future sessions don't repeat the investigation:
   - Update the relevant issue with the schema finding
   - Optionally add a note to MEMORY.md: `"openclaw.json uses additionalProperties: false on agents.defaults, plugin configs, and experimental"`

## Pitfalls

- **`additionalProperties: false` is the DEFAULT enforcement model** — OpenClaw's config schema does not use open-ended objects. Any namespace you find will almost certainly have this constraint. Never assume you can add arbitrary fields.
- **Schema validation is SILENT on individual field removal** — If you add 5 fields and 1 is invalid, the gateway loads without error but the invalid field is silently dropped. You won't know unless you re-read the config file.
- **gateway restart (SIGUSR1) vs full restart** — `openclaw gateway restart` sends SIGUSR1 for hot reload. This does NOT guarantee fresh loading of dist JS files. For dist file edits, use `openclaw gateway stop && openclaw gateway start` or reboot the machine.
- **`openclaw doctor` aggressively strips unknown fields** — If the gateway crashes shortly after you add a config field, Bliss may auto-run doctor which removes your fields. Don't assume the field was written incorrectly — it was removed by doctor.
- **process.env vars are not visible in the config** — When troubleshooting later, someone might look at `openclaw.json` and wonder why a feature isn't working. The env var is invisible in the config file. Always document env var workarounds in the issue or a memory note.
- **Dist file patches are npm-update-fragile** — Any `npm update` or OpenClaw version upgrade will overwrite dist files. The patch must be re-documented and re-applied after updates.
- **Schema lookup vs actual config validation may differ** — The schema returned by `config.schema.lookup` is descriptive; the actual validation may have additional constraints (e.g., `minLength`, `pattern`, `enum`). Check the full schema response before assuming a field type.
- **Don't confuse startup failure with config rejection** — If the gateway fails to start entirely (not just silent field removal), the schema rejection is CRITICAL (missing required field, wrong type). Silent field removal happens for optional/unknown fields only.

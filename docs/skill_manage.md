# skill_manage Tool

The `skill_manage` tool provides agent-controllable skill lifecycle management for OpenClaw. It is registered by the `skill-tools` plugin.

## Registration

Plugin: `~/.openclaw/extensions/skill-tools/`
Tool name: `skill_manage`

## Actions

### 1. `create` — Create a new skill

Creates a directory skill with `SKILL.md` containing frontmatter and body.

**Parameters:**
- `skill_name` (required): kebab-case name (e.g. `my-new-skill`)
- `content` (required): Body of the SKILL.md
- `provenance` (optional): `agent` (default), `bundled`, or `user`

**Example:**
```
skill_manage action=create skill_name="data-validator" provenance=agent content="# Data Validator\n\nValidate CSV/JSON data for formatting errors."
```

**Result:** Creates `skills/data-validator/SKILL.md` with auto-generated frontmatter.

**Security:** Validates skill name against `^[a-z0-9][a-z0-9_-]*[a-z0-9]$` regex.

---

### 2. `patch` — Targeted find-and-replace in SKILL.md or support file

Replaces exact text match in a skill file. Like `edit` but targeted.

**Parameters:**
- `skill_name` (required): Existing skill name
- `file_path` (optional): File within skill dir (default: `SKILL.md`)
- `old_text` (required): Exact text to find
- `new_text` (required): Replacement text

**Example:**
```
skill_manage action=patch skill_name="data-validator" old_text="CSV/JSON" new_text="CSV/JSON/XML"
```

**Result:** Replaces the first occurrence of `old_text` in the specified file.

**Note:** For support files (references/, templates/, scripts/, assets/), `file_path` must be within one of those allowed directories.

---

### 3. `edit` — Full SKILL.md rewrite

Overwrites the entire SKILL.md with new content. Use with care — this replaces everything.

**Parameters:**
- `skill_name` (required): Existing skill name
- `content` (required): New body content

**Example:**
```
skill_manage action=edit skill_name="data-validator" content="# Data Validator v2\n\n...updated instructions..."
```

**Result:** Full rewrite with updated frontmatter (name, description, edited timestamp).

---

### 4. `delete` — Remove a skill

Deletes the skill directory (or flat JS file). Optionally moves support files to an umbrella skill.

**Parameters:**
- `skill_name` (required): Skill to delete
- `absorbed_into` (optional): Umbrella skill name to receive support files

**Example (simple delete):**
```
skill_manage action=delete skill_name="deprecated-skill"
```

**Example (absorb into umbrella):**
```
skill_manage action=delete skill_name="old-data-validator" absorbed_into="data-processing-hub"
```

**Absorption behavior:** When `absorbed_into` is provided, all files from `references/`, `templates/`, `scripts/`, `assets/` are copied to the umbrella skill's corresponding directories (with source skill name prefix). Then the skill directory is removed.

---

### 5. `write_file` — Write/overwrite a support file

Creates or overwrites a support file within a skill directory.

**Parameters:**
- `skill_name` (required): Existing skill name
- `file_path` (required): Path within skill dir (e.g. `references/api-docs.md`)
- `content` (required): File content

**Allowed directories:** `references/`, `templates/`, `scripts/`, `assets/`

**Example:**
```
skill_manage action=write_file skill_name="data-validator" file_path="templates/validation_template.csv" content="id,name,type\n"
```

**Security:** Validates that `file_path` stays within allowed directories and within the skill's base directory (path traversal blocked).

---

### 6. `remove_file` — Remove a support file

Deletes a support file from a skill directory.

**Parameters:**
- `skill_name` (required): Existing skill name
- `file_path` (required): Path within skill dir

**Example:**
```
skill_manage action=remove_file skill_name="data-validator" file_path="templates/old_template.csv"
```

**Security:** Same path validation as `write_file`.

## Skill Directory Structure

Skills live in `~/.openclaw/workspace/skills/`:

```
skills/
├── my-skill/
│   ├── SKILL.md          # Skill definition (frontmatter + body)
│   ├── references/
│   ├── templates/
│   ├── scripts/
│   └── assets/
├── my-js-skill.js         # Flat JS skill (no support files)
└── _archive/              # Archived skills (ignored)
```

## Security Constraints

| Constraint | Rule |
|-----------|------|
| **Path traversal** | All file operations validate paths resolve within the skill base directory. `../` traversal is blocked. |
| **Allowed support dirs** | `write_file` and `remove_file` only work in `references/`, `templates/`, `scripts/`, `assets/`. |
| **Skill name** | Must match `^[a-z0-9][a-z0-9_-]*[a-z0-9]$` (kebab-case). |
| **Provenance auto-set** | If not specified on `create`, provenance defaults to `agent`. |
| **Overwrite prevention** | `create` fails if skill already exists. Use `edit` to replace, or `delete` first. |

## Categorized Skills Injection

The `skill-learner` plugin (same extension) provides a `before_prompt_build` hook that scans both `skills/` and `.learned/skills/` directories, reads `category:` from frontmatter, and injects a categorized list into every prompt:

```
<categorized_skills>
  General:
    - my-skill: brief description
  DevOps:
    - deploy-checklist: Pre-deployment verification
</categorized_skills>
```

This supplements (not replaces) OpenClaw's built-in `<available_skills>` block.

## Cron Job Integration

The `skill_manage` tool is available in the **Skill Reviewer (30min)** cron job (`56e09616-50a3-45c2-89eb-d8c427c56191`) under `toolsAllow`.
This allows the reviewer agent to create, patch, and manage skills during automated review cycles.

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| "Path traversal blocked" | `file_path` contains `..` | Use paths within allowed directories only |
| "Skill not found" | Name mismatch or wrong type | Check `ls ~/.openclaw/workspace/skills/` |
| "Not in allowed directories" | `file_path` starts with wrong dir | Only `references/`, `templates/`, `scripts/`, `assets/` |
| "old_text not found" | Patch text doesn't match exactly | Check whitespace/case in the file |
| Plugin not loading | Path issue | Verify `openclaw plugin list | grep skill-tools` |

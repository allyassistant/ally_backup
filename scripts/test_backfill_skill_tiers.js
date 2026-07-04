#!/usr/bin/env node
/**
 * test_backfill_skill_tiers.js — Phase 2g backfill tests
 *
 * Tests the backfill script against an isolated fixture under /tmp/backfill_test_fixture.
 * Validates: classification rules, idempotency, preservation of existing status.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FIXTURE = '/tmp/backfill_test_fixture';
const SCRIPT = '/Users/ally/.openclaw/workspace/scripts/backfill_skill_tiers.js';

function rmrf(p) {
  let lst;
  try { lst = fs.lstatSync(p); }
  catch (_) { return; }
  if (lst.isDirectory() && !lst.isSymbolicLink()) {
    let entries;
    try { entries = fs.readdirSync(p); }
    catch (_) { return; }
    for (const e of entries) rmrf(path.join(p, e));
    try { fs.rmdirSync(p); }
    catch (_) {}
  } else {
    try { fs.unlinkSync(p); }
    catch (_) {}
  }
}

function resetFixture() {
  rmrf(FIXTURE);
  try {
    fs.mkdirSync(path.join(FIXTURE, 'skills-learned', '_archive'), { recursive: true });
  } catch (e) {
    console.error('Fixture directory creation failed: ' + e.message);
  }
  try {
    fs.mkdirSync(path.join(FIXTURE, 'skills'), { recursive: true });
  } catch (e) {
    console.error('Fixture directory creation failed: ' + e.message);
  }

  // active-skill — no status, will get symlink → active
  const activeDir = path.join(FIXTURE, 'skills-learned', 'active-skill');
  try {
    fs.mkdirSync(activeDir, { recursive: true });
  } catch (e) {
    console.error('Directory creation failed: ' + e.message);
  }
  try {
    fs.writeFileSync(path.join(activeDir, 'SKILL.md'),
      '---\nname: active-skill\ndescription: Active with no status.\n---\n\n## Workflow\n\n1. Step one\n2. Step two\n3. Step three\n\n## Pitfalls\n\n- One\n- Two\n- Three\n');
  } catch (e) {
    console.error('File write failed: ' + e.message);
  }

  // draft-skill — no status, no symlink → draft
  const draftDir = path.join(FIXTURE, 'skills-learned', 'draft-skill');
  try {
    fs.mkdirSync(draftDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(draftDir, 'SKILL.md'),
      '---\nname: draft-skill\ndescription: Draft with no status.\n---\n\n## Workflow\n\n1. Step one\n2. Step two\n3. Step three\n\n## Pitfalls\n\n- One\n- Two\n- Three\n');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }

  // archived-skill — in _archive → archived
  const archDir = path.join(FIXTURE, 'skills-learned', '_archive', 'archived-skill');
  try {
    fs.mkdirSync(archDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(archDir, 'SKILL.md'),
      '---\nname: archived-skill\ndescription: Archived by location.\n---\n\n## Workflow\n\n1. Step one\n2. Step two\n3. Step three\n\n## Pitfalls\n\n- One\n- Two\n- Three\n');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }

  // preserved-draft — already has status: draft → must NOT change
  const presDir = path.join(FIXTURE, 'skills-learned', 'preserved-draft');
  try {
    fs.mkdirSync(presDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(presDir, 'SKILL.md'),
      '---\nname: preserved-draft\ndescription: Already has status.\nstatus: draft\n---\n\n## Workflow\n\n1. Step one\n2. Step two\n3. Step three\n');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }

  // active symlink for active-skill
  fs.symlinkSync(activeDir, path.join(FIXTURE, 'skills', '_learned_active-skill'));
}

function readStatus(skillPath) {
  let c;
  try {
    c = fs.readFileSync(skillPath, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const m = c.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const sm = fm.match(/^status:\s*(.+?)\s*$/m);
  return sm ? sm[1].trim().replace(/^["']|["']$/g, '') : null;
}

function runBackfill() {
  try {
    execFileSync('node', [SCRIPT], {
      cwd: FIXTURE,
      env: { ...process.env, WORKSPACE: FIXTURE },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error(`Command execution failed: ${e.message}`);
  }
}

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('Phase 2g — backfill_skill_tiers.js tests');
console.log('=========================================');

// Test 0 — pure inferTier() unit cases (no I/O)
console.log('\n[Test 0] inferTier() pure-function unit tests');
const { inferTier } = require('/Users/ally/.openclaw/workspace/scripts/backfill_skill_tiers.js');
check('existing status preserved (active)', inferTier('x', false, true, 'active') === 'active');
check('existing status preserved (draft)', inferTier('x', false, false, 'draft') === 'draft');
check('existing status preserved (archived)', inferTier('x', true, false, 'archived') === 'archived');
check('in _archive → archived', inferTier('x', true, false, null) === 'archived');
check('symlink active → active', inferTier('x', false, true, null) === 'active');
check('no symlink, not in archive → draft', inferTier('x', false, false, null) === 'draft');
check('archive wins over symlink (pathological)', inferTier('x', true, true, null) === 'archived');

// Test 1 — first run classifies correctly
console.log('\n[Test 1] First-run classification');
resetFixture();
runBackfill();
const activeStatus = readStatus(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'));
const draftStatus = readStatus(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'));
const archStatus = readStatus(path.join(FIXTURE, 'skills-learned/_archive/archived-skill/SKILL.md'));
const preservedStatus = readStatus(path.join(FIXTURE, 'skills-learned/preserved-draft/SKILL.md'));
check('active-skill → active (symlink)', activeStatus === 'active', `got "${activeStatus}"`);
check('draft-skill → draft (no symlink)', draftStatus === 'draft', `got "${draftStatus}"`);
check('archived-skill → archived (in _archive)', archStatus === 'archived', `got "${archStatus}"`);
check('preserved-draft → unchanged (already had status)', preservedStatus === 'draft', `got "${preservedStatus}"`);

// Test 2 — idempotency: re-running produces no further changes
console.log('\n[Test 2] Idempotency (run twice = no further changes)');
let beforeA;
try {
  beforeA = fs.readFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let beforeD;
try {
  beforeD = fs.readFileSync(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let beforeR;
try {
  beforeR = fs.readFileSync(path.join(FIXTURE, 'skills-learned/_archive/archived-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let beforeP;
try {
  beforeP = fs.readFileSync(path.join(FIXTURE, 'skills-learned/preserved-draft/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}

let secondRunOutput;
try {
  secondRunOutput = execFileSync('node', [SCRIPT], {
    env: { ...process.env, WORKSPACE: FIXTURE },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
} catch (e) {
  secondRunOutput = (e.stdout || '') + (e.stderr || '');
}
let afterA;
try {
  afterA = fs.readFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let afterD;
try {
  afterD = fs.readFileSync(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let afterR;
try {
  afterR = fs.readFileSync(path.join(FIXTURE, 'skills-learned/_archive/archived-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let afterP;
try {
  afterP = fs.readFileSync(path.join(FIXTURE, 'skills-learned/preserved-draft/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
check('active-skill byte-identical', beforeA === afterA);
check('draft-skill byte-identical', beforeD === afterD);
check('archived-skill byte-identical', beforeR === afterR);
check('preserved-draft byte-identical', beforeP === afterP);
check('second-run changed count = 0', /Changed: 0/.test(secondRunOutput),
  `actual output:\n${secondRunOutput}`);

// Test 3 — dry-run does NOT modify files
console.log('\n[Test 3] --dry-run does not modify files');
resetFixture();
let beforeDryA;
try {
  beforeDryA = fs.readFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
let thirdRunOutput;
try {
  thirdRunOutput = execFileSync('node', [SCRIPT, '--dry-run'], {
    env: { ...process.env, WORKSPACE: FIXTURE },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
} catch (e) {
  thirdRunOutput = (e.stdout || '') + (e.stderr || '');
}
let afterDryA;
try {
  afterDryA = fs.readFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
check('active-skill byte-identical after --dry-run', beforeDryA === afterDryA);
const draftStatusAfterDry = readStatus(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'));
check('draft-skill still has NO status after --dry-run', draftStatusAfterDry === null,
  `got "${draftStatusAfterDry}"`);

// Test 4 — failsafe: existing status is preserved (already covered by preserved-draft)
console.log('\n[Test 4] Existing status preserved exactly');
resetFixture();
const preCustomStatus = 'archived';
try {
  fs.writeFileSync(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'),
  `---\nname: draft-skill\nstatus: ${preCustomStatus}\ndescription: Custom status.\n---\n\n## Workflow\n\n1. Step one\n2. Step two\n3. Step three\n\n## Pitfalls\n\n- One\n- Two\n- Three\n`);
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
runBackfill();
const finalStatus = readStatus(path.join(FIXTURE, 'skills-learned/draft-skill/SKILL.md'));
check(`draft-skill with status: ${preCustomStatus} preserved`, finalStatus === preCustomStatus,
  `got "${finalStatus}"`);

// Test 5 — corrupted file (no real frontmatter at line 0; body starts with code fence)
// Real-world case: 4 _archive files are corrupted — they have NO frontmatter at all,
// just an embedded code block containing another skill. The script must FAIL-OPEN
// (skip, log, NOT modify) rather than prepend a phantom frontmatter block.
console.log('\n[Test 5] Fail-open on corrupted (no frontmatter) file');
resetFixture();
// Replace active-skill with a corrupted version: starts with code fence, NO `---` at line 0
try {
  fs.writeFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'),
  '```skills-learned/active-skill/SKILL.md\n---\nname: active-skill\nstatus: draft\n---\n\n## Workflow\n\n1. Step\n\n```\n');
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
let runErr = null;
let runOut = '';
try {
  runOut = execFileSync('node', [SCRIPT], {
    env: { ...process.env, WORKSPACE: FIXTURE },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
} catch (e) {
  runErr = e;
  runOut = (e.stdout || '') + (e.stderr || '');
}
let corruptedAfter;
try {
  corruptedAfter = fs.readFileSync(path.join(FIXTURE, 'skills-learned/active-skill/SKILL.md'), 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
check('corrupted file byte-identical (no phantom frontmatter prepended)',
  corruptedAfter.startsWith('```skills-learned/active-skill/SKILL.md'),
  `first chars: ${JSON.stringify(corruptedAfter.slice(0, 50))}`);
check('corrupted file exit code was 0 (fail-open)', runErr === null);
check('output reports skipped-no-frontmatter', /skip-no-fm/.test(runOut),
  `output:\n${runOut}`);

// Cleanup
rmrf(FIXTURE);

console.log('\n-----------------------------------------');
console.log(`Total: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
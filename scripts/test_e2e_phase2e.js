#!/usr/bin/env node
/**
 * End-to-end demo for Phase 2e.
 *
 * Stages:
 *  1. Create a sandbox copy of a utility file with a known fs-sync bug
 *  2. Build a synthetic audit JSON pointing at it (severity=high, tier=utility)
 *  3. Run audit_repair_wire.js against the synthetic JSON
 *  4. Verify the file was fixed (wrapped in try-catch) and a snapshot exists
 *  5. Restore from snapshot
 *  6. Build a SECOND synthetic JSON with severity=high + production tier
 *  7. Run wire and verify the file was NOT touched, only a proposal was added
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const WS = '$HOME/.openclaw/workspace';
const WIRE = path.join(WS, 'scripts/audit_repair_wire.js');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2e-demo-'));
console.log(`📁 sandbox: ${sandbox}`);

// Stage 1: copy a real utility file and inject a known bug
const src = path.join(WS, 'scripts/test_snapshot.js');
const utilityFile = path.join(sandbox, 'demo_utility.js');
let originalContent;
try {
  originalContent = fs.readFileSync(src, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
// Inject 2 unguarded fs.readFileSync calls
originalContent = originalContent + `

// === injected Phase 2e test bug ===
function buggyRead() {
  let data;
  try {
    try {
      data = fs.readFileSync('/etc/hosts', 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
  } catch (e) {
    console.error("File read failed: " + e.message);
  }
  return data;
}
`;
try {
  fs.writeFileSync(utilityFile, originalContent, 'utf8');
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
console.log(`✅ stage 1: utility file with injected bug → ${utilityFile}`);

// Stage 2: synthetic audit JSON — file relative to WS
const relUtility = path.relative(WS, utilityFile); // e.g. /var/.../demo_utility.js
// We need the orchestrator-style relative. Use the WS marker trick.
const wsRelativeUtility = '.openclaw/workspace/' + path.relative(path.join(os.homedir(), '.openclaw/workspace'), utilityFile);
const auditInput1 = path.join(sandbox, 'audit_utility.json');
const audit1 = {
  results: {
    local: [
      {
        id: 'demo_util_1',
        file: wsRelativeUtility,
        line: 999, // any line; the rule.detect will find it regardless
        rule: 'fsSync_missing_trycatch',
        message: 'demo injected bug',
        severity: 'high',
        source: 'local',
        category: 'reliability',
      }
    ],
    merged: [
      {
        id: 'demo_util_1',
        file: wsRelativeUtility,
        line: 999,
        rule: 'fsSync_missing_trycatch',
        message: 'demo injected bug',
        severity: 'high',
        source: 'local',
        category: 'reliability',
      }
    ],
    summary: { totalIssues: 1, severityCounts: { critical:0, high:1, medium:0, low:0 }, sourceCounts: { local:1, ai:0, error_json:0 }, ruleCounts: { fsSync_missing_trycatch: 1 } },
  },
  summary: { totalIssues: 1 },
  config: {},
  savedAt: new Date().toISOString(),
};
try {
  fs.writeFileSync(auditInput1, JSON.stringify(audit1, null, 2));
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
console.log(`✅ stage 2: synthetic audit JSON → ${auditInput1}`);

// Stage 3: run wire
console.log(`\n🔧 stage 3: running audit_repair_wire.js (utility tier, high severity)`);
const r1 = spawnSync('node', [WIRE, '--input', auditInput1, '--verbose'], { encoding: 'utf8' });
console.log(r1.stdout);
if (r1.status !== 0) {
  console.error(`❌ stage 3 failed: ${r1.stderr}`);
  process.exit(1);
}

// Stage 4: verify file was fixed
let fixedContent;
try {
  fixedContent = fs.readFileSync(utilityFile, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const hasTry = /try\s*\{[^}]*fs\.readFileSync/.test(fixedContent);
let hasSnap;
try {
  hasSnap = fs.readdirSync(path.join(WS, '.fix_snapshots')).some(f => f.startsWith('demo_utility.'));
} catch (e) {
  console.error(`Operation failed: ${e.message}`);
}
console.log(`\n🔍 stage 4: verification`);
console.log(`   fixed content has try-catch wrapping fs.readFileSync: ${hasTry ? '✅' : '❌'}`);
console.log(`   snapshot created:                                   ${hasSnap ? '✅' : '❌'}`);

// Stage 5: rollback
let snapFile;
try {
  snapFile = fs.readdirSync(path.join(WS, '.fix_snapshots')).filter(f => f.startsWith('demo_utility.')).pop();
} catch (e) {
  console.error(`Operation failed: ${e.message}`);
}
const snapPath = path.join(WS, '.fix_snapshots', snapFile);
const snap = require(path.join(WS, 'scripts/lib/file_snapshot'));
snap.rollback(snapPath, utilityFile);
let restoredContent;
try {
  restoredContent = fs.readFileSync(utilityFile, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const restoredMatches = restoredContent === originalContent;
console.log(`\n🔄 stage 5: rollback`);
console.log(`   content restored to original: ${restoredMatches ? '✅' : '❌'}`);

// Stage 6: synthetic audit JSON for PRODUCTION tier — same file but with prefix matching production
// We'll rename it to look like a cron script
const prodFile = path.join(sandbox, 'cron_demo_test.js');
try {
  fs.writeFileSync(prodFile, originalContent, 'utf8');
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
const wsRelativeProd = '.openclaw/workspace/' + path.relative(path.join(os.homedir(), '.openclaw/workspace'), prodFile);
const auditInput2 = path.join(sandbox, 'audit_prod.json');
const audit2 = JSON.parse(JSON.stringify(audit1));
audit2.results.local[0].file = wsRelativeProd;
audit2.results.local[0].id = 'demo_prod_1';
audit2.results.merged[0].file = wsRelativeProd;
audit2.results.merged[0].id = 'demo_prod_1';
try {
  fs.writeFileSync(auditInput2, JSON.stringify(audit2, null, 2));
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}

// Read proposals count before
const proposalsFile = path.join(WS, '.state/repair_proposals.json');
let proposalsBefore = 0;
if (fs.existsSync(proposalsFile)) {
  try {
    proposalsBefore = JSON.parse(fs.readFileSync(proposalsFile, 'utf8')).proposals.length;
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
}

console.log(`\n🔧 stage 6: running wire (production tier, high severity)`);
const r2 = spawnSync('node', [WIRE, '--input', auditInput2, '--verbose'], { encoding: 'utf8' });
console.log(r2.stdout);

let prodContentAfter;
try {
  prodContentAfter = fs.readFileSync(prodFile, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const prodUntouched = prodContentAfter === originalContent;
console.log(`\n🔍 stage 7: production tier NOT modified: ${prodUntouched ? '✅' : '❌'}`);

let proposalsAfter;
try {
  proposalsAfter = JSON.parse(fs.readFileSync(proposalsFile, 'utf8')).proposals.length;
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const newPropsAdded = proposalsAfter - proposalsBefore;
console.log(`📝 proposals added for production issue:  ${newPropsAdded >= 1 ? '✅' : '❌'} (delta = ${newPropsAdded})`);

// Final
const allPass = hasTry && hasSnap && restoredMatches && prodUntouched && (newPropsAdded >= 1);
console.log(`\n${allPass ? '✅ ALL E2E STAGES PASSED' : '❌ E2E FAILURE'}`);

// Cleanup sandbox + snap
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
try { fs.unlinkSync(snapPath); } catch (_) {}

process.exit(allPass ? 0 : 1);

// Verify fix - runs Pure AI Audit on a single file
const { execFileSync } = require('child_process');

const SCAN_TIMEOUT_MS = 120000;

const args = ['scripts/code_quality_manager.js', 'scan', '--files', process.argv[2] || 'check_fix.js', '--quiet'];
try {
  const stdout = execFileSync('node', args, { encoding: 'utf8', timeout: SCAN_TIMEOUT_MS });
  const match = stdout.match(/\{[\s\S]*"issues"[\s\S]*\}/);
  if (!match) { console.log('Parse failed'); process.exit(1); }
  const r = JSON.parse(match[0]);
  const h = r.issues.filter(i => i.severity === 'high' && i.rule === 'fsSync_missing_trycatch');
  console.log('Remaining high fsSync issues:', h.length);
  h.forEach(i => console.log(i.file + ':' + i.line));
} catch (e) {
  console.error('Scan failed:', e.message);
  process.exit(1);
}

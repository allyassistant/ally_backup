const r = require('/Users/ally/.openclaw/workspace/.state/code_quality_report.json');
const h = r.issues.filter(i => i.severity === 'high' && i.rule === 'fsSync_missing_trycatch');
console.log('Remaining high:', h.length);
h.forEach(i => console.log(i.file + ':' + i.line));

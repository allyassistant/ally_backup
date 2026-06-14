const fs = require('fs');

// Load the analyzer code
const code = fs.readFileSync('/Users/ally/.openclaw/workspace/scripts/gia_cert_analyzer.js', 'utf8');

// Check if there are any import/export statements
if (code.includes('import ') || code.includes('export ')) {
  console.log('Module uses ES imports/exports');
} else {
  console.log('Module is CommonJS style');
}

// Just extract the calculateClawScore function and test logic
// Let's parse key sections to understand the scoring flow

// Read key lines
const lines = code.split('\n');

// Find calculateClawScore function entry
let calcStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function calculateClawScore')) {
    calcStart = i;
    break;
  }
}
console.log('calculateClawScore starts at line:', calcStart + 1);

// Now check where finalScore is calculated from score
// The key is: does calculateClawScore call a function that computes finalScore separately?
// OR is finalScore computed WITHIN calculateClawScore?

// Let's find the return statement
let returnLine = -1;
for (let i = calcStart; i < lines.length; i++) {
  if (lines[i].includes('return Math.max(0, Math.min(100, Math.round(finalScore)))')) {
    returnLine = i;
    break;
  }
}
console.log('finalScore return at line:', returnLine + 1);

// Now let's trace score → finalScore
// Find where score is initialized and where finalScore is first derived
for (let i = calcStart; i < returnLine && i < calcStart + 200; i++) {
  const l = lines[i];
  if (l.includes('let score') || l.includes('score =')) {
    console.log(`Line ${i+1}: ${l.trim()}`);
  }
  if (l.includes('finalScore') && !l.includes('===') && !l.includes('if')) {
    console.log(`Line ${i+1}: ${l.trim()}`);
  }
}
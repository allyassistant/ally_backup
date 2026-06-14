// scripts/lib/qualitative_signals.js
// Detect qualitative signals (user frustration, correction) from conversation text
// Used by skill-learner plugin to enrich tool-call-based signal detection
//
// Detects:
//   - user_correction: user says "stop doing X" / "actually do it Y" / "no, do Z"
//   - user_frustration: "wtf" / "點解" / "失敗" / "broken"
//   - user_praise: "好" / "perfect" / "work"
//   - technique: user explains a clever technique
//
// Returns: { signals: [...], byType: { user_correction: N, ... } }

'use strict';

// EN + 粵語混雜 patterns
const PATTERNS = {
  user_correction: [
    // EN
    /\b(?:actually|instead|rather|shouldn'?t|don'?t|stop)\b[^.]{0,80}/i,
    /\b(?:no,?\s+(?:do|use|try))\b[^.]{0,80}/i,
    /(?:the\s+correct\s+way|the\s+right\s+way)\s+is/i,
    // 粵
    /(?:唔好|唔應該|唔好咁做|應該係|其實應該)/,
    /(?:應該|正確)\s*(?:做法|方法|係)/,
  ],
  user_frustration: [
    /\bwtf\b/i,
    /\bwhy\s+(?:is|are|did)\b/i,
    /\bbroken\b/i,
    /\bfail(?:ed|ing)?\b/i,
    /(?:點解|點解仲|乜嘢事|失敗|壞咗|唔得|唔work|頂你)/,
  ],
  user_praise: [
    /\bperfect\b/i,
    /\bgreat\s+(?:job|work)\b/i,
    /\bthat'?s\s+(?:it|exactly)\b/i,
    /(?:完美|好喎|啱喇|好work|犀利|掂)/,
  ],
  technique: [
    /\b(?:the\s+trick|hack|shortcut|pro\s+tip|here'?s\s+how)\b/i,
    /(?:技巧|秘技|其實可以|試下咁樣)/,
  ],
};

function detectSignals(text) {
  if (!text || typeof text !== 'string') return { signals: [], byType: {} };
  const found = [];
  const byType = {};
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        found.push({ type, text: m[0].slice(0, 120) });
        byType[type] = (byType[type] || 0) + 1;
        break; // 同一 type 只記一次
      }
    }
  }
  return { signals: found, byType };
}

module.exports = { detectSignals, PATTERNS };

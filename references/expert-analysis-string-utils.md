# Node.js 字串工具庫 (string-utils.js) 專家分析

**專案：** string-utils.js  
**分析日期：** 2026-04-30  
**分析者：** 項目資深專家

---

## 1. 需求拆解 (Requirements Breakdown)

| 編號 | 功能 | 輸入 | 輸出 | 邊界情況 |
|------|------|------|------|----------|
| F1 | 反轉字符串 | `string` | `string` | 空字符串、Unicode、Emoji |
| F2 | 統計字符頻率 | `string` | `Record<string, number>` | 空字符串、Unicode |
| F3 | 去除重複字符 | `string` | `string` | 全重複、無重複 |
| F4 | 格式化駝峰命名 | `string` | `string` | 已有駝峰、全大寫、分隔符 mixed |

---

## 2. 架構建議 (Architecture)

```
scripts/string-utils.js
├── Utility Functions
│   ├── reverseString(str)           → F1
│   ├── charFrequency(str)          → F2
│   ├── removeDuplicates(str)       → F3
│   └── toCamelCase(str)            → F4
├── Internal Helpers
│   └── isValidString(val)          → 輸入驗證
└── Export
    └── module.exports = { ... }
```

**設計原則：**
- 純函數式 (Pure Functions) - 無副作用
- 輸入驗證 - 拒絕非 string 類型
- Unicode 安全 - 使用 `[...str]` 而非 `str.split('')`
- 統一錯誤處理 - 統一路徑 throw Error

---

## 3. 實現方案 (Implementation Plan)

### F1: reverseString(str)
```javascript
function reverseString(str) {
  if (typeof str !== 'string') throw new TypeError('Expected string');
  return [...str].reverse().join('');
}
```
- `[...str]` = Spread operator 正確處理 Unicode / Emoji

### F2: charFrequency(str)
```javascript
function charFrequency(str) {
  if (typeof str !== 'string') throw new TypeError('Expected string');
  return [...str].reduce((acc, char) => {
    acc[char] = (acc[char] || 0) + 1;
    return acc;
  }, {});
}
```

### F3: removeDuplicates(str)
```javascript
function removeDuplicates(str) {
  if (typeof str !== 'string') throw new TypeError('Expected string');
  return [...new Set(str)].join('');
}
```
- `Set` 自動去重，preserve 原始順序

### F4: toCamelCase(str)
```javascript
function toCamelCase(str) {
  if (typeof str !== 'string') throw new TypeError('Expected string');
  return str
    .trim()
    .replace(/[\s_-]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}
```
- 支援：space, hyphen, underscore 分隔符
- 首字母小寫（駝峰標準）

---

## 4. 風險識別 (Risk Identification)

| 風險 | 等級 | 緩解方案 |
|------|------|----------|
| Unicode surrogate pairs (Emoji) 斷裂 | 🟡 Medium | 使用 `[...str]` 而非 `str.split('')` |
| 空字符串輸入 | 🟢 Low | 正常返回空/frequency = {} |
| 非字符串傳入 | 🟡 Medium | Type guard throw TypeError |
| 超長字符串 (1MB+) | 🟡 Medium | 考慮 lazy eval 或 warning |
| 邊緣字符 (null, undefined) | 🟡 Medium | typeof check |

---

## 5. 測試策略 (Testing Strategy)

### Unit Tests (Jest)
```javascript
describe('string-utils', () => {
  describe('reverseString', () => {
    test('handles basic string', () => { expect(reverseString('hello')).toBe('olleh'); });
    test('handles Unicode', () => { expect(reverseString('中文')).toBe('文中'); });
    test('handles Emoji', () => { expect(reverseString('👋🎉')).toBe('🎉👋'); });
    test('handles empty string', () => { expect(reverseString('')).toBe(''); });
    test('throws on non-string', () => { expect(() => reverseString(123)).toThrow(); });
  });

  describe('charFrequency', () => {
    test('counts characters', () => { expect(charFrequency('aabbc')).toEqual({a:2,b:2,c:1}); });
    test('handles empty string', () => { expect(charFrequency('')).toEqual({}); });
  });

  describe('removeDuplicates', () => {
    test('removes duplicates', () => { expect(removeDuplicates('aabcaa')).toBe('abc'); });
    test('preserves order', () => { expect(removeDuplicates('cababc')).toBe('cab'); });
    test('handles empty string', () => { expect(removeDuplicates('')).toBe(''); });
  });

  describe('toCamelCase', () => {
    test('handles space separated', () => { expect(toCamelCase('hello world')).toBe('helloWorld'); });
    test('handles snake_case', () => { expect(toCamelCase('hello_world')).toBe('helloWorld'); });
    test('handles kebab-case', () => { expect(toCamelCase('hello-world')).toBe('helloWorld'); });
    test('handles mixed delimiters', () => { expect(toCamelCase('hello-World foo_bar')).toBe('helloWorldFooBar'); });
    test('lowercases first char', () => { expect(toCamelCase('Hello')).toBe('hello'); });
  });
});
```

### Smoke Test Commands
```bash
node --check scripts/string-utils.js          # 語法檢查
node scripts/string-utils.js                  # 快速驗證 export
```

---

## 6. 交付物清單

| 檔案 | 說明 |
|------|------|
| `scripts/string-utils.js` | 主模組 |
| `scripts/__tests__/string-utils.test.js` | Jest 測試 (可選) |

---

## 7. 推薦實現代碼

```javascript
/**
 * string-utils.js - 字串工具庫
 * 功能：反轉、頻率統計、去重、駝峰格式化
 */

/**
 * 反轉字符串
 * @param {string} str - 輸入字符串
 * @returns {string} 反轉後字符串
 */
function reverseString(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected string, got ' + typeof str);
  }
  return [...str].reverse().join('');
}

/**
 * 統計字符頻率
 * @param {string} str - 輸入字符串
 * @returns {Record<string, number>} 字符→頻率映射
 */
function charFrequency(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected string, got ' + typeof str);
  }
  return [...str].reduce((acc, char) => {
    acc[char] = (acc[char] || 0) + 1;
    return acc;
  }, {});
}

/**
 * 去除重複字符（保持原始順序）
 * @param {string} str - 輸入字符串
 * @returns {string} 去重後字符串
 */
function removeDuplicates(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected string, got ' + typeof str);
  }
  return [...new Set(str)].join('');
}

/**
 * 格式化為駝峰命名
 * @param {string} str - 輸入字符串
 * @returns {string} 駝峰格式字符串
 */
function toCamelCase(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Expected string, got ' + typeof str);
  }
  return str
    .trim()
    .replace(/[\s_-]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

module.exports = { reverseString, charFrequency, removeDuplicates, toCamelCase };
```

---

## 8. 總結

| 項目 | 評估 |
|------|------|
| 複雜度 | 低 (4 個純函數) |
| 實現時間 | ~30 分鐘 |
| 測試覆蓋建議 | 20+ test cases |
| 依賴 | 僅 Node.js (無外部庫) |
| 擴展性 | 高 (模組化，可輕易新增函數) |

**建議：** 直接實現推薦代碼，配合 Jest 測試覆蓋邊界情況。

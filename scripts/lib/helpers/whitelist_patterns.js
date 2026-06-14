/**
 * Audit Whitelist Patterns
 *
 * 用於減少 Pure AI Audit 的 False Positives
 * 這些模式在 OpenClaw 專案中被視為安全操作
 */

// ============================================================
// 1. 安全路徑模式 (Safe Path Patterns)
// ============================================================

/**
 * 被視為安全的檔案路徑模式
 * 這些路徑不會導致安全問題或需要錯誤處理
 */
const SAFE_PATH_PATTERNS = {
  // 專案內相對路徑
  relative: [
    /^['"]\.\/\w+/,           // './xxx'
    /^['"]\.\.\/\w+/,         // '../xxx'
  ],

  // 配置檔案
  config: [
    /config\.json['"]?$/i,
    /settings\.json['"]?$/i,
    /\.env['"]?$/i,
    /package\.json['"]?$/i,
    /tsconfig\.json['"]?$/i,
    /jsconfig\.json['"]?$/i,
  ],

  // 模板和資源檔案
  template: [
    /template/i,
    /email/i,
    /report/i,
    /\.md['"\s]/i,
    /\.txt['"\s]/i,
    /\.html['"\s]/i,
    /\.css['"\s]/i,
  ],

  // 使用專案常量的路徑
  constant: [
    /path\.join\s*\(\s*__dirname/i,
    /path\.join\s*\(\s*CONFIG\./i,
    /path\.join\s*\(\s*WS\s*,/i,
    /path\.join\s*\(\s*HOME\s*,/i,
    /path\.join\s*\(\s*STATE_DIR/i,
    /path\.join\s*\(\s*SCRIPTS_DIR/i,
    /path\.join\s*\(\s*[A-Z_]+_DIR/i,
  ],
};

// ============================================================
// 2. 安全操作上下文 (Safe Operation Contexts)
// ============================================================

/**
 * 定義哪些上下文中的操作被視為安全
 */
const SAFE_CONTEXTS = {
  /**
   * 配置載入上下文
   * 讀取專案設定檔是標準做法
   */
  configLoading: {
    // 前後文指示器
    indicators: {
      before: [
        /const\s+\w+\s*=\s*require\s*\(\s*['"]\.\/lib\/config['"]/,
        /const\s+\{\s*[^}]*CONFIG[^}]*\}\s*=\s*require/,
        /loadConfig/,
        /parseConfig/,
      ],
      after: [
        /JSON\.parse/,
        /\.toString\s*\(\s*\)/,
      ],
    },
    // 匹配的檔案操作
    operations: [
      /readFileSync.*config/i,
      /readFileSync.*settings/i,
      /readFileSync.*\.env/i,
    ],
    // 處理方式
    action: {
      type: 'reduce_severity',
      to: 'info',
      reason: '讀取專案設定檔是標準做法',
    },
  },

  /**
   * 目錄確保上下文
   * 初始化目錄結構是正常操作
   */
  ensureDirectory: {
    indicators: {
      before: [
        /function\s+ensure\w*Dir\s*\(/,
        /function\s+init\w*Dir\s*\(/,
        /if\s*\(\s*!\s*fs\.existsSync\s*\(/,
        /if\s*\(\s*!\s*\w+Exists\s*\)/,
      ],
      sameLine: [
        /mkdirSync.*\{\s*recursive\s*:\s*true\s*\}/,
      ],
    },
    operations: [
      /mkdirSync/,
    ],
    action: {
      type: 'skip',
      reason: '確保目錄存在是標準初始化模式',
    },
  },

  /**
   * 模板讀取上下文
   * 讀取內部模板是安全操作
   */
  templateReading: {
    indicators: {
      before: [
        /TEMPLATES?_DIR/i,
        /template/i,
        /email/i,
        /report/i,
      ],
    },
    operations: [
      /readFileSync.*template/i,
      /readFileSync.*\.md['"\s]/i,
      /readFileSync.*\.txt['"\s]/i,
    ],
    action: {
      type: 'reduce_severity',
      to: 'info',
      reason: '讀取內部模板檔案是安全操作',
    },
  },

  /**
   * 內部目錄掃描
   * 掃描專案內部目錄是正常功能
   */
  internalScanning: {
    indicators: {
      before: [
        /SCRIPTS_DIR/,
        /STATE_DIR/,
        /WS\s*[,)]/,
        /__dirname/,
        /CONFIG\./,
      ],
    },
    operations: [
      /readdirSync/,
      /readdir\s*\(/,
    ],
    action: {
      type: 'reduce_severity',
      to: 'info',
      reason: '掃描專案內部目錄是正常操作',
    },
  },

  /**
   * 快取操作上下文
   * 讀取/寫入快取檔案風險較低
   */
  cacheOperations: {
    indicators: {
      before: [
        /CACHE_DIR/i,
        /cache/i,
        /tmp/i,
        /temp/i,
        /\.tmp['"\s]/i,
        /\.cache['"\s]/i,
      ],
    },
    operations: [
      /readFileSync/,
      /writeFileSync/,
      /readdirSync/,
    ],
    action: {
      type: 'reduce_severity',
      to: 'low',
      reason: '快取檔案操作影響有限',
    },
  },

  /**
   * 據據目錄操作
   * 讀取/寫入據據目錄是預期行為
   */
  dataDirectory: {
    indicators: {
      before: [
        /DATA_DIR/i,
        /LOGS_DIR/i,
        /OUTPUT_DIR/i,
        /data\//,
        /logs\//,
        /output\//,
      ],
    },
    operations: [
      /readFileSync/,
      /writeFileSync/,
      /readdirSync/,
      /mkdirSync/,
    ],
    action: {
      type: 'reduce_severity',
      to: 'low',
      reason: '據據目錄操作是預期行為',
    },
  },
};

// ============================================================
// 3. 危險信號模式 (Danger Signals)
// ============================================================

/**
 * 這些模式表示操作可能真的有風險
 * 即使符合安全上下文，也應保留警告
 */
const DANGER_SIGNALS = {
  // 用戶輸入
  userInput: [
    /req\.(body|query|params|files)/,
    /process\.argv/,
    /args\[/,
    /input/i,
    /userInput/i,
    /prompt\s*\(/,
  ],

  // 外部路徑
  externalPath: [
    /\/tmp\/[^'"]*\$\{/,  // /tmp/...${var}
    /\/var\/tmp\/[^'"]*\$\{/,  // /var/tmp/...${var}
    /process\.env\./,
  ],

  // 動態路徑構建
  dynamicPath: [
    /\$\{[^}]*\}/,  // 模板字符串變量
    /\+\s*\w+\s*\+/,  // 字符串拼接
    /new\s+URL\s*\(/,
  ],

  // 危險操作組合
  dangerousCombo: [
    /eval\s*\(/,
    /exec\s*\(/,
    /execSync\s*\(/,
    /child_process/,
  ],
};

// ============================================================
// 4. 安全 Helper 函數 (Safe Helper Functions)
// ============================================================

/**
 * 已知安全的 wrapper 函據
 * 這些函據內部已處理錯誤
 */
const SAFE_HELPERS = [
  // 檔案操作
  'safeReadFile',
  'safeWriteFile',
  'safeJsonParse',
  'atomicWriteSync',
  'getFileContent',

  // 目錄操作
  'ensureDir',
  'initDataDir',

  // 配置操作
  'loadConfig',
  'saveConfig',
  'loadState',
  'saveState',

  // 快取操作
  'loadCache',
  'saveCache',
  'updateCache',
];

// ============================================================
// 5. 檔案類型豁免 (File Type Exemptions)
// ============================================================

/**
 * 特定檔案類型的全局豁免
 */
const FILE_EXEMPTIONS = {
  // 配置文件
  config: {
    patterns: [
      /\/lib\/config\.js$/,
      /\.config\./,
      /config\./,
    ],
    reason: '配置檔案主要負責讀取設定',
    allowedOperations: ['readFileSync', 'existsSync', 'mkdirSync'],
  },

  // 初始化/設定腳本
  setup: {
    patterns: [
      /setup\./,
      /init\./,
      /install\./,
    ],
    reason: '設定腳本需要初始化目錄結構',
    allowedOperations: ['mkdirSync', 'writeFileSync', 'copyFileSync'],
  },

  // Legacy 目錄 - 舊代碼，降低評級
  legacy: {
    patterns: [
      /_legacy\//,
      /\/legacy\//,
      /-old\./,
      /_old\//,
    ],
    reason: 'Legacy 代碼可能是舊版本，降低嚴重性',
    action: {
      type: 'reduce_severity',
      to: 'low',
    },
  },
};

// ============================================================
// 6. 跳過模式 (Skip Patterns)
// ============================================================

/**
 * 這些模式應被跳過，不應標記為問題
 */
const SKIP_PATTERNS = {
  // require() 語句 - 只是 import，不是問題
  requireStatements: [
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /require\s*\(\s*['"]path['"]\s*\)/,
    /require\s*\(\s*['"]os['"]\s*\)/,
    /require\s*\(\s*['"]crypto['"]\s*\)/,
    /require\s*\(\s*['"]http['"]\s*\)/,
    /require\s*\(\s*['"]https['"]\s*\)/,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
  ],

  // 註釋中的關鍵字 - 不是實際代碼
  comments: [
    /^\s*\/\//,           // // comment
    /^\s*\/\*/,           // /* comment */
    /^\s*\*\s*/,          // * comment (inside block)
    /^\s*#/,              // # shell comment
  ],

  // style preference - 低優先級
  stylePreference: [
    /\bbufferSize\s*[:=]\s*\d+\b/,
    /\bchunkSize\s*[:=]\s*\d+\b/,
    /\btimeout\s*[:=]\s*\d+\b/,
    /\bport\s*[:=]\s*\d{2,5}\b/,
    /\d{17,20}/,          // Discord channel IDs
  ],
};

// ============================================================
// 6. 導出
// ============================================================

module.exports = {
  SAFE_PATH_PATTERNS,
  SAFE_CONTEXTS,
  DANGER_SIGNALS,
  SAFE_HELPERS,
  FILE_EXEMPTIONS,
  SKIP_PATTERNS,

  // 便捷函數
  isSafePath,
  getSafeContext,
  hasDangerSignal,
  isSafeHelper,
  getFileExemption,
  isRequireStatement,
  isComment,
  isStylePreference,
};

// ============================================================
// 7. 輔助函數實現
// ============================================================

/**
 * 檢查路徑是否安全
 */
function isSafePath(path, category = null) {
  if (category && SAFE_PATH_PATTERNS[category]) {
    return SAFE_PATH_PATTERNS[category].some(p => p.test(path));
  }

  // 檢查所有類別
  return Object.values(SAFE_PATH_PATTERNS).some(
    patterns => patterns.some(p => p.test(path))
  );
}

/**
 * 獲取操作的安全上下文
 */
function getSafeContext(operation, lines, lineIdx) {
  for (const [name, context] of Object.entries(SAFE_CONTEXTS)) {
    // 檢查操作是否匹配
    const operationMatches = context.operations.some(p => p.test(operation));
    if (!operationMatches) continue;

    // 檢查前後文指示器
    const beforeLines = lines.slice(Math.max(0, lineIdx - 5), lineIdx);
    const contextMatch = context.indicators.before.some(
      p => beforeLines.some(l => p.test(l))
    );

    if (contextMatch) {
      return { name, action: context.action };
    }
  }

  return null;
}

/**
 * 檢查是否有危險信號
 */
function hasDangerSignal(line) {
  return Object.values(DANGER_SIGNALS).some(
    patterns => patterns.some(p => p.test(line))
  );
}

/**
 * 檢查是否為安全 helper 函據
 */
function isSafeHelper(line) {
  const helperPattern = new RegExp(
    `\\b(${SAFE_HELPERS.join('|')})\\s*\\(`,
    'i'
  );
  return helperPattern.test(line);
}

/**
 * 獲取檔案類型豁免
 */
function getFileExemption(filePath) {
  for (const [type, exemption] of Object.entries(FILE_EXEMPTIONS)) {
    if (exemption.patterns.some(p => p.test(filePath))) {
      return exemption;
    }
  }
  return null;
}

/**
 * 檢查是否為 require() 語句（只是 import，不是實際調用）
 */
function isRequireStatement(line) {
  for (const pattern of SKIP_PATTERNS.requireStatements) {
    if (pattern.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * 檢查是否為註釋行
 */
function isComment(line) {
  const trimmed = line.trim();
  for (const pattern of SKIP_PATTERNS.comments) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * 檢查是否為 style preference（低優先級問題）
 */
function isStylePreference(line) {
  for (const pattern of SKIP_PATTERNS.stylePreference) {
    if (pattern.test(line)) {
      return true;
    }
  }
  return false;
}

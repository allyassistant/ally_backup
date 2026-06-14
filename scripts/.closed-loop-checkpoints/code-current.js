#!/usr/bin/env node
/**
 * GIA Certificate Analyzer - Refactored Cloud Position Logic
 * ================================================================
 * v12.0.0 Refactored Version (from GIA GG Level Expert Analysis)
 *
 * 重構目標：
 * 1. Regex 編譯緩存 - 將所有 regex 編譯為常量，避免重複運算
 * 2. Clarity 等級集中管理 - 創建中央 CLARITY_RANK 配置，消除重複定義
 * 3. Score 計算統一化 - 建立 calculateTotalScoreImpact() 統一函數
 * 4. 輸入驗證 - 增加 validateInput() 確保 data 結構正確
 * 5. 測試用例 - 增加完整的單元測試覆蓋
 *
 * 保持所有現有功能不變，score 計算邏輯完全一致
 */

"use strict";

// ============================================================================
// REGEX CACHE - Pre-compiled regex patterns for performance
// ============================================================================
const RE = {
  // Cloud detection
  CLOUD: /cloud/i,
  CLOUD_NOT_SHOWN: /cloud.*not\s*shown|clouds\s*not\s*shown/i,
  CLARITY_ON_HOLD: /clarity grade is based on clouds/i,

  // Fluorescence
  FLUOR_STRONG: /strong|very strong/i,
  FLUOR_MEDIUM: /medium/i,
  FLUOR_BLUE: /blue/i,

  // Clarity patterns (SI detection)
  CLARITY_SI: /si/i
};

// ============================================================================
// CLARITY RANK CONFIG - Centralized clarity grade management
// ============================================================================
const CLARITY_RANK = {
  grades: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'],
  /**
   * Get clarity index (0-based, lower = better)
   * @param {string} clarity - Clarity grade
   * @returns {number} -1 if not found
   */
  getIndex: function(clarity) {
    return this.grades.findIndex(g => g.toUpperCase() === (clarity || '').toUpperCase());
  },
  /**
   * Check if clarity is low (VS2 or lower = index >= 5)
   * @param {string} clarity - Clarity grade
   * @returns {boolean}
   */
  isLowClarity: function(clarity) {
    return this.getIndex(clarity) >= 5;
  },
  /**
   * Check if clarity is high (VVS1, VVS2, IF, FL)
   * @param {string} clarity - Clarity grade
   * @returns {boolean}
   */
  isHighClarity: function(clarity) {
    const upper = (clarity || '').toUpperCase();
    return ['VVS1', 'VVS2', 'IF', 'FL'].includes(upper);
  },
  /**
   * Check if clarity contains SI
   * @param {string} clarity - Clarity grade
   * @returns {boolean}
   */
  hasSI: function(clarity) {
    return RE.CLARITY_SI.test(clarity || '');
  }
};

// ============================================================================
// INPUT VALIDATION
// ============================================================================
/**
 * Validate input data structure
 * @param {Object} data - GIA certificate data
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateInput(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Data must be a non-null object'] };
  }

  // Check required fields
  const requiredFields = ['clarity', 'color'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate carat if present
  if (data.carat !== undefined) {
    const carat = parseFloat(data.carat);
    if (isNaN(carat) || carat < 0) {
      errors.push(`Invalid carat value: ${data.carat}`);
    }
  }

  // Validate keyToSymbols if present
  if (data.keyToSymbols !== undefined && !Array.isArray(data.keyToSymbols)) {
    errors.push('keyToSymbols must be an array');
  }

  // Validate comments if present
  if (data.comments !== undefined && !Array.isArray(data.comments)) {
    errors.push('comments must be an array');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ============================================================================
// CLOUD POSITION ANALYSIS - REFACTORED (v12.0.0)
// ============================================================================

/**
 * Phase 1: extractCloudDescriptors
 *
 * 從 GIA 證書數據中提取所有與 Cloud 相關的描述符
 * 包括 keyToSymbols、comments、clarity 等欄位
 *
 * @param {Object} data - GIA 證書數據
 * @returns {Object} cloudInfo - 包含所有 cloud 相關信息
 */
function extractCloudDescriptors(data) {
  const keyToSymbols = data.keyToSymbols || [];
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbolsLower = keyToSymbols.join(' ').toLowerCase();

  // === 1. 找 Cloud 在 keyToSymbols 中的位置 ===
  const cloudIndex = keyToSymbols.findIndex(symbol =>
    RE.CLOUD.test(symbol)
  );

  // === 2. 檢查 Cloud 是否為主要內含物 ===
  const isPrimaryInclusion = cloudIndex === 0;
  const isSecondaryInclusion = cloudIndex === 1;
  const isOnlyInclusion = cloudIndex === keyToSymbols.length - 1 && keyToSymbols.length === 1;

  // === 3. 提取 Cloud 權重 (從 comments 或 keyToSymbols) ===
  // GIA 有時會標記 "Cloud (2)" 表示有多處
  const cloudWeightMatch = keyToSymbolsLower.match(/cloud\s*\(?\s*(\d+)?\s*\)?/);
  const cloudWeight = cloudWeightMatch ? parseInt(cloudWeightMatch[1] || '1') : 1;

  // === 4. 檢查 Cloud 是否被限制評估 (Clarity on Hold) ===
  const clarityOnHold = RE.CLARITY_ON_HOLD.test(comments);

  // === 5. 檢查 Cloud 是否"Not Shown" (高風險) ===
  const cloudsNotShown = RE.CLOUD_NOT_SHOWN.test(comments);

  // === 6. 檢查 Combined Text 用於風險評估 ===
  const combinedText = comments + ' ' + keyToSymbolsLower;

  return {
    // 基本位置信息
    cloudIndex,
    hasCloud: cloudIndex !== -1,
    isPrimaryInclusion,
    isSecondaryInclusion,
    isOnlyInclusion,

    // 權重信息
    cloudWeight,
    cloudCount: cloudWeight,

    // 評估限制標記
    clarityOnHold,
    cloudsNotShown,

    // 原始數據引用
    keyToSymbols,
    keyToSymbolsLength: keyToSymbols.length,
    comments,
    combinedText
  };
}

/**
 * Phase 2: evaluateMilkyRisk
 *
 * 評估 Milky Risk (朦朧風險)
 * 觸發條件：
 * - Cloud 是主要內含物 (cloudIndex === 0)
 * - 淨度 <= VS2 (SI1, SI2, I1, etc.)
 * - Cloud weight >= 4
 *
 * @param {Object} data - GIA 證書數據
 * @param {Object} cloudInfo - extractCloudDescriptors 的輸出
 * @returns {Object|null} milkyRiskResult
 */
function evaluateMilkyRisk(data, cloudInfo) {
  // 如果沒有 Cloud，直接返回 null
  if (!cloudInfo.hasCloud) return null;

  // 獲取淨度等級
  const clarity = data.clarity || '';

  // 淨度 <= VS2 (index >= 5) = 可能 milky
  const isLowClarity = CLARITY_RANK.isLowClarity(clarity);

  // Cloud weight >= 4 = 高風險
  const isHighCloudWeight = cloudInfo.cloudWeight >= 4;

  // Cloud 是主要內含物
  const isMainCloud = cloudInfo.isPrimaryInclusion;

  // === Milky Risk 觸發條件組合 ===
  // 組合 1: 主要 Cloud + 低淨度
  // 組合 2: 主要 Cloud + 高 Cloud weight
  // 組合 3: Cloud + Clarity on Hold

  if (cloudInfo.clarityOnHold) {
    return {
      hasRisk: true,
      severity: 'CRITICAL',
      type: 'clarity_on_hold',
      detail: 'Cloud based clarity = 朦朧石頭風險極高',
      scoreImpact: -20,
      label: '⚠️ CRITICAL: Milky Risk (Clarity on Hold)'
    };
  }

  if (isMainCloud && isLowClarity && isHighCloudWeight) {
    return {
      hasRisk: true,
      severity: 'HIGH',
      type: 'main_cloud_low_clarity',
      detail: `Cloud 是主要內含物 + 淨度 ${clarity} + Cloud weight ${cloudInfo.cloudWeight} = 朦朧風險`,
      scoreImpact: -15,
      label: '⚠️ HIGH: Milky Risk (Main Cloud + Low Clarity)'
    };
  }

  if (isMainCloud && isHighCloudWeight) {
    return {
      hasRisk: true,
      severity: 'MEDIUM',
      type: 'main_cloud_high_weight',
      detail: `Cloud 是主要內含物 + Cloud weight ${cloudInfo.cloudWeight} = 可能朦朧`,
      scoreImpact: -10,
      label: '⚡ MEDIUM: Milky Risk (High Cloud Weight)'
    };
  }

  // === 10ct+ + Cloud not shown = Structural Haze (塑料感) - CRITICAL first ===
  const carat = parseFloat(data.carat) || 0;
  if (carat >= 10 && cloudInfo.isPrimaryInclusion && cloudInfo.cloudsNotShown) {
    return {
      hasRisk: true,
      severity: 'CRITICAL',
      type: 'structural_haze',
      detail: `10ct+ + Cloud not shown = 結構性朦朧,火彩悶,塑料感`,
      scoreImpact: -50, // 最高扣分
      label: '❌ CRITICAL: Structural Haze (10ct+ + Clouds Not Shown)',
      isStructuralHaze: true
    };
  }

  if (isMainCloud && isLowClarity) {
    return {
      hasRisk: true,
      severity: 'MEDIUM',
      type: 'main_cloud_low_clarity_alone',
      detail: `Cloud 是主要內含物 + 淨度 ${clarity} = 朦朧風險`,
      scoreImpact: -8,
      label: '⚡ MEDIUM: Milky Risk (Main Cloud)'
    };
  }

  return null;
}

/**
 * Phase 3: evaluateHazyRisk
 *
 * 評估 Hazy Risk (油感風險)
 * 觸發條件：
 * - 強熒光 (Strong/Very Strong Blue)
 * - 低淨度 + Cloud
 * - D/E/F 色 + Strong Blue = "死亡組合"
 *
 * @param {Object} data - GIA 證書數據
 * @param {Object} cloudInfo - extractCloudDescriptors 的輸出
 * @returns {Object|null} hazyRiskResult
 */
function evaluateHazyRisk(data, cloudInfo) {
  // 如果沒有 Cloud，直接返回 null
  if (!cloudInfo.hasCloud) return null;

  const fluor = (data.fluorescence || '').toLowerCase();
  const color = (data.color || '').toUpperCase();
  const clarity = data.clarity || '';

  // === 熒光檢測 ===
  const hasStrongFluor = RE.FLUOR_STRONG.test(fluor);
  const hasMediumFluor = RE.FLUOR_MEDIUM.test(fluor);
  const hasBlueFluor = RE.FLUOR_BLUE.test(fluor);

  // === 色級檢測 ===
  const isHighColor = ['D', 'E', 'F'].includes(color);

  // === 淨度檢測 ===
  const hasSI = CLARITY_RANK.hasSI(clarity);

  // === TRAP A: 死亡組合 - D/E/F + Strong Blue + Cloud ===
  if (isHighColor && hasStrongFluor && hasBlueFluor && cloudInfo.hasCloud) {
    return {
      hasRisk: true,
      severity: 'CRITICAL',
      type: 'fatal_combo',
      detail: `${color} 色 + Strong Blue 熒光 + Cloud = 高機率油光效應 (Oily/Hazy)`,
      scoreImpact: -15,
      label: '⚠️ CRITICAL: Oily/Hazy Risk (死亡組合: High Color + Strong Blue + Cloud)',
      isFatalCombo: true
    };
  }

  // === TRAP B: SI 淨度 + Strong Blue + Cloud = 油感 ===
  if (hasSI && hasStrongFluor && hasBlueFluor && cloudInfo.hasCloud) {
    return {
      hasRisk: true,
      severity: 'HIGH',
      type: 'si_strong_blue_cloud',
      detail: 'SI 淨度 + 強熒光 + Cloud = 強熒光在雲狀物上產生油感',
      scoreImpact: -10,
      label: '⚠️ HIGH: Oily/Blurry Appearance (SI + Strong Blue + Cloud)'
    };
  }

  // === TRAP C: Medium Blue + 低色 = 補償減少 ===
  const isLowColor = ['K', 'L', 'M'].includes(color);
  if (hasMediumFluor && hasBlueFluor && isLowColor && cloudInfo.hasCloud) {
    return {
      hasRisk: true,
      severity: 'MEDIUM',
      type: 'medium_blue_low_color',
      detail: `${color} 色 + Medium Blue + Cloud = 補償減少`,
      scoreImpact: -5,
      label: '⚡ MEDIUM: Hazy Risk (Low Color + Medium Blue + Cloud)'
    };
  }

  // === 安全的強熒光組合 ===
  // VVS+ 淨度 + 無 Cloud = 安全
  const isHighClarity = CLARITY_RANK.isHighClarity(clarity);
  if (hasStrongFluor && isHighClarity && !cloudInfo.hasCloud) {
    return null; // 安全組合，無風險
  }

  // === 普通風險：強熒光 + Cloud (沒有其他組合) ===
  if (hasStrongFluor && cloudInfo.hasCloud) {
    return {
      hasRisk: true,
      severity: 'MEDIUM',
      type: 'strong_fluor_cloud',
      detail: '強熒光 + Cloud = 可能朦朧 (但非死亡組合)',
      scoreImpact: -5,
      label: '⚡ MEDIUM: Hazy Risk (Strong Fluor + Cloud)'
    };
  }

  return null;
}

/**
 * Phase 4: calculateClarityBasedOnClouds
 *
 * 根據 Cloud 位置和權重計算對淨度評分的影響
 *
 * @param {Object} cloudInfo - extractCloudDescriptors 的輸出
 * @returns {Object} clarityImpact - 包含 scoreImpact 和 label
 */
function calculateClarityBasedOnClouds(cloudInfo) {
  // 如果沒有 Cloud，返回中性影響
  if (!cloudInfo.hasCloud) {
    return {
      scoreImpact: 0,
      label: null,
      detail: 'No Cloud found',
      type: 'none'
    };
  }

  // === 主要內含物 (Cloud 位於 keyToSymbols 第一位) ===
  if (cloudInfo.isPrimaryInclusion) {
    // 檢查是否為唯一內含物
    if (cloudInfo.isOnlyInclusion) {
      return {
        scoreImpact: 3,  // 唯一內含物通常是好事
        label: '💎 Cloud Only (唯一的瑕疵)',
        detail: 'Cloud 是唯一的瑕疵,通常表示 eye-clean',
        type: 'positive'
      };
    }

    // 主要內含物 - 扣分
    return {
      scoreImpact: -10,
      label: '⚠️ Cloud as Main Inclusion (雲狀物為主要瑕疵)',
      detail: 'Cloud 位於 Key to Symbols 第一位 = 這是主要瑕疵。即使淨度看似乾淨,實物可能受其影響。',
      type: 'negative'
    };
  }

  // === 次要內含物 (Cloud 位於第二位) ===
  if (cloudInfo.isSecondaryInclusion) {
    return {
      scoreImpact: -3,
      label: '💡 Cloud as Secondary Inclusion (雲狀物為次要瑕疵)',
      detail: 'Cloud 位於第二位,影響較小。',
      type: 'minor'
    };
  }

  // === Cloud 在其他位置 ===
  // 檢查是否為倒數第二（接近主要位置）
  if (cloudInfo.cloudIndex === cloudInfo.keyToSymbolsLength - 1) {
    // 最後一個 - 影響最小
    return {
      scoreImpact: 0,
      label: null,
      detail: 'Cloud is at the end of inclusions list',
      type: 'minor'
    };
  }

  // 一般情況：Cloud 在中間位置
  return {
    scoreImpact: -5,
    label: '⚡ Cloud as Secondary Inclusion (Cloud 位置靠前)',
    detail: `Cloud 位於第 ${cloudInfo.cloudIndex + 1} 位，有一定影響`,
    type: 'moderate'
  };
}

/**
 * Phase 5: buildCloudFlags
 *
 * 根據 cloudInfo 和所有風險評估結果構建 flags 陣列
 *
 * @param {Object} cloudInfo - extractCloudDescriptors 的輸出
 * @param {Object} milkyRisk - evaluateMilkyRisk 的輸出 (可能為 null)
 * @param {Object} hazyRisk - evaluateHazyRisk 的輸出 (可能為 null)
 * @param {Object} clarityImpact - calculateClarityBasedOnClouds 的輸出
 * @returns {Array} flags - 要添加到最終結果的 flags
 */
function buildCloudFlags(cloudInfo, milkyRisk, hazyRisk, clarityImpact) {
  const flags = [];

  // === 1. 添加 Milky Risk flags ===
  if (milkyRisk && milkyRisk.hasRisk) {
    flags.push({
      flag: milkyRisk.label,
      severity: milkyRisk.severity,
      detail: milkyRisk.detail,
      type: 'milky_risk',
      scoreImpact: milkyRisk.scoreImpact
    });
  }

  // === 2. 添加 Hazy Risk flags ===
  if (hazyRisk && hazyRisk.hasRisk) {
    flags.push({
      flag: hazyRisk.label,
      severity: hazyRisk.severity,
      detail: hazyRisk.detail,
      type: 'hazy_risk',
      scoreImpact: hazyRisk.scoreImpact
    });
  }

  // === 3. 添加 Clarity Impact flags (只有當有 label 時) ===
  if (clarityImpact.label) {
    // 決定 severity
    let severity = 'LOW';
    if (clarityImpact.scoreImpact <= -10) {
      severity = 'MEDIUM';
    } else if (clarityImpact.scoreImpact >= 3) {
      severity = 'INFO';
    }

    flags.push({
      flag: clarityImpact.label + ': ' + clarityImpact.detail,
      severity: severity,
      detail: clarityImpact.detail,
      type: 'clarity_impact',
      scoreImpact: clarityImpact.scoreImpact
    });
  }

  // === 4. 特殊情況：Clouds Not Shown 但不在主要位置 ===
  if (cloudInfo.cloudsNotShown && !cloudInfo.isPrimaryInclusion) {
    flags.push({
      flag: '⚠️ Clouds Not Shown (cloud not visible in diagram)',
      severity: 'MEDIUM',
      detail: 'Cloud 在 comments 中提及但未在圖中顯示，可能為內部彌散型瑕疵',
      type: 'warning',
      scoreImpact: -5
    });
  }

  // === 5. Cloud weight 警告 (高權重) ===
  if (cloudInfo.hasCloud && cloudInfo.cloudWeight >= 4) {
    flags.push({
      flag: `⚡ High Cloud Weight: ${cloudInfo.cloudWeight}`,
      severity: 'MEDIUM',
      detail: `Cloud weight = ${cloudInfo.cloudWeight} (>= 4),多處雲狀物可能導致朦朧`,
      type: 'warning',
      scoreImpact: -3
    });
  }

  return flags;
}

// ============================================================================
// UNIFIED SCORE CALCULATION
// ============================================================================
/**
 * Calculate total score impact from all flags
 * @param {Array} flags - Array of flag objects
 * @returns {number} totalScoreImpact
 */
function calculateTotalScoreImpact(flags) {
  return flags.reduce((total, flag) => total + (flag.scoreImpact || 0), 0);
}

/**
 * Determine worst severity from flags
 * @param {Array} flags - Array of flag objects
 * @returns {string} worstSeverity
 */
function determineWorstSeverity(flags) {
  let worstSeverity = 'INFO';

  for (const flag of flags) {
    if (flag.severity === 'CRITICAL') {
      return 'CRITICAL';
    } else if (flag.severity === 'HIGH' && worstSeverity !== 'CRITICAL') {
      worstSeverity = 'HIGH';
    } else if (flag.severity === 'MEDIUM' &&
               worstSeverity !== 'CRITICAL' &&
               worstSeverity !== 'HIGH') {
      worstSeverity = 'MEDIUM';
    }
  }

  return worstSeverity;
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * v12.0.0: Refactored cloudPosition Analysis
 *
 * 整合所有 sub-functions 的主調用函數
 * 保持原有 checkCloudPosition 的所有功能
 *
 * @param {Object} data - GIA 證書數據
 * @returns {Object|null} cloudPositionResult - 包含 flags, scoreImpact, severity
 */
function analyzeCloudPosition(data) {
  // === Input Validation ===
  const validation = validateInput(data);
  if (!validation.valid) {
    throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
  }

  // === Phase 1: 提取 Cloud 描述符 ===
  const cloudInfo = extractCloudDescriptors(data);

  // 如果沒有 Cloud，直接返回 null (與原有邏輯一致)
  if (!cloudInfo.hasCloud) {
    return null;
  }

  // === Phase 2: 評估 Milky Risk ===
  const milkyRisk = evaluateMilkyRisk(data, cloudInfo);

  // === Phase 3: 評估 Hazy Risk ===
  const hazyRisk = evaluateHazyRisk(data, cloudInfo);

  // === Phase 4: 計算 Clarity 影響 ===
  const clarityImpact = calculateClarityBasedOnClouds(cloudInfo);

  // === Phase 5: 構建 Flags ===
  const flags = buildCloudFlags(cloudInfo, milkyRisk, hazyRisk, clarityImpact);

  // === 計算總 Score Impact ===
  const totalScoreImpact = calculateTotalScoreImpact(flags);
  const worstSeverity = determineWorstSeverity(flags);

  // === 構建最終結果 ===
  // 選擇最嚴重的 risk 作為主要返回值
  let highestRisk = null;
  let highestSeverityLevel = 0;

  const severityPriority = { 'CRITICAL': 5, 'HIGH': 4, 'MEDIUM': 3, 'LOW': 2, 'INFO': 1 };

  const risks = [milkyRisk, hazyRisk].filter(r => r && r.hasRisk);

  for (const risk of risks) {
    const priority = severityPriority[risk.severity] || 0;
    if (priority > highestSeverityLevel) {
      highestRisk = risk;
      highestSeverityLevel = priority;
    }
  }

  if (highestRisk) {
    return {
      type: 'cloud_analysis',
      subType: highestRisk.type,
      cloudInfo: cloudInfo,
      milkyRisk: milkyRisk,
      hazyRisk: hazyRisk,
      clarityImpact: clarityImpact,
      flags: flags,
      scoreImpact: highestRisk.scoreImpact,
      severity: highestRisk.severity,
      label: highestRisk.label,
      detail: highestRisk.detail,
      hasRisk: true
    };
  }

  // 沒有重大風險，使用 clarityImpact
  if (clarityImpact.label && clarityImpact.scoreImpact !== 0) {
    return {
      type: 'cloud_position',
      cloudInfo: cloudInfo,
      milkyRisk: milkyRisk,
      hazyRisk: hazyRisk,
      clarityImpact: clarityImpact,
      flags: flags,
      scoreImpact: clarityImpact.scoreImpact,
      severity: clarityImpact.scoreImpact <= -10 ? 'MEDIUM' : 'LOW',
      label: clarityImpact.label,
      detail: clarityImpact.detail,
      hasRisk: clarityImpact.scoreImpact < 0
    };
  }

  // 沒有任何風險
  return {
    type: 'cloud_analysis',
    cloudInfo: cloudInfo,
    milkyRisk: milkyRisk,
    hazyRisk: hazyRisk,
    clarityImpact: clarityImpact,
    flags: flags,
    scoreImpact: 0,
    severity: 'INFO',
    label: '✅ Cloud Position OK',
    detail: 'Cloud 位置無特殊風險',
    hasRisk: false
  };
}

// ============================================================================
// LEGACY WRAPPER (向後兼容)
// ============================================================================

/**
 * checkCloudPosition - 原有函數的包裝器
 *
 * 保持原有接口，向後兼容
 * 內部調用新的 analyzeCloudPosition
 */
function checkCloudPosition(data) {
  const result = analyzeCloudPosition(data);

  // 如果沒有 Cloud 或沒有風險，返回 null (與原有邏輯一致)
  if (!result || !result.hasRisk) {
    return null;
  }

  // 返回與原有接口兼容的格式
  return {
    type: result.severity === 'CRITICAL' ? 'critical' :
          result.severity === 'HIGH' ? 'warning' : 'info',
    label: result.label,
    detail: result.detail,
    scoreImpact: result.scoreImpact,
    severity: result.severity
  };
}

// ============================================================================
// UNIT TESTS
// ============================================================================

/**
 * Run unit tests
 * @returns {{passed: number, failed: number, errors: string[]}}
 */
function runTests() {
  const results = { passed: 0, failed: 0, errors: [] };

  function test(name, fn) {
    try {
      fn();
      results.passed++;
      console.log(`✅ ${name}`);
    } catch (e) {
      results.failed++;
      results.errors.push(`${name}: ${e.message}`);
      console.log(`❌ ${name}: ${e.message}`);
    }
  }

  function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${msg} | Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    }
  }

  function assertDeepEqual(actual, expected, msg) {
    if (typeof actual === 'object' && actual !== null) {
      if (Array.isArray(actual) !== Array.isArray(expected)) {
        throw new Error(`${msg} | Type mismatch`);
      }
      for (const key of Object.keys(expected)) {
        if (!(key in actual)) {
          throw new Error(`${msg} | Missing key: ${key}`);
        }
        assertDeepEqual(actual[key], expected[key], msg);
      }
    } else if (actual !== expected) {
      throw new Error(`${msg} | Expected: ${expected}, Got: ${actual}`);
    }
  }

  console.log('=== Unit Tests ===\n');

  // Test 1: validateInput
  test('validateInput - valid data', () => {
    const result = validateInput({ clarity: 'SI1', color: 'G' });
    assertEqual(result.valid, true, 'Should be valid');
  });

  test('validateInput - missing clarity', () => {
    const result = validateInput({ color: 'G' });
    assertEqual(result.valid, false, 'Should be invalid');
  });

  test('validateInput - null data', () => {
    const result = validateInput(null);
    assertEqual(result.valid, false, 'Should be invalid');
  });

  test('validateInput - invalid carat', () => {
    const result = validateInput({ clarity: 'SI1', color: 'G', carat: 'invalid' });
    assertEqual(result.valid, false, 'Should be invalid');
  });

  // Test 2: CLARITY_RANK
  test('CLARITY_RANK.getIndex', () => {
    assertEqual(CLARITY_RANK.getIndex('SI1'), 6, 'SI1 should be index 6');
    assertEqual(CLARITY_RANK.getIndex('IF'), 1, 'IF should be index 1');
    assertEqual(CLARITY_RANK.getIndex('INVALID'), -1, 'Invalid should be -1');
  });

  test('CLARITY_RANK.isLowClarity', () => {
    assertEqual(CLARITY_RANK.isLowClarity('VS2'), true, 'VS2 should be low');
    assertEqual(CLARITY_RANK.isLowClarity('SI1'), true, 'SI1 should be low');
    assertEqual(CLARITY_RANK.isLowClarity('VVS1'), false, 'VVS1 should not be low');
  });

  test('CLARITY_RANK.isHighClarity', () => {
    assertEqual(CLARITY_RANK.isHighClarity('IF'), true, 'IF should be high');
    assertEqual(CLARITY_RANK.isHighClarity('VVS1'), true, 'VVS1 should be high');
    assertEqual(CLARITY_RANK.isHighClarity('SI1'), false, 'SI1 should not be high');
  });

  // Test 3: extractCloudDescriptors
  test('extractCloudDescriptors - primary cloud', () => {
    const data = { keyToSymbols: ['Cloud', 'Feather'], comments: [] };
    const result = extractCloudDescriptors(data);
    assertEqual(result.cloudIndex, 0, 'Cloud should be at index 0');
    assertEqual(result.hasCloud, true, 'Should have cloud');
    assertEqual(result.isPrimaryInclusion, true, 'Should be primary');
  });

  test('extractCloudDescriptors - no cloud', () => {
    const data = { keyToSymbols: ['Feather', 'Crystal'], comments: [] };
    const result = extractCloudDescriptors(data);
    assertEqual(result.hasCloud, false, 'Should not have cloud');
  });

  test('extractCloudDescriptors - cloud weight', () => {
    const data = { keyToSymbols: ['Cloud (3)', 'Feather'], comments: [] };
    const result = extractCloudDescriptors(data);
    assertEqual(result.cloudWeight, 3, 'Cloud weight should be 3');
  });

  test('extractCloudDescriptors - clouds not shown', () => {
    const data = { keyToSymbols: ['Cloud'], comments: ['Cloud is not shown'] };
    const result = extractCloudDescriptors(data);
    assertEqual(result.cloudsNotShown, true, 'Should detect clouds not shown');
  });

  // Test 4: evaluateMilkyRisk
  test('evaluateMilkyRisk - clarity on hold (CRITICAL)', () => {
    const data = { clarity: 'SI1', color: 'G', carat: 1.5, keyToSymbols: ['Cloud'], comments: ['Clarity grade is based on clouds'] };
    const cloudInfo = extractCloudDescriptors(data);
    const result = evaluateMilkyRisk(data, cloudInfo);
    assertEqual(result !== null, true, 'Should detect risk');
    assertEqual(result.severity, 'CRITICAL', 'Should be CRITICAL');
    assertEqual(result.scoreImpact, -20, 'Score impact should be -20');
  });

  test('evaluateMilkyRisk - structural haze (10ct+)', () => {
    const data = { clarity: 'SI1', color: 'G', carat: 12, keyToSymbols: ['Cloud'], comments: ['Cloud is not shown'] };
    const cloudInfo = extractCloudDescriptors(data);
    const result = evaluateMilkyRisk(data, cloudInfo);
    assertEqual(result !== null, true, 'Should detect risk');
    assertEqual(result.severity, 'CRITICAL', 'Should be CRITICAL');
    assertEqual(result.type, 'structural_haze', 'Should be structural haze');
  });

  test('evaluateMilkyRisk - no cloud', () => {
    const data = { clarity: 'SI1', color: 'G', carat: 1.5, keyToSymbols: ['Feather'], comments: [] };
    const cloudInfo = extractCloudDescriptors(data);
    const result = evaluateMilkyRisk(data, cloudInfo);
    assertEqual(result, null, 'Should return null');
  });

  // Test 5: evaluateHazyRisk
  test('evaluateHazyRisk - fatal combo', () => {
    const data = { clarity: 'SI1', color: 'D', fluorescence: 'Strong Blue', keyToSymbols: ['Cloud'], comments: [] };
    const cloudInfo = extractCloudDescriptors(data);
    const result = evaluateHazyRisk(data, cloudInfo);
    assertEqual(result !== null, true, 'Should detect risk');
    assertEqual(result.severity, 'CRITICAL', 'Should be CRITICAL');
    assertEqual(result.type, 'fatal_combo', 'Should be fatal combo');
  });

  test('evaluateHazyRisk - safe combination', () => {
    const data = { clarity: 'IF', color: 'D', fluorescence: 'Strong Blue', keyToSymbols: ['Feather'], comments: [] };
    const cloudInfo = extractCloudDescriptors(data);
    const result = evaluateHazyRisk(data, cloudInfo);
    assertEqual(result, null, 'Should return null for safe combination');
  });

  // Test 6: calculateClarityBasedOnClouds
  test('calculateClarityBasedOnClouds - cloud only', () => {
    const cloudInfo = { hasCloud: true, isPrimaryInclusion: true, isOnlyInclusion: true, cloudIndex: 0, keyToSymbolsLength: 1 };
    const result = calculateClarityBasedOnClouds(cloudInfo);
    assertEqual(result.scoreImpact, 3, 'Should be +3 for cloud only');
    assertEqual(result.type, 'positive', 'Should be positive');
  });

  test('calculateClarityBasedOnClouds - main cloud', () => {
    const cloudInfo = { hasCloud: true, isPrimaryInclusion: true, isOnlyInclusion: false, cloudIndex: 0, keyToSymbolsLength: 3 };
    const result = calculateClarityBasedOnClouds(cloudInfo);
    assertEqual(result.scoreImpact, -10, 'Should be -10 for main cloud');
    assertEqual(result.type, 'negative', 'Should be negative');
  });

  test('calculateClarityBasedOnClouds - no cloud', () => {
    const cloudInfo = { hasCloud: false };
    const result = calculateClarityBasedOnClouds(cloudInfo);
    assertEqual(result.scoreImpact, 0, 'Should be 0');
    assertEqual(result.label, null, 'Should have no label');
  });

  // Test 7: calculateTotalScoreImpact
  test('calculateTotalScoreImpact', () => {
    const flags = [
      { scoreImpact: -15 },
      { scoreImpact: -10 },
      { scoreImpact: 3 }
    ];
    assertEqual(calculateTotalScoreImpact(flags), -22, 'Total should be -22');
  });

  test('calculateTotalScoreImpact - empty', () => {
    assertEqual(calculateTotalScoreImpact([]), 0, 'Empty should be 0');
  });

  // Test 8: determineWorstSeverity
  test('determineWorstSeverity', () => {
    const flags = [
      { severity: 'LOW' },
      { severity: 'MEDIUM' },
      { severity: 'HIGH' },
      { severity: 'CRITICAL' }
    ];
    assertEqual(determineWorstSeverity(flags), 'CRITICAL', 'Should be CRITICAL');
  });

  // Test 9: analyzeCloudPosition - integration
  test('analyzeCloudPosition - fatal combo', () => {
    const data = {
      shape: 'Oval Brilliant',
      carat: 1.5,
      color: 'D',
      clarity: 'SI1',
      fluorescence: 'Strong Blue',
      keyToSymbols: ['Cloud', 'Feather', 'Crystal'],
      comments: []
    };
    const result = analyzeCloudPosition(data);
    assertEqual(result !== null, true, 'Should return result');
    assertEqual(result.hasRisk, true, 'Should have risk');
    assertEqual(result.type, 'cloud_analysis', 'Should be cloud_analysis');
  });

  test('analyzeCloudPosition - no cloud', () => {
    const data = {
      shape: 'Round Brilliant',
      carat: 1.0,
      color: 'G',
      clarity: 'VS1',
      fluorescence: 'None',
      keyToSymbols: ['Feather'],
      comments: []
    };
    const result = analyzeCloudPosition(data);
    assertEqual(result, null, 'Should return null for no cloud');
  });

  // Test 10: checkCloudPosition - legacy wrapper
  test('checkCloudPosition - legacy wrapper', () => {
    const data = {
      clarity: 'SI1',
      color: 'G',
      carat: 12,
      keyToSymbols: ['Cloud'],
      comments: ['Cloud is not shown']
    };
    const result = checkCloudPosition(data);
    assertEqual(result !== null, true, 'Should return result');
    assertEqual(result.type, 'critical', 'Should be critical type');
  });

  test('checkCloudPosition - no risk returns null', () => {
    const data = {
      clarity: 'IF',
      color: 'D',
      keyToSymbols: ['Feather'],
      comments: []
    };
    const result = checkCloudPosition(data);
    assertEqual(result, null, 'Should return null when no risk');
  });

  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===`);

  if (results.errors.length > 0) {
    console.log('\nFailed tests:');
    for (const err of results.errors) {
      console.log(`  - ${err}`);
    }
  }

  return results;
}

// ============================================================================
// TEST / DEBUG
// ============================================================================

// 測試用假數據
const testData = {
  shape: 'Oval Brilliant',
  carat: 1.5,
  color: 'G',
  clarity: 'SI1',
  fluorescence: 'Strong Blue',
  keyToSymbols: ['Cloud', 'Feather', 'Crystal'],
  comments: ['Cloud is not shown'],
  girdle: 'Medium to Slightly Thick'
};

// 執行測試
function runTest() {
  console.log('=== Cloud Position Analysis Test ===\n');

  // Phase 1: extractCloudDescriptors
  const cloudInfo = extractCloudDescriptors(testData);
  console.log('Phase 1 - Cloud Info:', JSON.stringify(cloudInfo, null, 2));

  // Phase 2: evaluateMilkyRisk
  const milkyRisk = evaluateMilkyRisk(testData, cloudInfo);
  console.log('\nPhase 2 - Milky Risk:', milkyRisk ? JSON.stringify(milkyRisk, null, 2) : 'None');

  // Phase 3: evaluateHazyRisk
  const hazyRisk = evaluateHazyRisk(testData, cloudInfo);
  console.log('\nPhase 3 - Hazy Risk:', hazyRisk ? JSON.stringify(hazyRisk, null, 2) : 'None');

  // Phase 4: calculateClarityBasedOnClouds
  const clarityImpact = calculateClarityBasedOnClouds(cloudInfo);
  console.log('\nPhase 4 - Clarity Impact:', JSON.stringify(clarityImpact, null, 2));

  // Phase 5: buildCloudFlags
  const flags = buildCloudFlags(cloudInfo, milkyRisk, hazyRisk, clarityImpact);
  console.log('\nPhase 5 - Flags:', JSON.stringify(flags, null, 2));

  // Full analysis
  const result = analyzeCloudPosition(testData);
  console.log('\n=== Full Analysis Result ===');
  console.log(JSON.stringify(result, null, 2));

  // Legacy wrapper test
  const legacy = checkCloudPosition(testData);
  console.log('\n=== Legacy checkCloudPosition() ===');
  console.log(legacy ? JSON.stringify(legacy, null, 2) : 'No risk found');

  // Score calculation
  const totalScore = calculateTotalScoreImpact(flags);
  console.log('\n=== Total Score Impact ===');
  console.log(`Total: ${totalScore}`);
}

// 如果直接運行此腳本，執行測試
if (require.main === module) {
  runTest();
  console.log('\n');
  runTests();
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Configuration
  RE,
  CLARITY_RANK,

  // Validation
  validateInput,

  // Main analysis function
  analyzeCloudPosition,

  // Sub-functions (for external use if needed)
  extractCloudDescriptors,
  evaluateMilkyRisk,
  evaluateHazyRisk,
  calculateClarityBasedOnClouds,
  buildCloudFlags,

  // Score calculation utilities
  calculateTotalScoreImpact,
  determineWorstSeverity,

  // Legacy wrapper (向後兼容)
  checkCloudPosition,

  // Test runner
  runTests
};

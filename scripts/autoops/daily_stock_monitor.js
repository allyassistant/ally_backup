#!/usr/bin/env node
/**
 * Qwen3 AutoOps - Module 1: Daily Stock Monitor (Fixed)
 *
 * 只喺有問題或重要報告先輸出
 *
 * 執行頻率：每週一 15:00
 * 日期：2026-02-15
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置
const HOME = process.env.HOME;
const CONFIG = {
    stockListPath: HOME + '/Desktop/Stock list',
    databasePath: HOME + '/.openclaw/workspace/memory/diamond_stock.json',
    historyPath: HOME + '/.openclaw/workspace/memory/stock-history.json',
    reportPath: HOME + '/.openclaw/workspace/reports',
    whatsappNumber: '+852XXXXXX',
    threshold: {
        slowMoving: 180,  // 滯銷天據
        warning: 120,     // 警告天據
        healthyTurnover: 90 // 健康周轉天據
    }
};

    // 確保報告目錄存在
    try {
        if (!fs.existsSync(CONFIG.reportPath)) {
            fs.mkdirSync(CONFIG.reportPath, { recursive: true });
        }
    } catch (error) {
        log('error', `❌ 創建報告目錄失敗: ${error.message}`);
    }

// 靜默模式（冇 console.log，除非有問題）
function log(level, message) {
    // 只喺有問題時輸出
    if (level === 'error' || level === 'alert') {
        console.log(message);
    }
}

/**
 * 讀取當前庫存據據
 */
function loadInventory() {
    try {
        if (!fs.existsSync(CONFIG.databasePath)) {
            return null;
        }
        const data = fs.readFileSync(CONFIG.databasePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        log('error', `❌ 讀取庫存失敗: ${error.message}`);
        return null;
    }
}

/**
 * 讀取歷史據據
 */
function loadHistory() {
    try {
        if (!fs.existsSync(CONFIG.historyPath)) {
            return { dailyRecords: [], lastCheck: null };
        }
        const data = fs.readFileSync(CONFIG.historyPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { dailyRecords: [], lastCheck: null };
    }
}

/**
 * 保存歷史據據
 */
function saveHistory(history) {
    try {
        fs.writeFileSync(CONFIG.historyPath, JSON.stringify(history, null, 2));
    } catch (error) {
        // 靜默處理
    }
}

/**
 * 分析庫存健康度
 */
function analyzeInventory(inventory) {
    if (!inventory) {
        return null;
    }

    const diamonds = Array.isArray(inventory) ? inventory : inventory.diamonds;

    if (!diamonds || !Array.isArray(diamonds) || diamonds.length === 0) {
        return null;
    }

    const today = new Date();

    let stats = {
        totalItems: diamonds.length,
        totalCarat: 0,
        totalValue: 0,
        slowMoving: [],      // >180天
        warning: [],         // 120-180天
        healthy: [],         // <120天
        byShape: {},
        byColor: {},
        avgDaysInStock: 0
    };

    let totalDays = 0;

    diamonds.forEach(diamond => {
        const price = parseFloat(diamond.memoPrice) || parseFloat(diamond.price) || 0;
        const carat = parseFloat(diamond.carat) || 0;

        stats.totalCarat += carat;
        stats.totalValue += price;

        const purchaseDate = diamond.purchaseDate || diamond.date || today;
        const daysInStock = Math.floor((today - new Date(purchaseDate)) / (1000 * 60 * 60 * 24));
        totalDays += daysInStock;

        if (daysInStock > CONFIG.threshold.slowMoving) {
            stats.slowMoving.push({ ...diamond, daysInStock });
        } else if (daysInStock > CONFIG.threshold.warning) {
            stats.warning.push({ ...diamond, daysInStock });
        } else {
            stats.healthy.push({ ...diamond, daysInStock });
        }

        const shape = diamond.shape || 'Unknown';
        if (!stats.byShape[shape]) {
            stats.byShape[shape] = { count: 0, carat: 0, value: 0 };
        }
        stats.byShape[shape].count++;
        stats.byShape[shape].carat += carat;
        stats.byShape[shape].value += price;

        const color = diamond.color || 'Unknown';
        if (!stats.byColor[color]) {
            stats.byColor[color] = { count: 0, value: 0 };
        }
        stats.byColor[color].count++;
        stats.byColor[color].value += price;
    });

    stats.avgDaysInStock = Math.round(totalDays / diamonds.length);

    const estimatedAnnualSales = stats.totalValue * 4;
    stats.turnoverRate = (estimatedAnnualSales / stats.totalValue).toFixed(1);

    const slowMovingRatio = stats.slowMoving.length / stats.totalItems;
    const warningRatio = stats.warning.length / stats.totalItems;
    stats.healthScore = Math.max(0, Math.round(100 - (slowMovingRatio * 50) - (warningRatio * 25)));

    return stats;
}

/**
 * 生成建議行動
 */
function generateRecommendations(stats) {
    const recommendations = [];

    if (stats.slowMoving.length > 0) {
        const topSlow = stats.slowMoving
            .sort((a, b) => b.daysInStock - a.daysInStock)
            .slice(0, 3);

        recommendations.push({
            priority: '🔴 緊急',
            action: '清理滯銷貨品',
            details: topSlow.map(d => `${d.parcel} (${d.daysInStock}天)`).join(', '),
            impact: `釋放 $${stats.slowMoving.reduce((sum, d) => sum + (parseFloat(d.memoPrice) || parseFloat(d.price) || 0), 0).toLocaleString()}`
        });
    }

    if (stats.warning.length > 0) {
        recommendations.push({
            priority: '🟡 注意',
            action: '密切監控',
            details: `${stats.warning.length} 粒貨品接近滯銷`,
            impact: '考慮主動推廣'
        });
    }

    return recommendations;
}

/**
 * 生成報告
 */
function generateReport(stats, recommendations) {
    const today = new Date().toLocaleDateString('zh-HK');
    const time = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });

    let report = `📊 庫存健康報告\n`;
    report += `═══════════════════════\n`;
    report += `📅 ${today} ${time}\n\n`;

    const healthEmoji = stats.healthScore >= 80 ? '🟢' : stats.healthScore >= 60 ? '🟡' : '🔴';
    report += `健康度: ${healthEmoji} ${stats.healthScore}/100\n`;
    report += `總件據: ${stats.totalItems} 粒\n`;
    report += `總價值: USD $${stats.totalValue.toLocaleString()}\n`;
    report += `平均庫存: ${stats.avgDaysInStock} 天\n\n`;

    report += `📦 分類:\n`;
    report += `🟢 健康: ${stats.healthy.length} 粒\n`;
    report += `🟡 警告: ${stats.warning.length} 粒\n`;
    report += `🔴 滯銷: ${stats.slowMoving.length} 粒\n\n`;

    if (recommendations.length > 0) {
        report += `🎯 建議:\n`;
        recommendations.slice(0, 2).forEach(rec => {
            report += `${rec.priority} ${rec.action}\n`;
        });
    }

    return report;
}

/**
 * 保存報告到文件
 */
function saveReport(report) {
    const today = new Date().toISOString().split('T')[0];
    const filename = `inventory_report_${today}.txt`;
    const filepath = path.join(CONFIG.reportPath, filename);

    try {
        fs.writeFileSync(filepath, report);
        return filepath;
    } catch (error) {
        return null;
    }
}

/**
 * 主函據
 */
function main() {
    const inventory = loadInventory();
    if (!inventory) {
        // 冇庫存數據 - 靜默結束
        process.exit(0);
    }

    const stats = analyzeInventory(inventory);
    if (!stats) {
        process.exit(0);
    }

    const recommendations = generateRecommendations(stats);
    const report = generateReport(stats, recommendations);
    const reportPath = saveReport(report);

    // 更新歷史
    const history = loadHistory();
    history.dailyRecords.push({
        date: new Date().toISOString(),
        totalItems: stats.totalItems,
        totalValue: stats.totalValue,
        healthScore: stats.healthScore,
        slowMovingCount: stats.slowMoving.length,
        warningCount: stats.warning.length,
        reportPath: reportPath
    });
    saveHistory(history);

    // 只喺有滯銷貨或健康度 < 60 先輸出 (發 WhatsApp)
    if (stats.slowMoving.length > 0 || stats.healthScore < 60) {
        log('alert', report);
        process.exit(1);  // 有問題，會觸發 WhatsApp
    }

    // 正常 - 靜默結束
    process.exit(0);
}

// 執行
if (require.main === module) {
    main();
}

module.exports = { main, analyzeInventory, generateReport };

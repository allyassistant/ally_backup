/**
 * Skill: Stock Management
 * 功能: 庫存管理、Stock List 處理
 */

const SKILL = {
  name: "stock_management",
  keywords: ["stock", "庫存", "inventory", "diamond stock", "存貨", "存倉"],
  intents: ["stock_check", "庫存檢查", "庫存管理", "睇庫存"],
  description: "庫存管理、Stock List 處理"
};

function checkStock(query) {
  return {
    skill: "stock_management",
    message: `📦 Stock Management\n\nSearch: ${query || 'All'}\n\n功能:\n• 檢查庫存\n• 搜索特定規格\n• 追蹤存貨變動\n• 生成庫存報告`,
    example: "show all RBC stock over 1 carat"
  };
}

function listStock(filter = {}) {
  return {
    skill: "stock_management",
    status: "ready",
    filters: filter,
    message: "📦 Stock List loaded. Use filters to search."
  };
}

module.exports = { skill: SKILL, checkStock, listStock };

/**
 * Skill: Quotation Generator
 * 功能: 報價單生成
 */

const SKILL = {
  name: "quotation_generator",
  keywords: ["quote", "報價", "quotation", "單", "報價單", " quotation"],
  intents: ["generate_quote", "生成報價", "做報價", "開價"],
  description: "生成報價單、報價文件"
};

function generateQuote(diamonds, options = {}) {
  return {
    skill: "quotation_generator",
    items: diamonds || [],
    options: {
      currency: options.currency || "USD",
      validDays: options.validDays || 7,
      discount: options.discount || 0
    },
    message: `📄 Quotation Generated\n\nItems: ${diamonds?.length || 0}\nValid: ${options.validDays || 7} days`,
    example: "quote for 3 pieces of RBC 1.5ct H VS1"
  };
}

function createInvoice(items, client) {
  return {
    skill: "quotation_generator",
    type: "invoice",
    client: client,
    items: items,
    message: `🧾 Invoice Created\nClient: ${client || 'N/A'}`
  };
}

module.exports = { skill: SKILL, generateQuote, createInvoice };

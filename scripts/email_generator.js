#!/usr/bin/env node
/**
 * Professional Email Generator
 * Creates business emails in multiple languages
 */

class EmailGenerator {
  constructor() {
    this.templates = {
      quotation: this.quotationTemplate,
      followUp: this.followUpTemplate,
      inquiry: this.inquiryTemplate,
      thankYou: this.thankYouTemplate
    };
  }

  generate(type, data, language = 'en') {
    const template = this.templates[type];
    if (!template) throw new Error(`Unknown template: ${type}`);
    return template(data, language);
  }

  quotationTemplate(data, lang) {
    const templates = {
      en: `Subject: Diamond Quotation - ${data.diamonds.length} Items

Dear ${data.customerName},

Thank you for your inquiry. Please find our quotation for the following diamonds:

${this.formatDiamondsList(data.diamonds, 'en')}

Total Value: USD ${data.total.toLocaleString()}
Valid Until: ${data.validUntil}

All diamonds are GIA certified and available for immediate viewing.

Please let me know if you have any questions.

Best regards,
${data.senderName}
${data.companyName}`,

      'zh-CN': `主题：钻石报价 - ${data.diamonds.length}颗

尊敬的${data.customerName}，

感谢您的询价。以下是我们提供的钻石报价：

${this.formatDiamondsList(data.diamonds, 'zh')}

总价值：USD ${data.total.toLocaleString()}
有效期至：${data.validUntil}

所有钻石均配有GIA证书，可立即安排看货。

如有任何問題，請隨時聯繫我。

此致
敬礼

${data.senderName}
${data.companyName}`,

      'zh-HK': `主旨：鑽石報價 - ${data.diamonds.length}粒

${data.customerName} 您好，

多謝你嘅查詢。以下係我哋提供嘅鑽石報價：

${this.formatDiamondsList(data.diamonds, 'zh')}

總價值：USD ${data.total.toLocaleString()}
有效期至：${data.validUntil}

所有鑽石都有 GIA 證書，可以即刻安排睇貨。

如有任何問題，歡迎隨時聯絡我。

順祝
商祺

${data.senderName}
${data.companyName}`
    };

    return templates[lang] || templates.en;
  }

  formatDiamondsList(diamonds, lang) {
    return diamonds.map((d, i) => {
      if (lang === 'zh' || lang === 'zh-HK' || lang === 'zh-CN') {
        return `${i + 1}. ${d.shape} ${d.carat}卡 ${d.color}色 ${d.clarity} - USD ${d.price.toLocaleString()}`;
      }
      return `${i + 1}. ${d.carat}ct ${d.color} ${d.clarity} ${d.shape} - USD ${d.price.toLocaleString()}`;
    }).join('\n');
  }

  inquiryTemplate(data, lang) {
    const templates = {
      en: `Subject: Diamond Inquiry - ${data.specs}

Dear Sir/Madam,

I am writing to inquire about diamonds with the following specifications:

• Shape: ${data.shape || 'Any'}
• Carat: ${data.caratRange || 'Flexible'}
• Color: ${data.color || 'D-J'}
• Clarity: ${data.clarity || 'IF-SI1'}
• Budget: ${data.budget ? 'USD ' + data.budget.toLocaleString() : 'Open'}

Please send me available options with GIA certificates.

Best regards,
${data.name}`,

      'zh-HK': `主旨：鑽石查詢 - ${data.specs}

您好，

我想查詢以下規格嘅鑽石：

• 形狀：${data.shape || '不限'}
• 卡數：${data.caratRange || '可議'}
• 顏色：${data.color || 'D-J'}
• 淨度：${data.clarity || 'IF-SI1'}
• 預算：${data.budget ? 'USD ' + data.budget.toLocaleString() : '不限'}

請發送有 GIA 證書嘅選項俾我。

多謝
${data.name}`
    };

    return templates[lang] || templates.en;
  }

  followUpTemplate(data, lang) {
    const templates = {
      en: `Subject: Follow-up on Diamond Quotation

Dear ${data.customerName},

I hope this email finds you well.

I wanted to follow up on the quotation I sent on ${data.quotationDate} regarding ${data.diamondCount} diamond(s).

Have you had a chance to review it? I would be happy to:
- Provide additional details
- Arrange a viewing
- Adjust the selection based on your feedback

Looking forward to hearing from you.

Best regards,
${data.senderName}`,

      'zh-HK': `主旨：報價跟進

${data.customerName} 您好，

想跟進返 ${data.quotationDate} 發送俾你嘅報價，關於 ${data.diamondCount} 粒鑽石。

唔知你有冇時間睇過呢？我可以幫你：
- 提供更多詳情
- 安排睇貨
- 根據你嘅意見調整選擇

期待你嘅回覆。

順祝
商祺
${data.senderName}`
    };

    return templates[lang] || templates.en;
  }

  thankYouTemplate(data, lang) {
    const templates = {
      en: `Subject: Thank You for Your Purchase

Dear ${data.customerName},

Thank you for your purchase of:

${this.formatDiamondsList(data.diamonds, 'en')}

Total: USD ${data.total.toLocaleString()}

It has been a pleasure working with you. Please don't hesitate to contact me for any future diamond needs.

Best regards,
${data.senderName}`,

      'zh-HK': `主旨：多謝你嘅購買

${data.customerName} 您好，

多謝你購買以下鑽石：

${this.formatDiamondsList(data.diamonds, 'zh-HK')}

總額：USD ${data.total.toLocaleString()}

好開心可以為你服務。以後有任何鑽石需要，歡迎隨時聯絡我。

順祝
商祺
${data.senderName}`
    };

    return templates[lang] || templates.en;
  }
}

module.exports = EmailGenerator;

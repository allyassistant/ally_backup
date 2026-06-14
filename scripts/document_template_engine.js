#!/usr/bin/env node
/**
 * Document Template Engine
 * Fills templates with diamond data
 */

class DocumentTemplateEngine {
  constructor() {
    this.templates = {
      quotation: this.quotationTemplate,
      invoice: this.invoiceTemplate,
      memo: this.memoTemplate,
      certificate: this.certificateTemplate
    };
  }

  fill(templateName, data) {
    const template = this.templates[templateName];
    if (!template) throw new Error(`Unknown template: ${templateName}`);
    return template(data);
  }

  quotationTemplate(data) {
    return {
      type: 'quotation',
      id: `Q-${Date.now()}`,
      date: getHKTDateTime(),
      validUntil: this.addDays(7),
      seller: data.seller,
      buyer: data.buyer,
      items: data.diamonds.map(d => ({
        ...d,
        lineTotal: d.price * d.quantity
      })),
      subtotal: 0,
      tax: 0,
      total: 0,
      terms: data.terms || this.defaultTerms()
    };
  }

  invoiceTemplate(data) {
    return {
      type: 'invoice',
      id: `INV-${Date.now()}`,
      date: getHKTDateTime(),
      dueDate: this.addDays(30),
      seller: data.seller,
      buyer: data.buyer,
      reference: data.quotationId,
      items: data.items,
      subtotal: 0,
      tax: 0,
      total: 0,
      paymentTerms: data.paymentTerms || 'Net 30',
      bankDetails: data.bankDetails
    };
  }

  memoTemplate(data) {
    return {
      type: 'memo',
      id: `M-${Date.now()}`,
      date: getHKTDateTime(),
      from: data.seller,
      to: data.buyer,
      items: data.diamonds,
      memoTerms: data.memoTerms || this.defaultMemoTerms(),
      returnDate: this.addDays(data.memoDays || 30)
    };
  }

  certificateTemplate(data) {
    return {
      type: 'certificate',
      diamond: data.diamond,
      verification: {
        giaReport: data.diamond.giaNumber,
        verifiedDate: getHKTDateTime(),
        verifiedBy: data.verifier
      }
    };
  }

  defaultTerms() {
    return [
      'Prices are in USD and subject to availability',
      'Valid for 7 days from date of quotation',
      'Payment terms: Wire transfer within 5 business days',
      'All diamonds are GIA certified',
      'Subject to final inspection'
    ];
  }

  defaultMemoTerms() {
    return [
      'Items on memo must be returned or purchased within agreed period',
      'Seller retains ownership until payment received',
      'Buyer responsible for insurance during memo period',
      'Items must be returned in original condition'
    ];
  }

  addDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return getHKTDateTime();
  }
}

module.exports = DocumentTemplateEngine;

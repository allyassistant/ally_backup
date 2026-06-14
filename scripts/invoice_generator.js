#!/usr/bin/env node
/**
 * Professional Invoice Generator
 * Creates formatted invoices from sales data
 */

const { getHKTDate, getHKTDateTime } = require('./lib/time');

class InvoiceGenerator {
  constructor(companyInfo) {
    this.company = companyInfo;
    this.invoiceNumber = this.loadCounter();
  }

  loadCounter() {
    try {
      const data = require('fs').readFileSync('./invoice-counter.json', 'utf8');
      return JSON.parse(data).lastNumber;
    } catch {
      return 1000;
    }
  }

  saveCounter() {
    const fs = require('fs');
    fs.writeFileSync('./invoice-counter.json', JSON.stringify({
      lastNumber: this.invoiceNumber
    }));
  }

  generate(saleData) {
    this.invoiceNumber++;
    this.saveCounter();

    const invoice = {
      number: `INV-${this.invoiceNumber.toString().padStart(5, '0')}`,
      date: getHKTDate(),
      dueDate: this.calculateDueDate(saleData.terms),

      seller: this.company,
      buyer: saleData.customer,

      items: saleData.items.map(item => ({
        description: this.formatItemDescription(item),
        quantity: item.quantity || 1,
        unitPrice: item.price,
        amount: (item.quantity || 1) * item.price
      })),

      subtotal: 0,
      tax: {
        rate: saleData.taxRate || 0,
        amount: 0
      },
      total: 0,

      paymentInfo: {
        method: saleData.paymentMethod || 'Wire Transfer',
        terms: saleData.terms || 'Net 30',
        bankDetails: this.company.bankDetails
      },

      notes: saleData.notes || []
    };

    // Calculate totals
    invoice.subtotal = invoice.items.reduce((sum, i) => sum + i.amount, 0);
    invoice.tax.amount = invoice.subtotal * (invoice.tax.rate / 100);
    invoice.total = invoice.subtotal + invoice.tax.amount;

    return invoice;
  }

  formatItemDescription(item) {
    if (item.type === 'diamond') {
      return `${item.carat}ct ${item.color} ${item.clarity} ${item.shape} Diamond (GIA: ${item.giaNumber})`;
    }
    return item.description;
  }

  calculateDueDate(terms) {
    const days = terms === 'Net 15' ? 15 : terms === 'Net 30' ? 30 : 7;
    const date = new Date();
    date.setDate(date.getDate() + days);
    return getHKTDateTime();
  }

  toText(invoice) {
    let text = `
INVOICE
${'='.repeat(50)}

Invoice #: ${invoice.number}
Date: ${new Date(invoice.date).toLocaleDateString()}
Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}

FROM:
${invoice.seller.name}
${invoice.seller.address}
Tel: ${invoice.seller.phone}
Email: ${invoice.seller.email}

TO:
${invoice.buyer.name}
${invoice.buyer.address}

ITEMS:
${'-'.repeat(50)}
${invoice.items.map(i =>
  `${i.description}\n  Qty: ${i.quantity} x USD ${i.unitPrice.toLocaleString()} = USD ${i.amount.toLocaleString()}`
).join('\n')}
${'-'.repeat(50)}

Subtotal: USD ${invoice.subtotal.toLocaleString()}
Tax (${invoice.tax.rate}%): USD ${invoice.tax.amount.toLocaleString()}
TOTAL: USD ${invoice.total.toLocaleString()}

Payment Terms: ${invoice.paymentInfo.terms}
Payment Method: ${invoice.paymentInfo.method}

${invoice.notes.length > 0 ? '\nNotes:\n' + invoice.notes.join('\n') : ''}
    `.trim();

    return text;
  }
}

module.exports = InvoiceGenerator;

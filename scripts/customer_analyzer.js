#!/usr/bin/env node
/**
 * Customer Behavior Analyzer
 * Analyzes purchase patterns and preferences
 */

class CustomerAnalyzer {
  constructor() {
    this.segments = {
      vip: { minSpend: 100000, label: 'VIP' },
      regular: { minSpend: 10000, label: 'Regular' },
      new: { minSpend: 0, label: 'New' }
    };
  }

  analyzeCustomer(customerId, transactions) {
    const customerTx = transactions.filter(t => t.customerId === customerId);
    
    if (customerTx.length === 0) return null;

    const analysis = {
      customerId,
      totalPurchases: customerTx.length,
      totalSpend: customerTx.reduce((s, t) => s + t.amount, 0),
      avgPurchaseValue: 0,
      preferences: this.analyzePreferences(customerTx),
      purchasePattern: this.analyzePattern(customerTx),
      segment: this.determineSegment(customerTx),
      lifetimeValue: this.calculateLTV(customerTx),
      nextPurchasePrediction: this.predictNextPurchase(customerTx)
    };

    analysis.avgPurchaseValue = analysis.totalSpend / analysis.totalPurchases;

    return analysis;
  }

  analyzePreferences(transactions) {
    const prefs = {
      shapes: this.countFrequency(transactions.map(t => t.shape)),
      colors: this.countFrequency(transactions.map(t => t.color)),
      clarities: this.countFrequency(transactions.map(t => t.clarity)),
      caratRange: this.getCaratRange(transactions.map(t => t.carat)),
      priceRange: this.getPriceRange(transactions.map(t => t.amount))
    };

    return prefs;
  }

  countFrequency(items) {
    const counts = {};
    items.forEach(item => {
      counts[item] = (counts[item] || 0) + 1;
    });
    
    // Sort by frequency
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => ({ item: key, count }));
  }

  getCaratRange(carat) {
    if (!carat || carat.length === 0) return { min: 0, max: 0, avg: '0.00' };
    const min = Math.min(...carat);
    const max = Math.max(...carat);
    const avg = carat.reduce((a, b) => a + b, 0) / carat.length;
    return { min, max, avg: avg.toFixed(2) };
  }

  getPriceRange(prices) {
    if (!prices || prices.length === 0) return { min: 0, max: 0, avg: 0 };
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { min, max, avg: Math.round(avg) };
  }

  analyzePattern(transactions) {
    const sorted = transactions.sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    if (sorted.length < 2) return { type: 'single_purchase' };

    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].date) - new Date(sorted[i-1].date)) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    return {
      type: avgInterval < 30 ? 'frequent' : avgInterval < 90 ? 'regular' : 'occasional',
      avgDaysBetweenPurchases: Math.round(avgInterval),
      totalPurchases: transactions.length
    };
  }

  determineSegment(transactions) {
    const totalSpend = transactions.reduce((s, t) => s + t.amount, 0);
    
    if (totalSpend >= this.segments.vip.minSpend) return this.segments.vip.label;
    if (totalSpend >= this.segments.regular.minSpend) return this.segments.regular.label;
    return this.segments.new.label;
  }

  calculateLTV(transactions) {
    const avgOrder = transactions.reduce((s, t) => s + t.amount, 0) / transactions.length;
    const frequency = transactions.length;
    
    // Predict 3-year LTV
    return Math.round(avgOrder * frequency * 3);
  }

  predictNextPurchase(transactions) {
    const sorted = transactions.sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );

    if (sorted.length < 2) return { confidence: 'low', prediction: null };

    const lastPurchase = new Date(sorted[0].date);
    const pattern = this.analyzePattern(transactions);
    
    const predictedDate = new Date(lastPurchase);
    predictedDate.setDate(predictedDate.getDate() + pattern.avgDaysBetweenPurchases);

    return {
      confidence: pattern.type === 'frequent' ? 'high' : 'medium',
      predictedDate: predictedDate.toISOString(),
      daysUntil: Math.round((predictedDate - new Date()) / (1000 * 60 * 60 * 24)),
      likelyCategory: this.analyzePreferences(transactions).shapes[0]?.item
    };
  }
}

module.exports = CustomerAnalyzer;

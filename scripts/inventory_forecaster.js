#!/usr/bin/env node
/**
 * Inventory Demand Forecaster
 * Predicts stock needs based on historical data
 */

class InventoryForecaster {
  constructor(config = {}) {
    this.config = {
      forecastDays: config.forecastDays || 30,
      seasonality: config.seasonality || true,
      confidenceLevel: config.confidenceLevel || 0.95
    };
  }

  analyzeHistorical(salesData) {
    // Calculate basic statistics
    const stats = {
      totalSales: salesData.length,
      totalCarats: salesData.reduce((s, d) => s + d.carat, 0),
      avgSaleValue: salesData.length > 0 ? salesData.reduce((s, d) => s + d.price, 0) / salesData.length : 0,
      byShape: this.groupBy(salesData, 'shape'),
      byColor: this.groupBy(salesData, 'color'),
      byMonth: this.groupByMonth(salesData)
    };

    return stats;
  }

  groupBy(data, key) {
    const grouped = {};
    data.forEach(item => {
      const val = item[key];
      grouped[val] = grouped[val] || [];
      grouped[val].push(item);
    });
    
    // Calculate stats per group
    const result = {};
    for (const [k, items] of Object.entries(grouped)) {
      result[k] = {
        count: items.length,
        avgCarat: items.length > 0 ? items.reduce((s, i) => s + i.carat, 0) / items.length : 0,
        avgPrice: items.length > 0 ? items.reduce((s, i) => s + i.price, 0) / items.length : 0
      };
    }
    return result;
  }

  groupByMonth(data) {
    const grouped = {};
    data.forEach(item => {
      const month = new Date(item.date).toISOString().slice(0, 7);
      grouped[month] = grouped[month] || [];
      grouped[month].push(item);
    });
    return grouped;
  }

  forecastDemand(historicalData, days = 30) {
    const stats = this.analyzeHistorical(historicalData);
    
    // Simple moving average forecast
    const monthCount = Object.keys(stats.byMonth).length;
    const monthlyAvg = monthCount > 0 ? stats.totalSales / monthCount : 0;
    const dailyAvg = monthlyAvg / 30;
    
    const forecast = {
      period: days,
      predictedSales: Math.round(dailyAvg * days),
      predictedCarats: stats.totalSales > 0 ? Math.round(dailyAvg * days * stats.totalCarats / stats.totalSales) : 0,
      byShape: {},
      byColor: {},
      confidence: this.calculateConfidence(historicalData)
    };

    // Forecast by category
    for (const [shape, data] of Object.entries(stats.byShape)) {
      const ratio = data.count / stats.totalSales;
      forecast.byShape[shape] = Math.round(forecast.predictedSales * ratio);
    }

    return forecast;
  }

  calculateConfidence(data) {
    // Simplified confidence calculation
    const variance = this.calculateVariance(data.map(d => d.price));
    const stdDev = Math.sqrt(variance);
    const mean = data.reduce((s, d) => s + d.price, 0) / data.length;
    
    return {
      mean,
      stdDev,
      interval: {
        lower: mean - 1.96 * stdDev,
        upper: mean + 1.96 * stdDev
      }
    };
  }

  calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  generateRestockRecommendations(currentStock, forecast) {
    const recommendations = [];
    
    for (const [shape, predictedDemand] of Object.entries(forecast.byShape)) {
      const current = currentStock.filter(s => s.shape === shape).length;
      const gap = predictedDemand - current;
      
      if (gap > 0) {
        recommendations.push({
          shape,
          current,
          predictedDemand,
          gap,
          priority: gap > predictedDemand * 0.5 ? 'high' : 'medium',
          action: `Restock ${shape}: need ${gap} more units`
        });
      }
    }

    return recommendations.sort((a, b) => b.gap - a.gap);
  }
}

module.exports = InventoryForecaster;

#!/usr/bin/env node
/**
 * Automated Excel Report Generator
 * Creates formatted reports from stock data
 */

const fs = require('fs');
const path = require('path');
const { getHKTDate, getHKTDateTime } = require('./lib/time');

class ExcelReportGenerator {
  constructor() {
    this.templates = {
      daily: this.generateDailyReport,
      monthly: this.generateMonthlyReport,
      inventory: this.generateInventoryReport
    };
  }

  generateDailyReport(stockData, date) {
    const summary = this.calculateSummary(stockData);

    return {
      metadata: {
        title: `Daily Stock Report - ${date}`,
        generatedAt: getHKTDateTime()
      },
      summary: {
        totalItems: summary.totalItems,
        totalCarats: summary.totalCarats,
        totalValue: summary.totalValue,
        newItems: summary.newItems,
        soldItems: summary.soldItems
      },
      byShape: summary.byShape,
      byColor: summary.byColor,
      topItems: summary.topItems
    };
  }

  calculateSummary(stock) {
    const byShape = {};
    const byColor = {};

    stock.forEach(item => {
      // By shape
      byShape[item.shape] = byShape[item.shape] || { count: 0, carats: 0 };
      byShape[item.shape].count++;
      byShape[item.shape].carats += item.carat || 0;

      // By color
      byColor[item.color] = byColor[item.color] || { count: 0, carats: 0 };
      byColor[item.color].count++;
      byColor[item.color].carats += item.carat || 0;
    });

    return {
      totalItems: stock.length,
      totalCarats: stock.reduce((s, i) => s + (i.carat || 0), 0),
      totalValue: stock.reduce((s, i) => s + (i.price || 0), 0),
      byShape,
      byColor,
      topItems: stock.slice(0, 10)
    };
  }

  generateMonthlyReport(monthData) {
    return {
      metadata: {
        title: `Monthly Report - ${monthData.month}`,
        generatedAt: getHKTDateTime()
      },
      trends: monthData.trends,
      topCustomers: monthData.customers,
      revenue: monthData.revenue,
      inventoryChanges: monthData.changes
    };
  }

  generateInventoryReport(stock) {
    return {
      metadata: {
        title: 'Current Inventory Report',
        generatedAt: getHKTDateTime()
      },
      aging: this.calculateAging(stock),
      slowMoving: this.findSlowMoving(stock),
      recommendations: this.generateRecommendations(stock)
    };
  }

  calculateAging(stock) {
    // Calculate how long items have been in inventory
    return stock.map(item => ({
      ...item,
      daysInStock: Math.floor((Date.now() - new Date(item.dateIn).getTime()) / (1000 * 60 * 60 * 24))
    }));
  }

  findSlowMoving(stock) {
    const aged = this.calculateAging(stock);
    return aged.filter(item => item.daysInStock > 90);
  }

  generateRecommendations(stock) {
    const recommendations = [];
    const slowMoving = this.findSlowMoving(stock);

    if (slowMoving.length > 10) {
      recommendations.push({
        type: 'pricing',
        priority: 'high',
        message: `${slowMoving.length} items over 90 days - consider discounting`
      });
    }

    return recommendations;
  }
}

module.exports = ExcelReportGenerator;

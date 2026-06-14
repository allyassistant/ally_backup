#!/usr/bin/env node
/**
 * Diamond Price Predictor
 * Predicts price trends based on market data
 */

const { getHKTDateTime } = require('./lib/time');

class PricePredictor {
  constructor() {
    this.factors = {
      rapaport: 0.6,
      market: 0.2,
      seasonality: 0.1,
      trend: 0.1
    };
  }

  predict(diamond, marketData, horizon = '30d') {
    const currentPrice = diamond.price;

    // Calculate trend factors
    const rapaportTrend = this.getRapaportTrend(marketData.rapaport, diamond);
    const marketSentiment = this.getMarketSentiment(marketData);
    const seasonalFactor = this.getSeasonalFactor();

    // Weighted prediction
    const priceChange = (
      rapaportTrend * this.factors.rapaport +
      marketSentiment * this.factors.market +
      seasonalFactor * this.factors.seasonality
    );

    const predictedPrice = currentPrice * (1 + priceChange);

    return {
      current: currentPrice,
      predicted: Math.round(predictedPrice),
      change: priceChange,
      changePercent: (priceChange * 100).toFixed(2),
      factors: {
        rapaport: rapaportTrend,
        market: marketSentiment,
        seasonal: seasonalFactor
      },
      horizon,
      confidence: this.calculateConfidence(diamond, marketData)
    };
  }

  getRapaportTrend(rapaportData, diamond) {
    // Simplified - would use actual historical comparison
    const key = `${diamond.shape}_${diamond.color}_${diamond.clarity}`;
    const recent = rapaportData[key];

    if (!recent) return 0;

    // Return weekly change
    return (recent.current - recent.previous) / recent.previous;
  }

  getMarketSentiment(marketData) {
    // Analyze news and market indicators
    if (!marketData.sentiment) return 0;

    const sentiment = marketData.sentiment;
    if (sentiment === 'bullish') return 0.05;
    if (sentiment === 'bearish') return -0.05;
    return 0;
  }

  getSeasonalFactor() {
    const month = new Date().getMonth();

    // Peak seasons: Nov-Dec (holiday), Jan-Feb (Chinese New Year), May (Mother's Day)
    const peakMonths = [0, 1, 4, 10, 11];
    const slowMonths = [6, 7, 8]; // Summer slowdown

    if (peakMonths.includes(month)) return 0.03;
    if (slowMonths.includes(month)) return -0.02;
    return 0;
  }

  calculateConfidence(diamond, marketData) {
    // Higher confidence for common specs
    const commonSpecs = ['G', 'H', 'VS1', 'VS2'];
    const specScore = commonSpecs.includes(diamond.color) ||
                      commonSpecs.includes(diamond.clarity) ? 0.8 : 0.6;

    // Higher confidence with more data
    const dataScore = marketData.historical ? 0.9 : 0.7;

    return (specScore + dataScore) / 2;
  }

  generatePriceReport(diamonds, marketData) {
    const predictions = diamonds.map(d => ({
      diamond: d,
      prediction: this.predict(d, marketData)
    }));

    return {
      generatedAt: getHKTDateTime(),
      marketSentiment: marketData.sentiment || 'neutral',
      predictions: predictions.sort((a, b) =>
        parseFloat(b.prediction.changePercent) - parseFloat(a.prediction.changePercent)
      ),
      summary: {
        bullish: predictions.filter(p => parseFloat(p.prediction.changePercent) > 0).length,
        bearish: predictions.filter(p => parseFloat(p.prediction.changePercent) < 0).length,
        neutral: predictions.filter(p => parseFloat(p.prediction.changePercent) === 0).length
      }
    };
  }
}

module.exports = PricePredictor;

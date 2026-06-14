#!/usr/bin/env node
/**
 * Churn Prediction System
 * Identifies customers at risk of leaving
 */

const { getHKTDateTime } = require('./lib/time');

class ChurnPredictor {
  constructor(customer360) {
    this.customer360 = customer360;
    this.riskFactors = {
      noPurchase90Days: 40,
      noResponse: 30,
      decliningEngagement: 20,
      priceSensitive: 10
    };
  }

  predictChurnRisk(customerId) {
    const profile = this.customer360.getProfile(customerId);
    if (!profile) return null;

    let riskScore = 0;
    const factors = [];

    // Factor 1: Days since last purchase
    const lastPurchase = profile.purchases.length > 0
      ? new Date(profile.purchases[profile.purchases.length - 1].date)
      : null;

    if (lastPurchase) {
      const daysSince = (new Date() - lastPurchase) / (1000 * 60 * 60 * 24);

      if (daysSince > 180) {
        riskScore += this.riskFactors.noPurchase90Days;
        factors.push({ factor: 'no_purchase_180d', weight: this.riskFactors.noPurchase90Days });
      } else if (daysSince > 90) {
        riskScore += Math.round(this.riskFactors.noPurchase90Days * 0.6);
        factors.push({ factor: 'no_purchase_90d', weight: Math.round(this.riskFactors.noPurchase90Days * 0.6) });
      }
    } else {
      // Never purchased - high risk if no inquiry recently
      const lastInquiry = profile.interactions.length > 0
        ? new Date(profile.interactions[profile.interactions.length - 1].timestamp)
        : null;

      if (!lastInquiry || (new Date() - lastInquiry) / (1000 * 60 * 60 * 24) > 30) {
        riskScore += 50;
        factors.push({ factor: 'no_activity', weight: 50 });
      }
    }

    // Factor 2: Response rate to communications
    const sentInteractions = profile.interactions.filter(i => i.type === 'outbound');
    const receivedResponses = profile.interactions.filter(i => i.type === 'inbound');

    if (sentInteractions.length > 3) {
      const responseRate = receivedResponses.length / sentInteractions.length;
      if (responseRate < 0.3) {
        riskScore += this.riskFactors.noResponse;
        factors.push({ factor: 'low_response_rate', weight: this.riskFactors.noResponse });
      }
    }

    // Factor 3: Declining engagement (fewer interactions over time)
    const recentInteractions = profile.interactions.filter(i => {
      const daysAgo = (new Date() - new Date(i.timestamp)) / (1000 * 60 * 60 * 24);
      return daysAgo <= 90;
    });

    const olderInteractions = profile.interactions.filter(i => {
      const daysAgo = (new Date() - new Date(i.timestamp)) / (1000 * 60 * 60 * 24);
      return daysAgo > 90 && daysAgo <= 180;
    });

    if (olderInteractions.length > 0 && recentInteractions.length < olderInteractions.length * 0.5) {
      riskScore += this.riskFactors.decliningEngagement;
      factors.push({ factor: 'declining_engagement', weight: this.riskFactors.decliningEngagement });
    }

    // Determine risk level
    let riskLevel = 'low';
    if (riskScore >= 60) riskLevel = 'high';
    else if (riskScore >= 30) riskLevel = 'medium';

    return {
      customerId,
      riskScore: Math.min(riskScore, 100),
      riskLevel,
      factors,
      lastUpdated: getHKTDateTime(),
      recommendedAction: this.getRecommendedAction(riskLevel, factors)
    };
  }

  getRecommendedAction(riskLevel, factors) {
    const actions = {
      high: [
        'Schedule personal call within 24 hours',
        'Offer exclusive discount',
        'Send personalized gift'
      ],
      medium: [
        'Send follow-up email with new arrivals',
        'Offer virtual consultation',
        'Share educational content'
      ],
      low: [
        'Include in regular newsletter',
        'Send seasonal greetings',
        'Share market updates'
      ]
    };

    return actions[riskLevel] || actions.low;
  }

  getAllAtRiskProfiles(threshold = 'medium') {
    const profiles = this.customer360.getAllProfiles();
    const predictions = profiles.map(p => this.predictChurnRisk(p.customerId));

    const levelMap = { high: 3, medium: 2, low: 1 };
    const thresholdLevel = levelMap[threshold] || 2;

    return predictions
      .filter(p => p && levelMap[p.riskLevel] >= thresholdLevel)
      .sort((a, b) => b.riskScore - a.riskScore);
  }

  generateRetentionCampaign(targetRiskLevel = 'high') {
    const atRisk = this.getAllAtRiskProfiles(targetRiskLevel);

    return {
      campaignName: `${targetRiskLevel.toUpperCase()} Risk Retention Campaign`,
      targetCount: atRisk.length,
      customers: atRisk.map(p => ({
        customerId: p.customerId,
        riskScore: p.riskScore,
        recommendedActions: p.recommendedAction
      })),
      estimatedBudget: atRisk.length * 100, // $100 per customer
      suggestedTimeline: '2 weeks'
    };
  }
}

module.exports = ChurnPredictor;

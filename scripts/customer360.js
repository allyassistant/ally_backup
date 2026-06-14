#!/usr/bin/env node
/**
 * Customer 360° View System
 * Unified customer profile with all interactions
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

class Customer360 {
  constructor(dataDir = './data/customers') {
    this.dataDir = dataDir;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      console.error('Error creating directory: ' + e.message);
    }
  }

  buildProfile(customerId, data = {}) {
    const profile = {
      customerId,
      createdAt: getHKTDateTime(),
      updatedAt: getHKTDateTime(),

      // Basic info
      basic: {
        name: data.name || '',
        company: data.company || '',
        email: data.email || '',
        phone: data.phone || '',
        preferredContact: data.preferredContact || 'email',
        language: data.language || 'en'
      },

      // Purchase history
      purchases: data.purchases || [],

      // Interactions (emails, calls, meetings)
      interactions: data.interactions || [],

      // Preferences
      preferences: {
        shapes: [],
        colors: [],
        clarities: [],
        caratRange: { min: 0, max: 0 },
        priceRange: { min: 0, max: 0 },
        ...data.preferences
      },

      // Engagement metrics
      engagement: {
        lastContact: null,
        totalInquiries: 0,
        responseRate: 0,
        preferredContactTime: null
      },

      // Computed insights
      insights: {
        segment: 'new',
        lifetimeValue: 0,
        nextPurchasePrediction: null,
        churnRisk: 'low'
      }
    };

    this.saveProfile(profile);
    return profile;
  }

  addPurchase(customerId, purchase) {
    const profile = this.getProfile(customerId);
    if (!profile) return null;

    profile.purchases.push({
      ...purchase,
      date: getHKTDateTime()
    });

    // Update preferences based on purchase
    this.updatePreferencesFromPurchase(profile, purchase);

    // Recalculate insights
    this.recalculateInsights(profile);

    profile.updatedAt = getHKTDateTime();
    this.saveProfile(profile);

    return profile;
  }

  addInteraction(customerId, interaction) {
    const profile = this.getProfile(customerId);
    if (!profile) return null;

    profile.interactions.push({
      ...interaction,
      timestamp: getHKTDateTime()
    });

    profile.engagement.lastContact = getHKTDateTime();
    profile.engagement.totalInquiries++;

    profile.updatedAt = getHKTDateTime();
    this.saveProfile(profile);

    return profile;
  }

  updatePreferencesFromPurchase(profile, purchase) {
    const { diamond } = purchase;
    if (!diamond) return;

    // Update shape preference
    if (!profile.preferences.shapes.includes(diamond.shape)) {
      profile.preferences.shapes.push(diamond.shape);
    }

    // Update color preference
    if (!profile.preferences.colors.includes(diamond.color)) {
      profile.preferences.colors.push(diamond.color);
    }

    // Update carat range
    const carat = parseFloat(diamond.carat);
    if (carat > profile.preferences.caratRange.max) {
      profile.preferences.caratRange.max = carat;
    }
    if (profile.preferences.caratRange.min === 0 || carat < profile.preferences.caratRange.min) {
      profile.preferences.caratRange.min = carat;
    }

    // Update price range
    if (purchase.amount > profile.preferences.priceRange.max) {
      profile.preferences.priceRange.max = purchase.amount;
    }
    if (profile.preferences.priceRange.min === 0 || purchase.amount < profile.preferences.priceRange.min) {
      profile.preferences.priceRange.min = purchase.amount;
    }
  }

  recalculateInsights(profile) {
    const totalSpend = profile.purchases.reduce((s, p) => s + p.amount, 0);
    const purchaseCount = profile.purchases.length;

    // Segment
    if (totalSpend >= 100000) profile.insights.segment = 'vip';
    else if (totalSpend >= 10000) profile.insights.segment = 'regular';
    else profile.insights.segment = 'new';

    // Lifetime value (3-year estimate)
    const avgOrder = purchaseCount > 0 ? totalSpend / purchaseCount : 0;
    const frequency = purchaseCount;
    profile.insights.lifetimeValue = Math.round(avgOrder * frequency * 3);

    // Churn risk
    profile.insights.churnRisk = this.calculateChurnRisk(profile);
  }

  calculateChurnRisk(profile) {
    const lastPurchase = profile.purchases.length > 0
      ? new Date(profile.purchases[profile.purchases.length - 1].date)
      : null;

    if (!lastPurchase) return 'high';

    const daysSince = (new Date() - lastPurchase) / (1000 * 60 * 60 * 24);

    if (daysSince > 180) return 'high';
    if (daysSince > 90) return 'medium';
    return 'low';
  }

  getProfile(customerId) {
    // Validate customerId to prevent path traversal
    if (!customerId || typeof customerId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(customerId)) {
      console.error(`⚠️ Invalid customer ID: ${customerId}`);
      return null;
    }
    const filePath = path.join(this.dataDir, `${customerId}.json`);
    try {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.error(`⚠️ Failed to parse customer file ${customerId}:`, e.message);
        return null;
      }
    } catch {
      return null;
    }
  }

  saveProfile(profile) {
    const filePath = path.join(this.dataDir, `${profile.customerId}.json`);
    try {
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(profile, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
  }

  getAllProfiles() {
    try {
      const files = fs.readdirSync(this.dataDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => this.getProfile(f.replace('.json', '')))
        .filter(p => p !== null);
    } catch (e) {
      console.error('Error reading directory: ' + e.message);
      return [];
    }
  }

  searchProfiles(criteria) {
    const profiles = this.getAllProfiles();

    return profiles.filter(p => {
      // Match by segment
      if (criteria.segment && p.insights.segment !== criteria.segment) return false;

      // Match by churn risk
      if (criteria.churnRisk && p.insights.churnRisk !== criteria.churnRisk) return false;

      // Match by preference
      if (criteria.shape && !p.preferences.shapes.includes(criteria.shape)) return false;
      if (criteria.color && !p.preferences.colors.includes(criteria.color)) return false;

      // Match by value
      if (criteria.minValue && p.insights.lifetimeValue < criteria.minValue) return false;

      return true;
    });
  }
}

module.exports = Customer360;

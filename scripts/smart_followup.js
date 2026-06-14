#!/usr/bin/env node
/**
 * Smart Follow-Up System
 * Automated follow-up scheduling and reminders
 */

const { getHKTDateTime } = require('./lib/time');

class SmartFollowUp {
  constructor(customer360) {
    this.customer360 = customer360;
    this.followUpRules = [
      { stage: 'inquiry', delay: 1, priority: 'high' },      // 1 day after inquiry
      { stage: 'quotation', delay: 3, priority: 'high' },   // 3 days after quote
      { stage: 'no_response', delay: 7, priority: 'medium' }, // 7 days no response
      { stage: 'nurture', delay: 30, priority: 'low' }      // Monthly nurture
    ];
  }

  scheduleFollowUp(customerId, trigger, context = {}) {
    const profile = this.customer360.getProfile(customerId);
    if (!profile) return null;

    const rule = this.followUpRules.find(r => r.stage === trigger);
    if (!rule) return null;

    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + rule.delay);

    const followUp = {
      id: `fu-${Date.now()}`,
      customerId,
      stage: trigger,
      priority: rule.priority,
      scheduledDate: getHKTDateTime(),
      context,
      status: 'scheduled',
      createdAt: getHKTDateTime()
    };

    this.saveFollowUp(followUp);
    return followUp;
  }

  getDueFollowUps(date = new Date()) {
    const all = this.getAllFollowUps();
    return all.filter(fu => {
      const scheduled = new Date(fu.scheduledDate);
      return fu.status === 'scheduled' && scheduled <= date;
    });
  }

  executeFollowUp(followUpId) {
    const followUp = this.getFollowUp(followUpId);
    if (!followUp) return null;

    const profile = this.customer360.getProfile(followUp.customerId);
    if (!profile) return null;

    // Generate appropriate message based on stage
    const message = this.generateMessage(followUp, profile);

    followUp.status = 'executed';
    followUp.executedAt = getHKTDateTime();
    followUp.message = message;

    this.saveFollowUp(followUp);

    return { followUp, message };
  }

  generateMessage(followUp, profile) {
    const messages = {
      inquiry: {
        subject: 'Following up on your diamond inquiry',
        body: `Hi ${profile.basic.name}, I wanted to follow up on your recent inquiry. I've curated some options that match your preferences. Would you like to schedule a viewing?`,
        channel: profile.basic.preferredContact
      },
      quotation: {
        subject: 'Questions about your diamond quotation?',
        body: `Hi ${profile.basic.name}, I sent you a quotation a few days ago. Do you have any questions or would you like to see the diamonds in person?`,
        channel: profile.basic.preferredContact
      },
      no_response: {
        subject: 'Still interested in diamonds?',
        body: `Hi ${profile.basic.name}, I haven't heard back from you. Are you still looking for diamonds? I'd be happy to adjust the selection based on your feedback.`,
        channel: profile.basic.preferredContact
      },
      nurture: {
        subject: 'New arrivals you might like',
        body: `Hi ${profile.basic.name}, we have some new diamonds that match your preferences. Thought you might be interested!`,
        channel: profile.basic.preferredContact
      }
    };

    return messages[followUp.stage] || messages.nurture;
  }

  // Anniversary reminders
  checkAnniversaries(daysAhead = 30) {
    const profiles = this.customer360.getAllProfiles();
    const reminders = [];

    profiles.forEach(profile => {
      profile.purchases.forEach(purchase => {
        const purchaseDate = new Date(purchase.date);
        const anniversary = new Date(purchaseDate);
        anniversary.setFullYear(anniversary.getFullYear() + 1);

        const daysUntil = Math.floor((anniversary - new Date()) / (1000 * 60 * 60 * 24));

        if (daysUntil > 0 && daysUntil <= daysAhead) {
          reminders.push({
            customerId: profile.customerId,
            customerName: profile.basic.name,
            purchaseDate: purchase.date,
            anniversaryDate: getHKTDateTime(),
            daysUntil,
            diamond: purchase.diamond
          });
        }
      });
    });

    return reminders.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  // Save/load methods
  _isValidId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
  }

  saveFollowUp(followUp) {
    const fs = require('fs');
    const path = require('path');
    if (!this._isValidId(followUp.id)) {
      throw new Error(`Invalid followUp id: ${followUp.id}`);
    }
    const dir = './data/followups';
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('Error creating directory: ' + e.message);
      return;
    }
    try {
      const filePath = path.join(dir, `${followUp.id}.json`);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(followUp, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
  }

  getFollowUp(id) {
    const fs = require('fs');
    const path = require('path');
    if (!this._isValidId(id)) {
      console.error(`⚠️ Invalid followup id: ${id}`);
      return null;
    }
    let data;
    try {
      data = fs.readFileSync(path.join('./data/followups', `${id}.json`), 'utf8');
    } catch (e) {
      console.error('Error reading file: ' + e.message);
      return null;
    }
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error(`⚠️ Failed to parse followup file ${id}:`, e.message);
      return null;
    }
  }

  getAllFollowUps() {
    const fs = require('fs');
    const path = require('path');
    const dir = './data/followups';

    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      console.error('Error reading directory: ' + e.message);
      return [];
    }
    try {
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => this.getFollowUp(f.replace('.json', '')))
        .filter(fu => fu !== null);
    } catch (e) {
      console.error('Error: ' + e.message);
      return [];
    }
  }
}

module.exports = SmartFollowUp;

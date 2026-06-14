#!/usr/bin/env node
/**
 * Contract Terms Checker
 * Reviews contract clauses for common issues
 */

class ContractChecker {
  constructor() {
    this.clausePatterns = {
      payment: {
        keywords: ['payment', 'pay', 'wire', 'transfer', 'remittance'],
        required: ['due date', 'amount', 'currency', 'bank details'],
        risks: ['vague due date', 'no late penalty', 'partial payment allowed']
      },
      delivery: {
        keywords: ['delivery', 'ship', 'transport', 'insurance'],
        required: ['delivery date', 'shipping method', 'insurance'],
        risks: ['no insurance', 'buyer bears all risk', 'no tracking']
      },
      quality: {
        keywords: ['quality', 'grade', 'certificate', 'inspection'],
        required: ['certification', 'inspection period', 'return policy'],
        risks: ['no certification', 'no inspection period', 'final sale']
      },
      dispute: {
        keywords: ['dispute', 'arbitration', 'jurisdiction', 'law'],
        required: ['governing law', 'dispute resolution', 'jurisdiction'],
        risks: ['vague jurisdiction', 'no arbitration clause', 'expensive litigation']
      }
    };
  }

  analyze(contractText) {
    const results = {
      clauses: {},
      missing: [],
      risks: [],
      recommendations: []
    };

    for (const [category, pattern] of Object.entries(this.clausePatterns)) {
      const found = this.findClauses(contractText, pattern);
      results.clauses[category] = found;

      // Check for missing required elements
      pattern.required.forEach(req => {
        if (!found.elements.includes(req)) {
          results.missing.push({ category, element: req });
        }
      });

      // Check for risks
      pattern.risks.forEach(risk => {
        if (found.hasRisk(risk)) {
          results.risks.push({ category, risk });
        }
      });
    }

    results.recommendations = this.generateRecommendations(results);
    return results;
  }

  findClauses(text, pattern) {
    const paragraphs = text.split(/\n{2,}/);
    const relevant = paragraphs.filter(p => 
      pattern.keywords.some(k => p.toLowerCase().includes(k))
    );

    return {
      found: relevant.length > 0,
      count: relevant.length,
      elements: pattern.required.filter(r => 
        relevant.some(p => p.toLowerCase().includes(r))
      ),
      hasRisk: (risk) => relevant.some(p => 
        p.toLowerCase().includes(risk.toLowerCase())
      )
    };
  }

  generateRecommendations(analysis) {
    const recs = [];

    if (analysis.missing.length > 0) {
      recs.push({
        priority: 'high',
        type: 'missing_clauses',
        message: `Missing ${analysis.missing.length} required elements`,
        details: analysis.missing
      });
    }

    if (analysis.risks.length > 0) {
      recs.push({
        priority: 'medium',
        type: 'risky_terms',
        message: `Found ${analysis.risks.length} potentially risky terms`,
        details: analysis.risks
      });
    }

    if (!analysis.clauses.dispute.found) {
      recs.push({
        priority: 'high',
        type: 'missing_dispute',
        message: 'No dispute resolution clause found - highly recommended'
      });
    }

    return recs;
  }

  generateSummary(analysis) {
    let summary = 'Contract Analysis Summary\n';
    summary += '='.repeat(30) + '\n\n';
    
    summary += `Clauses Found:\n`;
    for (const [cat, data] of Object.entries(analysis.clauses)) {
      summary += `  - ${cat}: ${data.found ? '✓' : '✗'} (${data.count} sections)\n`;
    }

    summary += `\n\n\nIssues Found:\n`;
    analysis.recommendations.forEach(rec => {
      const icon = rec.priority === 'high' ? '🔴' : '🟡';
      summary += `  ${icon} [${rec.priority.toUpperCase()}] ${rec.message}\n`;
    });

    return summary;
  }
}

module.exports = ContractChecker;

#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * GIA Certificate Image Verifier
 * Compares diamond photos with GIA certificate data
 */

const { getHKTDateTime } = require('./lib/time');

class GIAImageVerifier {
  constructor(giaOCR) {
    this.giaOCR = giaOCR;
    this.tolerance = {
      carat: 0.01,      // ±0.01ct
      measurements: 0.05 // ±5%
    };
  }

  async verify(diamondPhotoPath, certificatePath) {
    log('Verifying diamond against GIA certificate...');

    // Step 1: Extract certificate data
    const certData = await this.giaOCR.processImage(certificatePath);

    // Step 2: Analyze diamond photo (mock implementation)
    const photoAnalysis = await this.analyzeDiamondPhoto(diamondPhotoPath);

    // Step 3: Compare
    const comparison = this.compare(photoAnalysis, certData.extractedData);

    return {
      verified: comparison.match,
      confidence: comparison.confidence,
      certificate: certData.extractedData,
      photoAnalysis: photoAnalysis,
      discrepancies: comparison.discrepancies,
      timestamp: getHKTDateTime()
    };
  }

  async analyzeDiamondPhoto(imagePath) {
    log('  → Analyzing diamond photo...');

    // This would use computer vision to estimate:
    // - Shape detection
    // - Size estimation (if reference object present)
    // - Visual clarity assessment

    // Mock result
    return {
      detectedShape: 'Round',
      estimatedCarat: 1.02,
      visualClarity: 'VS range',
      imageQuality: 'good',
      notes: 'Photo analysis completed'
    };
  }

  compare(photo, cert) {
    const discrepancies = [];
    let matchScore = 0;
    let checks = 0;

    // Check shape
    checks++;
    if (photo.detectedShape && cert.shape) {
      const shapeMatch = photo.detectedShape.toLowerCase().includes(
        cert.shape.toLowerCase().replace(' brilliant', '')
      );
      if (shapeMatch) {
        matchScore++;
      } else {
        discrepancies.push({
          field: 'shape',
          photo: photo.detectedShape,
          certificate: cert.shape
        });
      }
    }

    // Check carat (with tolerance)
    checks++;
    if (photo.estimatedCarat && cert.carat) {
      const diff = Math.abs(photo.estimatedCarat - cert.carat);
      if (diff <= this.tolerance.carat) {
        matchScore++;
      } else {
        discrepancies.push({
          field: 'carat',
          photo: photo.estimatedCarat,
          certificate: cert.carat,
          // 保持 number 類型一致性，不使用 toFixed
          difference: Math.round(diff * 1000) / 1000
        });
      }
    }

    // Check clarity (visual vs certificate)
    checks++;
    if (photo.visualClarity && cert.clarityGrade) {
      // Simple check - would need more sophisticated comparison
      if (photo.visualClarity.includes(cert.clarityGrade.substring(0, 2))) {
        matchScore++;
      }
    }

    return {
      match: discrepancies.length === 0,
      confidence: (matchScore / checks) * 100,
      discrepancies
    };
  }

  generateVerificationReport(verification) {
    let report = 'GIA Certificate Verification Report\n';
    report += '='.repeat(40) + '\n\n';

    report += `Status: ${verification.verified ? '✅ VERIFIED' : '❌ MISMATCH'}\n`;
    report += `Confidence: ${verification.confidence.toFixed(1)}%\n\n`;

    report += 'Certificate Data:\n';
    report += `  Report #: ${verification.certificate.reportNumber}\n`;
    report += `  Shape: ${verification.certificate.shape}\n`;
    report += `  Carat: ${verification.certificate.carat}\n`;
    report += `  Color: ${verification.certificate.colorGrade}\n`;
    report += `  Clarity: ${verification.certificate.clarityGrade}\n\n`;

    if (verification.discrepancies.length > 0) {
      report += 'Discrepancies Found:\n';
      verification.discrepancies.forEach(d => {
        report += `  - ${d.field}: Photo shows '${d.photo}', Certificate says '${d.certificate}'`;
        if (d.difference) report += ` (diff: ${d.difference})`;
        report += '\n';
      });
    }

    return report;
  }
}

module.exports = GIAImageVerifier;

#!/usr/bin/env node

/**
 * verify_proposal.js — CLI for proposal hash verification
 *
 * Usage:
 *   node scripts/verify_proposal.js <proposal-json-file>    # Verify a JSON proposal file
 *   node scripts/verify_proposal.js --stdin                 # Read proposal from stdin
 *   node scripts/verify_proposal.js --sign <file>           # Compute & attach hash to a proposal
 *
 * This is a soft-check tool. It logs warnings on mismatch but does NOT block.
 */

const fs = require('fs');
const path = require('path');
const { verifyProposalHash, computeProposalHash, signProposal } = require('./lib/proposal_hash');

function readJSON(filepath) {
  const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ File not found: ${resolved}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage:
  node scripts/verify_proposal.js <file.json>    — Verify hash integrity of a proposal JSON file
  node scripts/verify_proposal.js --stdin         — Read proposal JSON from stdin
  node scripts/verify_proposal.js --sign <file>   — Compute & attach hash to a proposal file
  node scripts/verify_proposal.js --help          — Show this help
`);
    process.exit(0);
  }

  if (args[0] === '--help') {
    console.log('\nverify_proposal.js — Proposal Integrity Verification\n');
    console.log('Soft-check tool. Warns on hash mismatch but never blocks.\n');
    console.log('Commands:');
    console.log('  node scripts/verify_proposal.js <file.json>   — verify');
    console.log('  node scripts/verify_proposal.js --stdin        — verify from stdin');
    console.log('  node scripts/verify_proposal.js --sign <file>  — sign a proposal');
    process.exit(0);
  }

  if (args[0] === '--sign' && args[1]) {
    // Sign mode: compute & attach hash
    const data = readJSON(args[1]);
    const signed = signProposal(data);
    try {
      fs.writeFileSync(args[1], JSON.stringify(signed, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`❌ Failed to write signed proposal: ${err.message}`);
      process.exit(1);
    }
    console.log(`✅ Proposal signed: ${args[1]}`);
    console.log(`   hash: ${signed.hash}`);
    process.exit(0);
  }

  // Verify mode
  let proposal;
  if (args[0] === '--stdin') {
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      try { proposal = JSON.parse(raw); } catch (e) { console.error('❌ stdin parse failed:', e.message); process.exit(1); }
      const result = verifyProposalHash(proposal);
      printResult(result, proposal);
    });
    return;
  }

  // File verification
  proposal = readJSON(args[0]);
  const result = verifyProposalHash(proposal);
  printResult(result, proposal);
}

function printResult(result, proposal) {
  if (!result.storedHash) {
    const hash = result.computedHash;
    console.log(`⚠️  No hash field on proposal — legacy format (computed hash: ${hash.slice(0, 16)}...)`);
    console.log('   Run: node scripts/verify_proposal.js --sign <file>  to add a hash');
    process.exit(0);
  }

  if (result.valid) {
    console.log(`✅ Hash verified: ${result.computedHash.slice(0, 16)}...`);
    process.exit(0);
  } else {
    console.error(`❌ Hash MISMATCH on field: ${result.mismatch}`);
    console.error(`   Stored:   ${result.storedHash}`);
    console.error(`   Computed: ${result.computedHash}`);
    console.error('   ⚠️  Proposal may have been tampered with.');
    process.exit(1);
  }
}

main();

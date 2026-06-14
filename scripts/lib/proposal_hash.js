'use strict';

/**
 * proposal_hash.js — Proposal Integrity Verification
 *
 * Verifies that skill_workshop proposals have not been tampered with
 * by computing and checking SHA-256 hashes of proposal bodies.
 *
 * A proposal's body content includes all fields except the `hash` field.
 *
 * Usage:
 *   const { verifyProposalHash, computeProposalHash, stripHashField } = require('./lib/proposal_hash');
 *   const result = verifyProposalHash(proposalObj);
 *   if (!result.valid) console.warn(`⚠️ Proposal hash mismatch: ${result.mismatch}`);
 */

const crypto = require('crypto');

/**
 * Strip the `hash` field from a proposal object for honest hash computation.
 * Deep-copies the object to avoid mutating the original.
 *
 * @param {Object} proposal - Proposal object with optional `hash` field
 * @returns {Object} Deep copy of proposal WITHOUT the `hash` field
 */
function stripHashField(proposal) {
  if (!proposal || typeof proposal !== 'object') return proposal;
  const copy = JSON.parse(JSON.stringify(proposal));
  delete copy.hash;
  return copy;
}

/**
 * Compute SHA-256 hash of a proposal body (excluding `hash` field).
 * Canonicalizes via JSON.stringify with sorted keys.
 *
 * @param {Object} proposalBody - The proposal content object (e.g., SKILL.md body or workshop payload)
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeProposalHash(proposalBody) {
  const body = stripHashField(proposalBody);
  const serialized = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Verify a proposal's hash against its stored `hash` field.
 *
 * This is a NON-BLOCKING verification — it returns a result object
 * indicating validity, but does NOT throw. Callers can decide whether
 * to reject, warn, or soft-check based on the result.
 *
 * @param {Object} proposal - Proposal object with optional `hash` field
 * @returns {{ valid: boolean, mismatch: string|null, computedHash: string, storedHash: string|null }}
 *   - valid: true if hash matches or field is absent (no-op)
 *   - mismatch: field name that differs, or null if valid
 *   - computedHash: hash computed from body (excluding hash field)
 *   - storedHash: hash stored in proposal.hash, or null if absent
 */
function verifyProposalHash(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    return {
      valid: false,
      mismatch: 'proposal is not an object',
      computedHash: '',
      storedHash: null
    };
  }

  // No hash field → backward compat/legacy proposal, consider valid
  if (!proposal.hash || typeof proposal.hash !== 'string') {
    return {
      valid: true,
      mismatch: null,
      computedHash: computeProposalHash(proposal),
      storedHash: null
    };
  }

  const computedHash = computeProposalHash(proposal);
  const storedHash = proposal.hash;

  if (computedHash === storedHash) {
    return {
      valid: true,
      mismatch: null,
      computedHash,
      storedHash
    };
  }

  return {
    valid: false,
    mismatch: 'hash',
    computedHash,
    storedHash
  };
}

/**
 * Compute and attach a `hash` field to a proposal object.
 * Mutates and returns the object (with hash field added).
 *
 * @param {Object} proposal - Proposal object to hash
 * @returns {Object} The same proposal object with `hash` field set
 */
function signProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return proposal;
  // Temporarily remove existing hash if any, then compute
  const body = stripHashField(proposal);
  const hash = computeProposalHash(body);
  proposal.hash = hash;
  return proposal;
}

module.exports = {
  verifyProposalHash,
  computeProposalHash,
  stripHashField,
  signProposal
};

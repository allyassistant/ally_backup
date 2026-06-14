#!/usr/bin/env node

/**
 * pin_semantics.js — Shared pin semantics helper
 *
 * Centralizes isActionBlockedByPin() so that both
 * weekly_correction_loop.js and test_pin_semantics.js
 * use the same implementation.
 *
 * pinned: true blocks ONLY destructive/status-altering actions:
 *   ❌ Delete, Archive, Consolidation, Status change to archived/stale
 *   ✅ Content patches, Provenance change, New support files, Renaming
 */

'use strict';

/**
 * Check if an action is blocked by pin semantics.
 * @param {string} action - The action to check
 * @returns {boolean} true if the action is blocked
 */
function isActionBlockedByPin(action) {
  const BLOCKED_ACTIONS = [
    'delete',
    'archive',
    'consolidate',
    'status_change_to_archived',
    'status_change_to_stale'
  ];
  return BLOCKED_ACTIONS.includes(action);
}

module.exports = { isActionBlockedByPin };

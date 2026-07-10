'use strict';
/**
 * scripts/lib/time_constants.js — Canonical time constants
 *
 * Use these instead of inline magic numbers (e.g., 3600000, 86400000, 1440)
 * so time-to-unit conversions are uniform and easy to update in one place.
 *
 * Created: 2026-06-25 (OpenClaw audit cleanup — eliminates magic_numbers noise)
 */

module.exports = {
  // 1 hour = 60 * 60 * 1000 milliseconds
  ONE_HOUR_MS: 3600000,

  // 1 day = 24 * 60 * 60 * 1000 milliseconds
  ONE_DAY_MS: 86400000,

  // 1 day = 24 * 60 minutes
  ONE_DAY_MINUTES: 1440,
};
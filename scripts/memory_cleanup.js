#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * @deprecated Renamed to memory_section_cleanup.js (clearer name — it only cleans MEMORY.md sections).
 * This shim forwards all calls to memory_section_cleanup.js for backward compatibility.
 */
log('⚠️  memory_cleanup.js is DEPRECATED. Renamed to: memory_section_cleanup.js');
log('   Forwarding...\n');
require('./memory_section_cleanup.js');

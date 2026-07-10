'use strict';

const a = require('./_test_rename_a');

function callHello() {
  return a.hello();
}

module.exports = { callHello };

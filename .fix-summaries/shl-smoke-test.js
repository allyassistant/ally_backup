const fs = require("fs");
try {
  fs.unlinkSync("/tmp/never-exists-123");
} catch (e) {
  console.error(`File deletion failed: ${e.message}`);
}
console.log("done");

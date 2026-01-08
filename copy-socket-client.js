const fs = require("fs");
const path = require("path");

// Source dans node_modules
const src = path.join(
  __dirname,
  "node_modules",
  "socket.io",
  "client-dist",
  "socket.io.js"
);

// Destination dans ton dossier public/vendor
const destDir = path.join(__dirname, "public", "js", "vendor");
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const dest = path.join(destDir, "socket.io.js");

fs.copyFileSync(src, dest);
console.log("✅ socket.io.js copié dans public/js/vendor");

const path = require("path");

function resolveBin(binName) {
  const isPkg = typeof process.pkg !== "undefined";

  const basePath = isPkg
    ? path.dirname(process.execPath) // dossier de l’exe
    : path.resolve(__dirname); // dossier du script en dev

  const ext = process.platform === "win32" ? ".exe" : "";

  return path.join(basePath, "bin", binName + ext);
}

module.exports = { resolveBin };

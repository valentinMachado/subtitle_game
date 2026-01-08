const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node compress.js <video_file>");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error("Fichier introuvable :", inputFile);
  process.exit(1);
}

const { dir, name, ext } = path.parse(inputFile);
const outputFile = path.join(dir, `${name}_compressed${ext}`);

console.log(`Compression de "${inputFile}" vers "${outputFile}"...`);

// Paramètres plus compressés : CRF 35, largeur 854px, audio 96 kbps
const cmd = `ffmpeg -y -i "${inputFile}" -vf "scale=854:-2" -vcodec libx264 -crf 35 -preset fast -acodec aac -b:a 96k "${outputFile}"`;

const ffmpegProcess = exec(cmd);

ffmpegProcess.stdout?.on("data", (data) => process.stdout.write(data));
ffmpegProcess.stderr?.on("data", (data) => process.stdout.write(data));

ffmpegProcess.on("close", (code) => {
  if (code !== 0) {
    console.error(`\nFFmpeg a échoué avec le code ${code}`);
    return;
  }

  console.log("\nCompression terminée !");
});

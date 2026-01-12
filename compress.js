const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
const format = process.argv[3];
if (!inputFile) {
  console.error("Usage: node compress.js <video_file>");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error("Fichier introuvable :", inputFile);
  process.exit(1);
}

function mp4ToWebm(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error("Fichier source introuvable");
  }

  const args = [
    "-y",
    "-i",
    inputPath,

    // ===== VIDEO =====
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "200k",
    "-maxrate",
    "200k",
    "-bufsize",
    "400k",
    "-speed",
    "4",
    "-row-mt",
    "1",
    "-vf",
    "scale=1024:-2",

    // ===== AUDIO =====
    "-c:a",
    "libopus",
    "-b:a",
    "32k",

    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: "inherit" });

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
const { dir, name, ext } = path.parse(inputFile);

if (!format) {
  const outputFile = path.join(dir, `${name}_compressed${ext}`);
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
} else {
  const outputFile = path.join(dir, `${name}_compressed${".webm"}`);

  console.log("Compression webm en cours...");

  mp4ToWebm(inputFile, outputFile);
}

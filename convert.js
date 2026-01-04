const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Récupère le fichier en argument
const inputPath = process.argv[2];

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Usage: node convert_replace.js <video.mkv>");
  process.exit(1);
}

// Vérifie l'extension
if (path.extname(inputPath).toLowerCase() !== ".mkv") {
  console.error("Le fichier doit être un .mkv");
  process.exit(1);
}

// Génère le chemin du fichier temporaire .mp4
const outputPath = path.join(path.dirname(inputPath), "tmp_conversion.mp4");

function convertMKVtoMP4(input, output) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-i", input, "-c", "copy", output]);

    ff.stdout.on("data", (data) => process.stdout.write(data.toString()));
    ff.stderr.on("data", (data) => process.stderr.write(data.toString()));

    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

async function replaceMKVwithMP4() {
  try {
    console.log(`Conversion de ${inputPath} en MP4...`);
    await convertMKVtoMP4(inputPath, outputPath);

    // Supprime l'original .mkv
    fs.unlinkSync(inputPath);

    // Renomme le .mp4 temporaire avec le nom original
    const finalPath = path.join(
      path.dirname(inputPath),
      path.basename(inputPath, ".mkv") + ".mp4"
    );
    fs.renameSync(outputPath, finalPath);

    console.log("Conversion terminée :", finalPath);
  } catch (err) {
    console.error("Erreur :", err);
    // Supprime le tmp si échec
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

// Lancement
replaceMKVwithMP4();

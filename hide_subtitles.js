const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const libraryVideoId = process.argv[2]; // ID ou nom du fichier (sans extension)
const inputPath = `./videos/${libraryVideoId}.mp4`; // chemin vidéo source

// Les 4 coordonnées de la blackbox en pixels
const boxX = parseInt(process.argv[3]) || 0;
const boxY = parseInt(process.argv[4]) || 0;
const boxWidth = parseInt(process.argv[5]) || 100;
const boxHeight = parseInt(process.argv[6]) || 50;

// Couleur de la blackbox
const boxColor = process.argv[7] || "black@1";

// Boolean debug pour ne traiter que le début
const debugStartOnly = process.argv[8] === "true"; // passe "true" pour activer

// Durée en secondes à traiter pour le debug
const debugDuration = 5;

// Fichier temporaire pour générer la vidéo
const tmpPath = path.join(path.dirname(inputPath), `${libraryVideoId}_tmp.mp4`);

async function addBlackBoxReplace(
  inputPath,
  tmpPath,
  { x, y, width, height, color, debug }
) {
  return new Promise((resolve, reject) => {
    const vf = `drawbox=x=${x}:y=${y}:width=${width}:height=${height}:color=${color}:t=fill`;

    const args = ["-i", inputPath];

    // Si debug, ne prendre que les premières secondes
    if (debug) args.push("-t", debugDuration.toString());

    args.push("-vf", vf, "-c:a", "copy", tmpPath);

    console.log("Commande FFmpeg :", "ffmpeg", args.join(" "));

    const ff = spawn("ffmpeg", args);

    ff.stdin.end();

    ff.stdout.on("data", (data) => process.stdout.write(data.toString()));
    ff.stderr.on("data", (data) => process.stderr.write(data.toString()));

    ff.on("close", (code) => {
      if (code === 0) {
        // Remplacer l'original par le tmp
        fs.renameSync(tmpPath, inputPath);
        resolve(inputPath);
      } else {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

// Exécution
addBlackBoxReplace(inputPath, tmpPath, {
  x: boxX,
  y: boxY,
  width: boxWidth,
  height: boxHeight,
  color: boxColor,
  debug: debugStartOnly,
})
  .then((out) => console.log("Vidéo remplacée :", out))
  .catch((err) => console.error("Erreur FFmpeg :", err));

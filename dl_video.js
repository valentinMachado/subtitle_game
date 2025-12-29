const { spawn } = require("child_process");
const path = require("path");

async function downloadVideo(url, outputPath) {
  return new Promise((resolve, reject) => {
    const yt = spawn("yt-dlp", ["-f", "best", "-o", outputPath, url]);

    yt.stdout.on("data", (data) => {
      process.stdout.write(data.toString()); // log en temps réel
    });

    yt.stderr.on("data", (data) => {
      process.stderr.write(data.toString()); // warnings/erreurs
    });

    yt.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
}

// Exemple d'utilisation
const url = "https://www.youtube.com/watch?v=gVe_2tDXwvQ";
const outputPath = path.join(__dirname, "public/videos/temp_video.mp4");

downloadVideo(url, outputPath)
  .then((file) => console.log("Téléchargement terminé :", file))
  .catch(console.error);

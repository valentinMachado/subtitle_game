const { spawn } = require("child_process");

async function processVideo(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      startTime = 0,
      endTime = null,
      addBlackBox = false,
      blackBoxHeight = 80, // <-- juste la hauteur
      blackBoxColor = "black@1", // couleur par défaut
    } = options;

    let vf = "";
    if (addBlackBox) {
      // toujours collée en bas
      vf = `drawbox=x=0:y=ih-${blackBoxHeight}:width=iw:height=${blackBoxHeight}:color=${blackBoxColor}:t=fill`;
    }

    const args = ["-i", inputPath, "-ss", startTime.toString()];
    if (endTime !== null) args.push("-to", endTime.toString());
    if (vf) args.push("-vf", vf);

    args.push("-c:a", "copy", outputPath);

    console.log("Commande FFmpeg :", "ffmpeg", args.join(" "));

    const ff = spawn("ffmpeg", args);

    ff.stdout.on("data", (data) => process.stdout.write(data.toString()));
    ff.stderr.on("data", (data) => process.stderr.write(data.toString()));

    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

// Exemple d'utilisation
(async () => {
  try {
    const output = await processVideo(
      "./public/videos/video.mp4",
      "./public/videos/la_soupe.mp4",
      {
        startTime: 97,
        endTime: 118,
        addBlackBox: true,
        blackBoxHeight: 150, // juste changer la hauteur ici
        blackBoxColor: "black@1",
      }
    );
    console.log("Traitement terminé :", output);
  } catch (err) {
    console.error("Erreur FFmpeg :", err);
  }
})();

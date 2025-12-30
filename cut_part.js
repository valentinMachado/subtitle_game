const { spawn } = require("child_process");

/**
 * Convertit un timestamp "HH:MM:SS" ou "MM:SS" en secondes
 */
function timeToSeconds(time) {
  if (typeof time === "number") return time;
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(time);
}

async function processVideo(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      startTime = 0,
      endTime = null,
      addBlackBox = false,
      blackBoxHeight = 80,
      blackBoxColor = "black@1",
    } = options;

    let vf = "";
    if (addBlackBox) {
      vf = `drawbox=x=0:y=ih-${blackBoxHeight}:width=iw:height=${blackBoxHeight}:color=${blackBoxColor}:t=fill`;
    }

    const args = ["-i", inputPath];

    // FFmpeg accepte le format HH:MM:SS directement
    if (startTime)
      args.push(
        "-ss",
        typeof startTime === "string" ? startTime : startTime.toString()
      );
    if (endTime !== null)
      args.push(
        "-to",
        typeof endTime === "string" ? endTime : endTime.toString()
      );
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
      "./public/videos/temp_video.mp4",
      "./public/videos/bbq.mp4",
      {
        startTime: "00:1:10",
        endTime: "00:1:29",
        addBlackBox: true,
        blackBoxHeight: 150,
        blackBoxColor: "black@1",
      }
    );
    console.log("Traitement terminé :", output);
  } catch (err) {
    console.error("Erreur FFmpeg :", err);
  }
})();

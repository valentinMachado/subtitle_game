const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const videoPath = process.argv[2];
const lang = process.argv[3];

async function createSRT() {
  if (!fs.existsSync(videoPath)) {
    throw new Error("Fichier vidéo non trouvé");
  }

  const audioPath = videoPath.replace(path.extname(videoPath), ".wav");

  console.log("[1/3] Extraction audio...");
  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    audioPath,
  ]);

  ffmpeg.stderr.on("data", (data) => process.stdout.write(`[ffmpeg] ${data}`));

  ffmpeg.on("close", (code) => {
    if (code !== 0) {
      throw new Error(`FFmpeg exited with code ${code}`);
    }

    console.log("[2/3] Génération du SRT avec Whisper tiny...");
    const whisper = spawn(
      "whisper",
      [
        audioPath,
        "--model",
        "tiny",
        "--language",
        lang,
        "--output_format",
        "srt",
        "--output_dir",
        path.dirname(videoPath),
        "--verbose",
        "False",
      ],
      {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      }
    );

    whisper.stderr.on("data", (data) =>
      process.stdout.write(`[whisper] ${data.toString("utf8")}`)
    );

    whisper.on("close", (code2) => {
      if (code2 !== 0) {
        throw new Error(`Whisper exited with code ${code2}`);
      }

      fs.unlinkSync(audioPath);
      console.log("[3/3] Fichier SRT généré avec succès.");
    });
  });
}

createSRT().catch(console.error);

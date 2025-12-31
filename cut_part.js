const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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

    ff.stdin.end();

    ff.stdout.on("data", (data) => process.stdout.write(data.toString()));
    ff.stderr.on("data", (data) => process.stderr.write(data.toString()));

    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

/**
 * Transcrit rapidement une vidéo avec Whisper tiny pour obtenir uniquement les timestamps
 */
async function generateTimestamps(videoPath, lang, id) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(videoPath))
      return reject(new Error("Fichier vidéo non trouvé"));

    // Création d'un fichier audio temporaire
    const audioPath = videoPath.replace(path.extname(videoPath), ".wav");
    console.log(`[1/3] Extraction audio...`);
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-ar",
      "16000",
      audioPath,
    ]);

    ffmpeg.stderr.on("data", (data) =>
      process.stdout.write(`[ffmpeg] ${data}`)
    );
    ffmpeg.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`FFmpeg exited with code ${code}`));

      console.log(`[2/3] Génération des timestamps avec Whisper tiny...`);
      // Whisper tiny, sortie JSON
      const whisper = spawn(
        "whisper",
        [
          audioPath,
          "--model",
          "tiny",
          "--language",
          lang,
          "--output_format",
          "json",
          "--output_dir",
          path.dirname(videoPath),
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );

      let output = "";
      whisper.stdout.on("data", (data) => (output += data.toString("utf8")));
      whisper.stderr.on("data", (data) =>
        process.stdout.write(`[whisper] ${data.toString("utf8")}`)
      );
      whisper.on("close", (code2) => {
        if (code2 !== 0)
          return reject(new Error(`Whisper exited with code ${code2}`));

        // Lecture du JSON généré par Whisper
        const jsonPath = audioPath.replace(".wav", ".json");
        if (!fs.existsSync(jsonPath))
          return reject(new Error("Fichier JSON non généré"));

        const raw = fs.readFileSync(jsonPath, "utf-8");
        const whisperData = JSON.parse(raw);

        // Construction des segments {start, end, placeholder}
        const subtitles = whisperData.segments.map((seg, i) => ({
          start: seg.start,
          end: seg.end,
          placeholder: `${i + 1} ...`,
        }));

        // Suppression des fichiers temporaires
        fs.unlinkSync(audioPath);
        fs.unlinkSync(jsonPath);

        console.log(
          `[3/3] Timestamps générés et fichiers temporaires supprimés.`
        );

        resolve({
          id,
          path: path.relative("./public", videoPath).replace(/\\/g, "/"),
          subtitles,
        });
      });
    });
  });
}

/**
 * Ajoute la vidéo dans ./public/config.json
 */
async function addVideoToConfig(videoPath, lang, id) {
  const newVideo = await generateTimestamps(videoPath, lang, id);

  const configPath = "./public/config.json";
  let config = { videos: [] };

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  }

  const existingIndex = config.videos.findIndex((v) => v.id === id);
  if (existingIndex >= 0) {
    config.videos[existingIndex] = newVideo;
  } else {
    config.videos.push(newVideo);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(`✅ Video "${id}" ajoutée dans config.json`);
}

const main = async () => {
  const videoId = process.argv[2];
  let startTime = process.argv[3];
  let endTime = process.argv[4];
  const blackBoxHeight = process.argv[5];

  if (!startTime) startTime = "00:00:00";

  if (!videoId || !startTime) {
    console.error(
      "Usage : node cut_part.js <videoId> <startTime> [endTime] [blackBoxHeight]"
    );
    process.exit(1);
  } else {
    console.log(`[1/3] Traitement de la partie ${startTime} à ${endTime}...`);
  }

  try {
    const output = await processVideo(
      "./public/videos/temp_video.mp4",
      `./public/videos/${videoId}.mp4`,
      {
        startTime: startTime,
        endTime: endTime,
        addBlackBox: true,
        blackBoxHeight: blackBoxHeight || 150,
        blackBoxColor: "black@1",
      }
    );
    console.log("Traitement terminé :", output);
  } catch (err) {
    console.error("Erreur FFmpeg :", err);
  }

  try {
    await addVideoToConfig(
      `./public/videos/${videoId}.mp4`,
      "en",
      `${videoId}`
    );
  } catch (err) {
    console.error("❌ Erreur :", err);
  }
};

main();

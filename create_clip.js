const { spawn } = require("child_process");
const fs = require("fs");

const libraryVideoId = process.argv[2];
const clipId = process.argv[3];
const lang = process.argv[4];
let startTime = process.argv[5];
let endTime = process.argv[6];

/**
 * Convertit HH:MM:SS ou SS en secondes
 */
function parseTime(t) {
  if (typeof t === "number") return t;
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseFloat(t);
}

/**
 * Parse un fichier SRT en tableau d'objets { start, end, placeholder }
 */
function parseSRT(srtContent) {
  const entries = [];
  const blocks = srtContent.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) {
      const timeLine = lines[1];
      const match = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/
      );
      if (match) {
        const start =
          parseInt(match[1]) * 3600 +
          parseInt(match[2]) * 60 +
          parseInt(match[3]) +
          parseInt(match[4]) / 1000;
        const end =
          parseInt(match[5]) * 3600 +
          parseInt(match[6]) * 60 +
          parseInt(match[7]) +
          parseInt(match[8]) / 1000;
        entries.push({
          start,
          end,
          placeholder: lines.slice(2).join(" "),
        });
      }
    }
  }
  return entries;
}

/**
 * Découpe les sous-titres pour un clip
 */
function clipSubtitles(subtitles, clipStart, clipEnd) {
  const clipped = subtitles
    .filter((s) => s.end > clipStart && s.start < clipEnd)
    .map((s, index) => ({
      start: Math.max(0, s.start - clipStart),
      end: Math.min(clipEnd - clipStart, s.end - clipStart),
      placeholder: index + 1 + ": " + s.placeholder,
    }));
  return clipped;
}

/**
 * Récupère les sous-titres découpés pour le clip
 */
function getClipSubtitles() {
  const srtPath = `./public/library_videos/${libraryVideoId}.srt`;
  if (!fs.existsSync(srtPath)) return [];

  const srtContent = fs.readFileSync(srtPath, "utf-8");
  const subtitles = parseSRT(srtContent);
  return clipSubtitles(subtitles, parseTime(startTime), parseTime(endTime));
}

/**
 * Découpe la vidéo avec FFmpeg
 */
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
 * Ajoute la vidéo et ses sous-titres dans ./public/config.json
 */
async function addVideoToConfig(videoPath) {
  const configPath = "./public/config.json";
  let config = { videos: [] };

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  }

  const newVideo = {
    id: clipId,
    lang,
    path: `videos/${clipId}.mp4`,
    subtitles: getClipSubtitles(),
  };

  const existingIndex = config.videos.findIndex((v) => clipId === v.id);
  if (existingIndex >= 0) {
    config.videos[existingIndex] = newVideo;
  } else {
    config.videos.push(newVideo);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(
    `✅ "${clipId}" ajoutée dans config.json avec ${newVideo.subtitles.length} sous-titres`
  );
}

const main = async () => {
  if (!clipId || !lang || !libraryVideoId || !startTime || !endTime) {
    console.error(
      "Usage: node create_clip.js <libraryVideoId> <clipId> <lang> <startTime> <endTime>"
    );
    process.exit(1);
  }

  try {
    const output = await processVideo(
      `./public/library_videos/${libraryVideoId}.mp4`,
      `./public/videos/${clipId}.mp4`,
      {
        startTime: startTime,
        endTime: endTime,
        addBlackBox: false,
        blackBoxHeight: 150,
        blackBoxColor: "black@1",
      }
    );
    console.log("Traitement vidéo terminé :", output);
  } catch (err) {
    console.error("Erreur FFmpeg :", err);
    process.exit(1);
  }

  try {
    await addVideoToConfig(`./public/videos/${clipId}.mp4`);
  } catch (err) {
    console.error("❌ Erreur ajout config :", err);
  }
};

main();

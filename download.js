const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const COOKIES_PATH = path.join(__dirname, "cookies.txt");

/**
 * Télécharge uniquement la vidéo YouTube.
 */
async function downloadVideo(url, outputDir, id) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const videoPath = path.join(outputDir, `${id}.mp4`);

    const yt = spawn("yt-dlp", ["-f", "best", "-o", videoPath, url]);

    yt.stdout.on("data", (d) => process.stdout.write(d));
    yt.stderr.on("data", (d) => process.stderr.write(d));

    yt.on("close", (code) => {
      if (code === 0) resolve(videoPath);
      else reject(new Error(`yt-dlp video exit ${code}`));
    });
  });
}

/**
 * Télécharge uniquement les sous-titres SRT (auto) dans une langue précise.
 */
async function downloadSRT(url, outputDir, id, lang = "fr") {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const srtPath = path.join(outputDir, `${id}_${lang}.srt`);

    const yt = spawn("yt-dlp", [
      "--cookies",
      COOKIES_PATH,
      "--skip-download",
      "--write-auto-subs",
      "--sub-lang",
      lang,
      "--sub-format",
      "srt",
      "--sleep-interval",
      "5",
      "--max-sleep-interval",
      "10",
      "-f",
      "best",
      "-o",
      srtPath,
      url,
    ]);

    yt.stdout.on("data", (d) => process.stdout.write(d));
    yt.stderr.on("data", (d) => process.stderr.write(d));

    yt.on("close", (code) => {
      if (code === 0 && fs.existsSync(srtPath)) {
        resolve(srtPath);
      } else {
        reject(new Error(`SRT ${lang} non récupéré (code ${code})`));
      }
    });
  });
}

/**
 * Liste les sous-titres disponibles pour une vidéo YouTube
 * @param {string} url - URL de la vidéo
 * @returns {Promise<string[]>} - Tableau des codes de langue
 */
function listAvailableSubs(url) {
  return new Promise((resolve, reject) => {
    const yt = spawn("yt-dlp", ["--cookies", COOKIES_PATH, "--list-subs", url]);

    let output = "";
    let errorOutput = "";

    yt.stdout.on("data", (data) => {
      output += data.toString();
    });

    yt.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    yt.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(`yt-dlp exited with code ${code}\n${errorOutput}`)
        );
      }

      // Parse la sortie pour extraire les codes de langue
      // Chaque ligne qui commence par "xx" est un code
      const langs = [];
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^([a-z]{2,3})\s*\(.*\)/i);
        if (match) langs.push(match[1]);
      }

      resolve(langs);
    });
  });
}

// -------------------- Exemple d'utilisation --------------------

const url = "https://www.youtube.com/watch?v=QdCaDMl3w28";
function normalizeToId(text) {
  return text
    .toString()
    .normalize("NFD") // sépare accents
    .replace(/[\u0300-\u036f]/g, "") // supprime accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // caractères non autorisés → "-"
    .replace(/^-+|-+$/g, ""); // trim des "-"
}
const id = normalizeToId("Sunny Deol's Action-Packed Movie");
const lang = "en";
const outputDir = path.join(__dirname, "public/library_videos/" + id);

(async () => {
  try {
    // pause volontaire (important)
    await new Promise((r) => setTimeout(r, 8000));

    const langs = await listAvailableSubs(url);
    console.log(langs);
    if (langs.includes(lang)) {
      const videoPath = await downloadVideo(url, outputDir, id);
      console.log("Vidéo téléchargée :", videoPath);
      const srtPath = await downloadSRT(url, outputDir, id, lang);
      console.log("SRT téléchargé :", srtPath);
    } else {
      console.log("Pas de sous-titres disponibles");
    }
  } catch (err) {
    console.error(err);
  }
})();

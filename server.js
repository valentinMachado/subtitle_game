const os = require("os");
const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");
const { resolveBin } = require("./utils.js");

// ---------- Paths ----------
// Si on est dans un EXE pkg, process.execPath pointe vers l'exe
const isPkg = typeof process.pkg !== "undefined";
const appRoot = isPkg ? path.dirname(process.execPath) : __dirname;

// On peut passer le dossier public via --data ./data ou fallback
const dataArgIndex = process.argv.findIndex((a) => a.startsWith("--data"));
const dataDir = dataArgIndex >= 0 ? process.argv[dataArgIndex + 1] : "public";
const publicDir = path.resolve(appRoot, dataDir);
const renderDir = path.join(publicDir, "render");

// ---------- BINAIRES ----------
const ffmpegPath = resolveBin("ffmpeg");
const ffprobePath = resolveBin("ffprobe");

// Vérifie que les binaires existent (tu peux aussi prévoir fallback si pkg)
[ffmpegPath, ffprobePath].forEach((bin) => {
  if (!fs.existsSync(bin)) {
    console.error("❌ Binaire manquant :", bin);
    process.exit(1);
  }
});

// ---------- CHEMINS UTILS ----------
const libraryVttPath = (id) => path.join(libraryRoot, id, `${id}.vtt`);
const libraryVideoPath = (libraryVideoId) =>
  path.join(
    publicDir,
    "library_videos",
    libraryVideoId,
    `${libraryVideoId}.mp4`
  );
const srtFilePath = (libraryVideoId) =>
  path.join(
    publicDir,
    "library_videos",
    libraryVideoId,
    `${libraryVideoId}.srt`
  );
const clipOutputPath = (clipId) =>
  path.join(publicDir, "clips", `${clipId}.mp4`);
const configPath = path.join(publicDir, "config.json");

// scan
const libraryRoot = path.join(publicDir, "library_videos");

const librarySrtPath = (libraryVideoId) =>
  path.join(
    publicDir,
    "library_videos",
    libraryVideoId,
    `${libraryVideoId}.srt`
  );

const libraryVideoExists = (id) =>
  fs.existsSync(libraryVideoPath(id)) && fs.existsSync(librarySrtPath(id));

// Exemple pour charger le config
let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("❌ Impossible de parser config.json :", err);
  }
} else {
  console.warn("⚠️ config.json non trouvé dans", configPath);
  return;
}

// ---------- UTILITAIRES SRT ----------
function parseSRT(srtContent) {
  const entries = [];
  const blocks = srtContent.split(/\r?\n\s*\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) {
      const timeLine =
        lines[1] && lines[1].includes("-->") ? lines[1] : lines[0];
      const match = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->?\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
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
        const textLines = lines.slice(lines.indexOf(timeLine) + 1);
        entries.push({ start, end, placeholder: textLines.join("\n").trim() });
      }
    }
  }

  console.log(`✅ Sous-titres chargés : ${entries.length} entrées`);
  return entries;
}

function hhmmssToSeconds(hms) {
  const [hh, mm, ss] = hms.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss;
}

function clipSubtitles(subtitles, clipStart, clipEnd) {
  return subtitles
    .filter((s) => s.end > clipStart && s.start < clipEnd)
    .map((s, index) => ({
      start: Math.max(0, s.start - clipStart),
      end: Math.min(clipEnd - clipStart, s.end - clipStart),
      placeholder: index + 1 + ": " + s.placeholder,
    }));
}

const generateVttFromSrt = (srtPath, vttPath) => {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(vttPath)) return resolve(); // déjà généré

    const args = [
      "-y",
      "-i",
      srtPath.replace(/\\/g, "/"),
      vttPath.replace(/\\/g, "/"),
    ];

    const ff = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    ff.stderr.on("data", (data) =>
      console.log(`[ffmpeg][vtt] ${data.toString()}`)
    );

    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg SRT→VTT failed"));
    });
  });
};

// ---------- PROCESS VIDEO ----------
async function processVideo(inputPath, outputPath, options = {}) {
  const {
    startTime = 0,
    endTime = null,
    addBlackBox = false,
    blackBoxHeight = 80,
    blackBoxColor = "black@1",
  } = options;
  let vf = "";
  if (addBlackBox)
    vf = `drawbox=x=0:y=ih-${blackBoxHeight}:width=iw:height=${blackBoxHeight}:color=${blackBoxColor}:t=fill`;

  const args = ["-i", inputPath.replace(/\\/g, "/")];
  if (startTime) args.push("-ss", startTime.toString());
  if (endTime) args.push("-to", endTime.toString());
  if (vf) args.push("-vf", vf);
  args.push("-c:a", "copy", "-y", outputPath.replace(/\\/g, "/"));

  console.log("FFmpeg command:", ffmpegPath, args.join(" "));

  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    ff.stdout.on("data", (data) => process.stdout.write(data.toString()));
    ff.stderr.on("data", (data) => process.stderr.write(data.toString()));
    ff.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

async function addVideoToConfig(
  outputPath,
  clipId,
  lang,
  start,
  end,
  libraryVideoId
) {
  let config = { clips: [] };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(await fs.promises.readFile(configPath, "utf-8"));
    } catch (err) {
      console.warn("⚠️ Impossible de lire ou parser config.json", err);
    }
  }

  let subtitles = [];
  try {
    const srtContent = await fs.promises.readFile(
      srtFilePath(libraryVideoId),
      "utf-8"
    );
    subtitles = clipSubtitles(
      parseSRT(srtContent),
      hhmmssToSeconds(start),
      hhmmssToSeconds(end)
    );
  } catch (err) {
    console.error("❌ Impossible de lire le SRT :", err);
  }

  const newVideo = {
    id: clipId,
    lang,
    path: `clips/${clipId}.mp4`,
    subtitles,
    startTime: start,
    endTime: end,
  };
  const existingIndex = config.clips.findIndex((v) => clipId === v.id);
  if (existingIndex >= 0) config.clips[existingIndex] = newVideo;
  else config.clips.push(newVideo);

  try {
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
    console.log(`✅ Vidéo "${clipId}" ajoutée ou mise à jour dans config.json`);
  } catch (err) {
    console.error("❌ Erreur lors de l'écriture du config.json :", err);
  }
}

// ---------- FFPROBE ----------
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath.replace(/\\/g, "/"),
    ];
    const probe = spawn(ffprobePath, args);
    let output = "";
    probe.stdout.on("data", (data) => (output += data.toString()));
    probe.stderr.on("data", (data) =>
      console.error("[ffprobe]", data.toString())
    );
    probe.on("close", (code) =>
      code !== 0
        ? reject(new Error("ffprobe failed"))
        : resolve(parseFloat(output))
    );
  });
}

// ---------- SRT <-> VIDEO ----------
function secondsToSRTTime(seconds) {
  const ms = Math.floor((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function subtitlesToSRT(subtitles) {
  return subtitles
    .map(
      (s, i) => `${i + 1}
${secondsToSRTTime(s.start)} --> ${secondsToSRTTime(s.end)}
${s.text ? s.text : s.placeholder}

`
    )
    .join("");
}

// ---------- RENDER ----------
const concatVideos = async (count) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(renderDir)) fs.mkdirSync(renderDir, { recursive: true });
    const concatFile = path.join(renderDir, "concat.txt");
    const finalOutput = path.join(renderDir, "final.mp4");
    const concatContent = Array.from({ length: count })
      .map((_, i) => `file '${i}.mp4'`)
      .join("\n");
    fs.writeFileSync(concatFile, concatContent, "utf8");
    const ffmpegArgs = [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-c",
      "copy",
      "-y",
      "final.mp4",
    ];
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      cwd: renderDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    ffmpegProcess.stderr.on("data", (data) => console.error(data.toString()));
    ffmpegProcess.on("close", (code) =>
      code !== 0
        ? reject(new Error("CONCAT_FAILED"))
        : resolve({ finalOutput, concatFile })
    );
  });
};

const cleanupRenderFiles = (count, concatFile) => {
  for (let i = 0; i < count; i++) {
    const clipPath = path.join(renderDir, `${i}.mp4`);
    if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
  }
  if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
  console.log("Temporary render files cleaned up");
};

const renderSubtitles = async (inputVideoPath, subtitles, index) => {
  return new Promise((resolve) => {
    if (!fs.existsSync(renderDir)) fs.mkdirSync(renderDir, { recursive: true });
    const srtPath = path.join(renderDir, `${index}.srt`).replace(/\\/g, "/");
    const outputPath = path.join(renderDir, `${index}.mp4`).replace(/\\/g, "/");
    fs.writeFileSync(srtPath, subtitlesToSRT(subtitles), { encoding: "utf8" });
    const ffmpegArgs = [
      "-i",
      inputVideoPath.replace(/\\/g, "/"),
      "-vf",
      `subtitles=${srtPath.replace(
        /:/g,
        "\\\\:"
      )}:force_style='Fontsize=24,PrimaryColour=&HFFFFFF&'`,
      "-c:a",
      "copy",
      "-y",
      outputPath,
    ];
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    ffmpegProcess.stderr.on("data", (data) =>
      console.error(`FFmpeg stderr: ${data}`)
    );
    ffmpegProcess.on("close", () => {
      fs.unlink(srtPath, () => resolve());
    });
  });
};

// ---------- GAMESTATE ----------
const gameState = {
  video: {
    id: null,
    index: 0,
    duration: 0,
    time: 0,
    playing: false,
    playerSelected: false,
    paused: false,
  },
  players: {},
  emoticons: {},
  clipSaves: {},
  timeline: [],
  renderUrl: null,
  finishedRender: false,
  receivedSubtitles: false,
};

const setGameStateVideoTime = (t) => {
  gameState.video.time = Math.max(
    0,
    Math.min(gameState.video.duration, t + 0.01)
  );
};

setInterval(() => {
  if (gameState.video.playing)
    setGameStateVideoTime(gameState.video.time + 0.5);
}, 500);

// ---------- EXPRESS + SOCKET.IO ----------
const app = express();

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // on veut une IPv4 qui n’est pas interne (pas 127.0.0.1)
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const PORT = 3000;
const server = app.listen(PORT, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`Serveur démarré :`);
  console.log(`- Local : http://localhost:${PORT}`);
  console.log(
    `- Réseau : http://${localIP}:${PORT} (accessible depuis d'autres appareils)`
  );
});

const io = socketio(server);
app.use(express.static(publicDir));

// ---------- LOAD VIDEO FUNCTION ----------
const currentTemplatePlayerIds = [];
const isTemplate = (id) => id.startsWith("template-");

const loadVideoId = async (id) => {
  let index = config.clips.findIndex((v) => v.id === id);
  if (index === -1) {
    console.warn(`⚠️ Video "${id}" non trouvée`);
    index = 0;
  }

  gameState.video.index = index;
  gameState.video.id = config.clips[gameState.video.index].id;
  setGameStateVideoTime(0);
  gameState.video.playing = false;

  try {
    gameState.video.duration = await getVideoDuration(
      path.join(publicDir, config.clips[gameState.video.index]?.path)
    );
  } catch (e) {
    console.error(e);
    gameState.video.duration = 0;
  }

  currentTemplatePlayerIds.forEach((id) => delete gameState.players[id]);
  Object.values(gameState.players).forEach((p) => {
    p.submitted = false;
    p.hasBeenSelected = false;
    p.subtitles = isTemplate(gameState.video.id)
      ? config[gameState.video.id].defaultSubtitles
      : config.clips[gameState.video.index].subtitles;
  });

  if (isTemplate(gameState.video.id) && config[gameState.video.id]) {
    Object.entries(config[gameState.video.id].players).forEach(
      ([id, player]) => {
        const gamePlayer = {
          name: player.name,
          submitted: true,
          hasBeenSelected: false,
          subtitles: player.subtitles,
        };
        gameState.players[id] = gamePlayer;
        currentTemplatePlayerIds.push(id);
        id === 0 ? (gameState.selectedPlayerId = id) : null;
      }
    );

    // console.log(Object.values(gameState.players).map((p) => p.name));
  }

  io.emit("gameState", gameState);
};

let isRendering = false;
const render = async () => {
  if (!gameState.timeline.length) return;
  if (isRendering) return;
  isRendering = true;

  const finalOutputPath = path.join(publicDir, "render", "final.mp4");

  // Supprimer l'ancien rendu si existant
  if (fs.existsSync(finalOutputPath)) {
    fs.unlinkSync(finalOutputPath);
    gameState.renderUrl = null;
    io.emit("gameState", gameState);
  }

  try {
    for (let index = 0; index < gameState.timeline.length; index++) {
      const videoId = gameState.timeline[index].videoId;
      const subtitles = gameState.timeline[index].subtitles;

      const videoIndex = config.clips.findIndex((v) => v.id === videoId);
      if (videoIndex === -1) continue;

      const inputVideoPath = path.join(
        publicDir,
        config.clips[videoIndex].path
      );

      console.log("Rendering subtitles for video", videoId, "at index", index);

      await renderSubtitles(inputVideoPath, subtitles, index);
    }

    // Concat finale
    const { finalOutput, concatFile } = await concatVideos(
      gameState.timeline.length
    );

    gameState.renderUrl = finalOutput;
    gameState.finishedRender = true;

    io.emit("gameState", gameState);

    gameState.finishedRender = false;
    isRendering = false;

    // Cleanup
    cleanupRenderFiles(gameState.timeline.length, concatFile);
  } catch (err) {
    console.error("❌ Render error:", err);
    isRendering = false;
  }
};

loadVideoId("template-1");

// ---------- SOCKETS ----------
io.on("connection", (socket) => {
  socket.on("register", ({ role, playerName }) => {
    socket.role = role;

    if (role === "player") {
      const playerId = crypto.randomUUID();
      socket.playerId = playerId;

      // console.log(
      //   playerId,
      //   " registered",
      //   isTemplate(gameState.video.id),
      //   config,
      //   gameState.video.id
      // );

      gameState.players[playerId] = {
        name: playerName || "Joueur " + Math.floor(Math.random() * 1000),
        submitted: false,
        hasBeenSelected: true, // wait submission of srt
        subtitles: isTemplate(gameState.video.id)
          ? config[gameState.video.id].defaultSubtitles
          : config.clips[gameState.video.index].subtitles,
      };

      if (gameState.players[playerId].subtitles.length === 0) {
        console.warn(`⚠️ Video "${gameState.video.id}" sans sous-titres`);
      }

      console.log(playerName, " connected");
    }

    io.emit("gameState", gameState);
  });

  socket.on("needGameState", () => {
    socket.emit("gameState", gameState);
  });

  socket.on("render", () => render());

  // ----- Subtitles -----

  socket.on("updateTimeline", (timelineClips) => {
    if (!gameState.video?.id) return;

    // Mettre à jour la timeline du gameState
    gameState.timeline = timelineClips;

    // Propager à tous les clients
    io.emit("gameState", gameState);
  });

  socket.on("deleteClipSave", ({ videoId, index }) => {
    if (!gameState.clipSaves?.[videoId]) return;

    gameState.clipSaves[videoId].splice(index, 1);

    // supprime de la timeline tous les clips qui ont le même nom et videoId
    gameState.timeline = gameState.timeline.filter(
      (clip) => !(clip.videoId === videoId && clip.index === index)
    );

    io.emit("gameState", gameState);
  });

  socket.on("saveRemoteSubtitles", ({ videoId, name, subtitles }) => {
    if (!gameState.video || videoId !== gameState.video.id) return;

    if (!gameState.clipSaves) gameState.clipSaves = {};
    if (!gameState.clipSaves[videoId]) gameState.clipSaves[videoId] = [];

    gameState.clipSaves[videoId].push({
      name,
      subtitles,
    });

    // 🔁 On broadcast le gamestate mis à jour
    io.emit("gameState", gameState);
  });

  socket.on("emoticon", ({ name, text }) => {
    if (gameState.emoticons[name]) return;
    gameState.emoticons[name] = text;
    setTimeout(() => delete gameState.emoticons[name], 3000);

    io.emit("gameState", gameState);
  });

  socket.on("submitSubtitles", (subtitles) => {
    if (subtitles.filter((s) => s.text !== "").length === 0) return;

    if (!socket.playerId) return;

    const player = gameState.players[socket.playerId];
    if (!player) return;

    player.submitted = true;
    player.subtitles = subtitles;
    player.hasBeenSelected = false;
    console.log(player.name, "submitted subtitles");

    gameState.receivedSubtitles = true;
    io.emit("gameState", gameState);
    gameState.receivedSubtitles = false;
  });

  // ----- Video navigation -----

  socket.on("nextVideo", () => {
    loadVideoId((gameState.video.index + 1) % config.clips.length);
  });

  socket.on("previousVideo", () => {
    loadVideoId(
      (gameState.video.index - 1 + config.clips.length) % config.clips.length
    );
  });

  socket.on("selectVideoById", (videoId) => {
    loadVideoId(videoId);
  });

  socket.on("deleteClip", (clipId) => {
    const configPath = path.resolve("./public/config.json");

    if (!fs.existsSync(configPath)) {
      console.error("❌ config.json introuvable !");
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const index = config.clips.findIndex((v) => v.id === clipId);

    if (index === -1) {
      console.warn(`⚠️ Clip "${clipId}" non trouvé dans config.json`);
      return;
    }

    // Récupère le chemin de la vidéo à supprimer
    const videoPath = path.resolve("./public", config.clips[index].path);

    // Supprime la vidéo si elle existe
    if (fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
        console.log(`✅ Vidéo "${clipId}" supprimée : ${videoPath}`);
      } catch (err) {
        console.error(`❌ Erreur lors de la suppression de la vidéo :`, err);
      }
    } else {
      console.log(`⚠️ Vidéo "${clipId}" introuvable : ${videoPath}`);
    }

    // Supprime le clip de la config
    config.clips.splice(index, 1);

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`✅ Clip "${clipId}" supprimé de config.json`);
    } catch (err) {
      console.error("❌ Erreur lors de la mise à jour de config.json :", err);
    }
  });

  socket.on(
    "createClip",
    async ({ libraryVideoId, clipId, lang, start, end }) => {
      if (!libraryVideoId || !clipId || !lang || start == null || end == null) {
        console.error("❌ Paramètres manquants pour createClip");
        return;
      }

      const inputPath = libraryVideoPath(libraryVideoId);
      const outputPath = clipOutputPath(clipId);

      await processVideo(inputPath, outputPath, {
        startTime: start,
        endTime: end,
        addBlackBox: false,
      });
      console.log(`✅ Vidéo traitée : ${outputPath}`);

      try {
        // Ajout au config.json
        await addVideoToConfig(
          outputPath,
          clipId,
          lang,
          start,
          end,
          libraryVideoId
        );
        console.log(`✅ Vidéo ajoutée à config.json : ${clipId}`);
      } catch (err) {
        console.error("❌ Erreur lors de l'ajout au config :", err);
      }
    }
  );

  // ----- Player selection -----

  socket.on("selectPlayer", (playerId) => {
    gameState.selectedPlayerId = playerId || null;
    const player = gameState.players[playerId];
    if (!player) {
      console.error("Player not found");
      return;
    }

    player.hasBeenSelected = true;
    gameState.video.playerSelected = true;

    io.emit("gameState", gameState);
    gameState.video.playerSelected = false;
  });

  socket.on("videoStateButtonClicked", () => {
    gameState.video.playing = !gameState.video.playing;
    gameState.video.paused = true;

    io.emit("gameState", gameState);
    gameState.video.paused = false;
  });

  socket.on("previousTimeButtonClicked", () => {
    setGameStateVideoTime(gameState.video.time - 5);
    io.emit("gameState", gameState);
  });

  socket.on("nextTimeButtonClicked", () => {
    setGameStateVideoTime(gameState.video.time + 5);
    io.emit("gameState", gameState);
  });

  socket.on("stopButtonClicked", () => {
    gameState.video.playing = false;
    gameState.video.paused = true;
    setGameStateVideoTime(0);

    io.emit("gameState", gameState);
    gameState.video.paused = false;
  });

  // ----- Disconnect -----

  socket.on("disconnect", () => {
    if (!socket.playerId) return;

    delete gameState.players[socket.playerId];

    if (gameState.selectedPlayerId === socket.playerId) {
      gameState.selectedPlayerId = null;
    }

    io.emit("gameState", gameState);
  });
});

// ---------- CONFIG HOT RELOAD ----------
const reloadConfig = async () => {
  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    config = JSON.parse(raw);
    loadVideoId(gameState.video.id);
    io.emit("reload");
  } catch (e) {
    setTimeout(reloadConfig, 100);
  }
};
fs.watch(configPath, () => reloadConfig());

const validateLibraryVideos = async () => {
  if (!Array.isArray(config.library_videos)) return;

  const validEntries = [];

  for (const entry of config.library_videos) {
    const { id, path: videoPath, srt: srtPath } = entry;

    if (!id || !videoPath || !srtPath) {
      console.warn("❌ Entrée invalide (champ manquant):", entry);
      continue;
    }

    const folderPath = path.join(libraryRoot, id);
    const expectedVideo = path.join(folderPath, `${id}.mp4`);
    const expectedSrt = path.join(folderPath, `${id}.srt`);

    const resolvedVideoPath = path.resolve(publicDir, videoPath);
    const resolvedSrtPath = path.resolve(publicDir, srtPath);

    const isValid =
      folderPath === path.dirname(resolvedVideoPath) &&
      folderPath === path.dirname(resolvedSrtPath) &&
      expectedVideo === resolvedVideoPath &&
      expectedSrt === resolvedSrtPath &&
      fs.existsSync(expectedVideo) &&
      fs.existsSync(expectedSrt);

    if (!isValid) {
      console.warn(`🗑️ Entrée corrompue supprimée : ${id}`);
      continue;
    }

    validEntries.push(entry);
  }

  // Réécriture si changement
  if (validEntries.length !== config.library_videos.length) {
    config.library_videos = validEntries;

    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      "utf-8"
    );

    await reloadConfig();
  }
};

const knownLibraryVideos = new Set();

const scanLibraryVideos = async () => {
  let dirs;
  try {
    dirs = await fs.promises.readdir(libraryRoot, { withFileTypes: true });
  } catch {
    return;
  }

  let updated = false;

  if (!Array.isArray(config.library_videos)) {
    config.library_videos = [];
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const id = dir.name;

    if (knownLibraryVideos.has(id)) continue;
    if (!libraryVideoExists(id)) continue;

    const srtPath = librarySrtPath(id);
    const vttPath = libraryVttPath(id);

    try {
      await generateVttFromSrt(srtPath, vttPath);
    } catch (err) {
      console.error(`❌ VTT generation failed for ${id}`, err);
      continue;
    }

    if (config.library_videos.some((v) => v.id === id)) {
      knownLibraryVideos.add(id);
      console.log(`📥 détectée : ${id}`);
      continue;
    }

    console.log(`📥 Nouvelle vidéo de librairie détectée : ${id}`);

    config.library_videos.push({
      id,
      lang: "langue",
      path: `./library_videos/${id}/${id}.mp4`,
      srt: `./library_videos/${id}/${id}.srt`,
      vtt: `./library_videos/${id}/${id}.vtt`,
    });

    knownLibraryVideos.add(id);
    updated = true;
  }

  if (!updated) return;

  await fs.promises.writeFile(
    configPath,
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  await reloadConfig();
};

let libraryScanTimeout = null;

if (!fs.existsSync(libraryRoot)) {
  fs.mkdirSync(libraryRoot, { recursive: true });
}

fs.watch(libraryRoot, { recursive: true }, () => {
  clearTimeout(libraryScanTimeout);
  libraryScanTimeout = setTimeout(async () => {
    await scanLibraryVideos();
    await validateLibraryVideos();
  }, 1000);
});

// Scan initial au démarrage
validateLibraryVideos();
scanLibraryVideos();

const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const path = require("path");
const { spawn } = require("child_process");

function isTemplate(id) {
  return id.startsWith("template-");
}

function getVideoDuration(path) {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`,
      (err, stdout) => {
        if (err) return reject(err);
        const duration = parseFloat(stdout);
        resolve(duration);
      }
    );
  });
}

const gameState = {
  video: {
    id: null,
    index: 0,
    duration: 0,
    time: 0,
    // event
    playerSelected: false,
  },
  players: {},
  emoticons: {},
  clipSaves: {},
  timeline: [],
  renderUrl: null,
  // events
  finishedRender: false,
  receivedSubtitles: false,
};

const app = express();

const server = app.listen(3000, "0.0.0.0", () => {
  console.log("Serveur démarré sur http://0.0.0.0:3000");
});
const io = socketio(server);

// ---------- CONFIG ----------

function loadConfig() {
  return JSON.parse(fs.readFileSync("public/config.json"));
}

const currentTemplatePlayerIds = [];
const loadVideoId = async (id) => {
  let index = config.videos.findIndex((v) => v.id === id);

  if (index === -1) {
    console.warn(`⚠️ Video "${id}" non trouvée dans config.json`);
    index = 0;
  }

  gameState.video.index = index;
  gameState.video.id = config.videos[gameState.video.index].id;
  gameState.video.time = 0;
  gameState.video.playing = false;

  // Récupération dynamique de la durée
  try {
    gameState.video.duration = await getVideoDuration(
      `public/${config.videos[gameState.video.index]?.path}`
    );
    console.log("Durée vidéo:", gameState.video.duration);
  } catch (e) {
    console.error("Erreur récupération durée vidéo:", e);
    gameState.video.duration = 0;
  }

  currentTemplatePlayerIds.forEach(([id]) => {
    delete gameState.players[id];
  });

  Object.values(gameState.players).forEach((p) => {
    p.submitted = false;
    p.submitHasBeenPlayed = false;

    p.subtitles = isTemplate(gameState.video.id)
      ? config[gameState.video.id].defaultSubtitles
      : config.videos[gameState.video.index].subtitles;

    if (p.subtitles.length === 0) {
      console.warn(`⚠️ Video "${gameState.video.id}" sans sous-titres`);
    }
  });

  if (isTemplate(gameState.video.id) && config[gameState.video.id]) {
    Object.entries(config[gameState.video.id].players).forEach(
      ([id, player]) => {
        const gamePlayer = {
          name: player.name,
          submitted: true,
          submitHasBeenPlayed: false,
          subtitles: player.subtitles,
        };
        gameState.players[id] = gamePlayer;
        currentTemplatePlayerIds.push(id);
        id === 0 ? (gameState.selectedPlayerId = id) : null;
      }
    );

    console.log(Object.values(gameState.players).map((p) => p.name));
  }

  io.emit("gameState", gameState);
};

let config = loadConfig();
loadVideoId("template-1");

// ---------- STATIC FILES ----------

app.use(express.static("public"));

// Fonction pour convertir des secondes en format SRT
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

// Fonction pour convertir les sous-titres en format SRT
function subtitlesToSRT(subtitles) {
  return subtitles
    .map((s, i) => {
      return `${i + 1}
${secondsToSRTTime(s.start)} --> ${secondsToSRTTime(s.end)}
${s.text ? s.text : s.placeholder}

`;
    })
    .join("");
}

const concatVideos = async (count) => {
  return new Promise((resolve, reject) => {
    const outputDir = path.join("public", "render");
    const concatFile = path.join(outputDir, "concat.txt");
    const finalOutput = path.join(outputDir, "final.mp4");

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

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
      "concat.txt", // relatif au cwd
      "-c",
      "copy",
      "-y",
      "final.mp4", // relatif au cwd
    ];

    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      cwd: outputDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    ffmpegProcess.stderr.on("data", (data) => {
      console.error("FFmpeg concat stderr:", data.toString());
    });

    ffmpegProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error("CONCAT_FAILED"));
      }
      resolve({ finalOutput, concatFile });
    });
  });
};

const cleanupRenderFiles = (count, concatFile) => {
  const outputDir = path.join("public", "render");

  for (let i = 0; i < count; i++) {
    const clipPath = path.join(outputDir, `${i}.mp4`);
    if (fs.existsSync(clipPath)) {
      fs.unlinkSync(clipPath);
    }
  }

  if (fs.existsSync(concatFile)) {
    fs.unlinkSync(concatFile);
  }

  console.log("Temporary render files cleaned up");
};

const renderSubtitles = async (inputVideoPath, subtitles, index) => {
  return new Promise((resolve) => {
    const outputDir = path.join("public", "render");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const renderId = index;
    const srtPath = path.join(outputDir, `${renderId}.srt`).replace(/\\/g, "/");
    const outputPath = path
      .join(outputDir, `${renderId}.mp4`)
      .replace(/\\/g, "/");

    // Générer le fichier SRT
    console.log(subtitles.length, "sous-titres");
    const srtContent = subtitlesToSRT(subtitles);
    fs.writeFileSync(srtPath, srtContent, { encoding: "utf8" });

    // Commande FFmpeg
    const ffmpegArgs = [
      "-i",
      inputVideoPath,
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

    console.log("Spawning FFmpeg with args:", ffmpegArgs.join(" "));

    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    ffmpegProcess.stderr.on("data", (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpegProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("FFmpeg exited with code", code);
      }

      if (!fs.existsSync(outputPath)) {
        console.error(`Output file ${outputPath} does not exist`);
      }

      // Suppression asynchrone du fichier .srt
      fs.unlink(srtPath, (err) => {
        if (err) {
          console.error(
            `Erreur lors de la suppression du fichier ${srtPath}:`,
            err
          );
        } else {
          console.log(`Fichier ${srtPath} supprimé avec succès.`);
          resolve();
        }
      });
    });
  });
};

let isRendering = false;
const render = async () => {
  if (!gameState.timeline.length) return;
  if (isRendering) return;
  isRendering = true;

  if (fs.existsSync("./public/render/final.mp4")) {
    fs.unlinkSync("./public/render/final.mp4");
    gameState.renderUrl = null;
    io.emit("gameState", gameState);
  }

  try {
    for (let index = 0; index < gameState.timeline.length; index++) {
      const videoId = gameState.timeline[index].videoId;
      const subtitles = gameState.timeline[index].subtitles;

      let videoIndex = config.videos.findIndex((v) => v.id === videoId);

      console.log("Rendering subtitles for video", videoId, "at index", index);

      await renderSubtitles(
        `public/${config.videos[videoIndex].path}`,
        subtitles,
        index
      );
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
    console.error(err);
  }
};

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
        submitHasBeenPlayed: true, // wait submission of srt
        subtitles: isTemplate(gameState.video.id)
          ? config[gameState.video.id].defaultSubtitles
          : config.videos[gameState.video.index].subtitles,
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
    player.submitHasBeenPlayed = false;
    console.log(player.name, "submitted subtitles");

    gameState.receivedSubtitles = true;
    io.emit("gameState", gameState);
    gameState.receivedSubtitles = false;
  });

  // ----- Video navigation -----

  socket.on("nextVideo", () => {
    loadVideoId((gameState.video.index + 1) % config.videos.length);
  });

  socket.on("previousVideo", () => {
    loadVideoId(
      (gameState.video.index - 1 + config.videos.length) % config.videos.length
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
    const index = config.videos.findIndex((v) => v.id === clipId);

    if (index === -1) {
      console.warn(`⚠️ Clip "${clipId}" non trouvé dans config.json`);
      return;
    }

    // Récupère le chemin de la vidéo à supprimer
    const videoPath = path.resolve("./public", config.videos[index].path);

    // Supprime la vidéo si elle existe
    if (fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
        console.log(`✅ Vidéo "${clipId}" supprimée : ${videoPath}`);
      } catch (err) {
        console.error(`❌ Erreur lors de la suppression de la vidéo :`, err);
      }
    }

    // Supprime le clip de la config
    config.videos.splice(index, 1);

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`✅ Clip "${clipId}" supprimé de config.json`);
    } catch (err) {
      console.error("❌ Erreur lors de la mise à jour de config.json :", err);
    }
  });

  socket.on("createClip", ({ libraryVideoId, lang, id, start, end }) => {
    // Arguments séparés, pas de concaténation dans une string
    const args = [
      "./create_clip.js",
      libraryVideoId,
      id, // ton clipId
      lang,
      start,
      end,
    ];

    const child = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });

    // Affiche stdout en temps réel
    child.stdout.on("data", (data) => {
      console.log(`[stdout] ${data.toString()}`);
    });

    // Affiche stderr en temps réel
    child.stderr.on("data", (data) => {
      console.error(`[stderr] ${data.toString()}`);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Clip "${id}" créé avec succès !`);
      } else {
        console.error(`❌ FFmpeg/Script terminé avec code ${code}`);
      }
    });
  });

  // ----- Player selection -----

  socket.on("selectPlayer", (playerId) => {
    gameState.selectedPlayerId = playerId || null;
    const player = gameState.players[playerId];
    if (!player) {
      console.error("Player not found");
      return;
    }

    player.submitHasBeenPlayed = true;
    gameState.video.playing = true;
    gameState.video.time = 0;

    gameState.video.playerSelected = true;
    console.log(player.name, gameState);
    io.emit("gameState", gameState);
    // gameState.playerSelected = false;
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

fs.watch("public/config.json", () => {
  try {
    config = loadConfig();

    loadVideoId(gameState.video.id);

    io.emit("reload");
  } catch (e) {
    console.error(e);
  }
});

const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const path = require("path");
const { spawn } = require("child_process");

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
    playing: false,
  },
  players: {},
};

const app = express();
const server = app.listen(3000, () =>
  console.log("Serveur démarré sur http://localhost:3000")
);
const io = socketio(server);

// ---------- CONFIG ----------

function loadConfig() {
  return JSON.parse(fs.readFileSync("public/config.json"));
}

const loadVideoId = async (id) => {
  const index = config.videos.findIndex((v) => v.id === id);
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

  Object.values(gameState.players).forEach((p) => {
    p.submitted = false;
    p.submitHasBeenPlayed = true;

    if (id === "tutoriel") {
      p.subtitles = config.tutorial.subtitlesPlayer;
    } else {
      p.subtitles = config.videos[gameState.video.index].subtitles;
    }
  });

  if (id == "tutoriel") {
    const tutorialPlayer = {
      name: "Cliquez ici pour commencer",
      submitted: true,
      submitHasBeenPlayed: false,
      subtitles: config.tutorial.subtitlesTutorialPlayer,
    };
    gameState.players.tutorialPlayer = tutorialPlayer;
    gameState.selectedPlayerId = "tutorialPlayer";
  } else {
    delete gameState.players.tutorialPlayer;
  }

  io.emit("gameState", gameState);
};

let config = loadConfig();
loadVideoId("tutoriel");

const mapUUIDCancelled = new Map();
let currentVideoEndPromiseUUID = null;
const createVideoEndPromise = () => {
  const duration = gameState.video.duration;
  const time = gameState.video.time;
  const promiseDuration = duration * 1000 - time * 1000 + 5000;

  const uuid = crypto.randomUUID();

  console.log(
    "Création de la promesse de fin de vidéo:",
    promiseDuration,
    duration,
    time,
    uuid
  );

  const interval = setInterval(() => {
    if (mapUUIDCancelled.get(uuid)) {
      clearInterval(interval);
      return;
    }

    gameState.video.time = Math.min(
      gameState.video.duration,
      gameState.video.time + 0.1
    );
  }, 100);

  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(uuid);
      clearInterval(interval);
      console.log("Promesse terminée");
    }, promiseDuration);
  });

  mapUUIDCancelled.set(uuid, false);
  currentVideoEndPromiseUUID = uuid;

  promise.then((pUUID) => {
    if (mapUUIDCancelled.get(pUUID)) {
      console.log("Annulée", pUUID);
      delete mapUUIDCancelled.get(pUUID);
      return;
    }
    console.log("Non annulée", pUUID);

    gameState.video.playing = false;

    delete mapUUIDCancelled.get(pUUID);

    currentVideoEndPromiseUUID = null;

    io.emit("gameState", gameState);
  });
};

const cancelVideoEndPromise = () => {
  if (currentVideoEndPromiseUUID) {
    console.log(
      "Annulation de la promesse de fin de vidéo",
      currentVideoEndPromiseUUID
    );
    mapUUIDCancelled.set(currentVideoEndPromiseUUID, true);
    currentVideoEndPromiseUUID = null;
  }
};

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
    .filter((s) => s.text && s.text.trim() !== "")
    .map((s, i) => {
      return `${i + 1}
${secondsToSRTTime(s.start)} --> ${secondsToSRTTime(s.end)}
${s.text}

`;
    })
    .join("");
}

app.get("/render", async (req, res) => {
  try {
    const { video, selectedPlayerId, players } = gameState;
    const player = players[selectedPlayerId];
    if (!video.id || !player || !player.subtitles?.length) {
      return res.status(400).json({ error: "INVALID_STATE" });
    }

    const videoConfig = config.videos[video.index];
    const inputVideoPath = path
      .resolve("public", videoConfig.path)
      .replace(/\\/g, "/");
    const outputDir = path.join("public", "downloads/created");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const renderId = Date.now().toString();
    const srtPath = path.join(outputDir, `${renderId}.srt`).replace(/\\/g, "/");
    const outputPath = path
      .join(outputDir, `${renderId}.mp4`)
      .replace(/\\/g, "/");

    // Générer le fichier SRT
    const srtContent = subtitlesToSRT(player.subtitles);
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
        return res.status(500).json({ error: "FFMPEG_FAILED" });
      }

      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ error: "NO_OUTPUT" });
      }

      res.json({
        success: true,
        url: `/downloads/created/${renderId}.mp4`,
      });

      // Suppression asynchrone du fichier .srt
      fs.unlink(srtPath, (err) => {
        if (err) {
          console.error(
            `Erreur lors de la suppression du fichier ${srtPath}:`,
            err
          );
        } else {
          console.log(`Fichier ${srtPath} supprimé avec succès.`);
        }
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ---------- SOCKETS ----------

io.on("connection", (socket) => {
  socket.on("register", ({ role, playerName }) => {
    socket.role = role;

    if (role === "player") {
      const playerId = crypto.randomUUID();
      socket.playerId = playerId;

      gameState.players[playerId] = {
        name: playerName || "Joueur",
        submitted: false,
        submitHasBeenPlayed: true, // wait submission of srt
        subtitles:
          gameState.video.id === "tutoriel"
            ? config.tutorial.subtitlesPlayer
            : config.videos[gameState.video.index].subtitles,
      };

      console.log(playerName, " connected");
    }

    socket.emit("gameState", gameState);
    socket.broadcast.emit("gameState", gameState);
  });

  socket.on("needGameState", () => {
    socket.emit("gameState", gameState);
  });

  // ----- Subtitles -----

  socket.on("submitSubtitles", (subtitles) => {
    if (subtitles.filter((s) => s.text !== "").length === 0) return;
    console.log(subtitles.filter((s) => s.text !== "").length);
    if (!socket.playerId) return;

    const player = gameState.players[socket.playerId];
    if (!player) return;

    player.submitted = true;
    player.subtitles = subtitles;
    player.submitHasBeenPlayed = false;
    console.log(player.name, "submitted subtitles");

    io.emit("gameState", gameState);
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

  // ----- Player selection -----

  socket.on("selectPlayer", (playerId) => {
    gameState.selectedPlayerId = playerId || null;
    const player = gameState.players[playerId];
    if (!player) {
      console.error("Player not found");
      return;
    }

    cancelVideoEndPromise();

    player.submitHasBeenPlayed = true;
    gameState.video.playing = true;
    gameState.video.time = 0;
    createVideoEndPromise();
    io.emit("gameState", gameState);
  });

  // ----- Disconnect -----

  socket.on("disconnect", () => {
    if (!socket.playerId) return;

    console.log(gameState.players[socket.playerId], " disconnected");
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

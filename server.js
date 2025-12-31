const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");

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
  selectedPlayerId: null,
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

let config = loadConfig();
gameState.video.index = 0;
gameState.video.id = config.videos[0]?.id ?? null;
updateGameState();

const mapUUIDCancelled = new Map();
let currentVideoEndPromiseUUID = null;
const createVideoEndPromise = () => {
  const duration = gameState.video.duration;
  const time = gameState.video.time;
  const promiseDuration = duration * 1000 - time * 1000 + 2000;

  const uuid = crypto.randomUUID();

  console.log(
    "Création de la promesse de fin de vidéo:",
    promiseDuration,
    duration,
    time,
    uuid
  );

  const promise = new Promise((resolve) => {
    setTimeout(() => {
      resolve(uuid);
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
    gameState.video.time = 0;

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

// ---------- GAME STATE RESET ----------

async function updateGameState() {
  gameState.video.time = 0;
  gameState.video.playing = false;
  gameState.selectedPlayerId = null;

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
    p.subtitles = [];
  });

  io.emit("gameState", gameState);
}

// ---------- STATIC FILES ----------

app.use(express.static("public"));

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
        subtitles: [],
      };

      console.log(playerName, " connected");
    }

    socket.emit("gameState", gameState);
    socket.broadcast.emit("gameState", gameState);
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

    io.emit("gameState", gameState);
  });

  // ----- Video navigation -----

  socket.on("nextVideo", () => {
    gameState.video.index = (gameState.video.index + 1) % config.videos.length;

    gameState.video.id = config.videos[gameState.video.index].id;
    updateGameState();
  });

  socket.on("previousVideo", () => {
    gameState.video.index =
      (gameState.video.index - 1 + config.videos.length) % config.videos.length;

    gameState.video.id = config.videos[gameState.video.index].id;
    updateGameState();
  });

  socket.on("selectVideoById", (videoId) => {
    const index = config.videos.findIndex((v) => v.id === videoId);
    if (index === -1) return;

    gameState.video.index = index;
    gameState.video.id = videoId;
    updateGameState();
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
  config = loadConfig();

  const index = config.videos.findIndex((v) => v.id === gameState.video.id);

  if (index === -1) {
    gameState.video.index = 0;
    gameState.video.id = config.videos[0]?.id ?? null;
  } else {
    gameState.video.index = index;
  }

  updateGameState();

  io.emit("reload");
});

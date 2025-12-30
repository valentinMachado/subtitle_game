const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");

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

// ---------- GAME STATE RESET ----------

function updateGameState() {
  gameState.video.duration = 0;
  gameState.video.time = 0;
  gameState.video.playing = false;
  gameState.selectedPlayerId = null;

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
        subtitles: [],
      };

      console.log(playerName, " connected");
    }

    socket.emit("gameState", gameState);
    socket.broadcast.emit("gameState", gameState);
  });

  // ----- Remote controls -----

  socket.on("remotePlay", () => {
    gameState.video.playing = true;
    io.emit("gameState", gameState);
  });

  socket.on("remotePause", () => {
    gameState.video.playing = false;
    io.emit("gameState", gameState);
  });

  socket.on("remoteSeek", (time) => {
    gameState.video.time = time;
    io.emit("gameState", gameState);
  });

  socket.on("videoTimeUpdate", (time) => {
    gameState.video.time = time;
    io.emit("gameState", gameState);
  });

  socket.on("videoDurationUpdate", (duration) => {
    gameState.video.duration = duration;
    io.emit("gameState", gameState);
  });

  // ----- Subtitles -----

  socket.on("submitSubtitles", (subtitles) => {
    if (!socket.playerId) return;

    const player = gameState.players[socket.playerId];
    if (!player) return;

    player.submitted = true;
    player.subtitles = subtitles;

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
});

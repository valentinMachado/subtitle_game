const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const gameState = {
  video: {
    index: 0,
    data: null, // vidéo courante (objet config)
    duration: 0,
    time: 0,
    playing: false,
  },

  players: {
    // playerId: { name, submitted, subtitles }
  },

  selectedPlayerId: null,
};

const app = express();
const server = app.listen(3000, () =>
  console.log("Serveur démarré sur http://localhost:3000")
);
const io = socketio(server);

// Fonction pour charger la configuration
function loadConfig() {
  try {
    const config = JSON.parse(fs.readFileSync("public/config.json"));
    console.log("Configuration rechargée :", config);
    return config;
  } catch (err) {
    console.error("Erreur de chargement de config.json :", err);
    return { videos: [] };
  }
}

let config = loadConfig();
gameState.video.data = config.videos[0] || null;

// Serve les fichiers statiques
app.use(express.static("public"));

// Gestion des connexions
io.on("connection", (socket) => {
  console.log("Nouvelle connexion :", socket.id);

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

      console.log("Joueur connecté :", playerId);
    }

    console.log(gameState);

    socket.emit("gameState", gameState);
    socket.broadcast.emit("gameState", gameState);
  });

  // Contrôles de la télécommande
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

  // Événements de durée et temps
  socket.on("videoTimeUpdate", (time) => {
    gameState.video.time = time;
    io.emit("gameState", gameState);
  });

  socket.on("videoDurationUpdate", (duration) => {
    gameState.video.duration = duration;
    io.emit("gameState", gameState);
  });

  // Modifie le socket.on("submitSubtitles") comme ceci:
  socket.on("submitSubtitles", (subtitles) => {
    if (!socket.playerId) return;

    const player = gameState.players[socket.playerId];
    if (!player) return;

    player.submitted = true;
    player.subtitles = subtitles;

    io.emit("gameState", gameState);
  });

  // Passer à la vidéo suivante
  socket.on("nextVideo", () => {
    gameState.video.index = (gameState.video.index + 1) % config.videos.length;

    gameState.video.data = config.videos[gameState.video.index];
    gameState.video.duration = 0;
    gameState.video.time = 0;
    gameState.video.playing = false;
    gameState.selectedPlayerId = null;

    Object.values(gameState.players).forEach((p) => {
      p.submitted = false;
      p.subtitles = [];
    });

    io.emit("gameState", gameState);
  });

  // Sélection d'un joueur pour afficher ses sous-titres
  socket.on("selectPlayer", (playerId) => {
    gameState.selectedPlayerId = playerId || null;
    io.emit("gameState", gameState);
  });

  // Déconnexion
  socket.on("disconnect", () => {
    if (socket.playerId) {
      delete gameState.players[socket.playerId];

      if (gameState.selectedPlayerId === socket.playerId) {
        gameState.selectedPlayerId = null;
      }

      io.emit("gameState", gameState);

      console.log("Joueur déconnecté :", socket.playerId);
    }
  });
});

// Surveiller les changements de config.json
fs.watch("public/config.json", (eventType) => {
  if (eventType === "change") {
    const newConfig = loadConfig();
    config = newConfig;

    if (gameState.video.index >= config.videos.length) {
      gameState.video.index = 0;
    }

    gameState.video.data = config.videos[gameState.video.index] || null;
    gameState.video.duration = 0;
    gameState.video.time = 0;
    gameState.video.playing = false;

    io.emit("gameState", gameState);
  }
});

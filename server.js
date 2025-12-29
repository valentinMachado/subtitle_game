const express = require("express");
const socketio = require("socket.io");
const fs = require("fs");
const path = require("path");

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
    return { videos: [] }; // Retourne une config vide en cas d'erreur
  }
}

let config = loadConfig();
let currentVideoIndex = 0;
let currentVideo = config.videos[currentVideoIndex] || null;
let players = new Set();
let submittedPlayers = new Set();
let subtitles = [];

// Serve les fichiers statiques
app.use(express.static("public"));

// Gestion des connexions
io.on("connection", (socket) => {
  console.log("Nouvelle connexion !");
  players.add(socket.id);

  // Envoie la vidéo courante
  socket.emit("init", { currentVideo, subtitles });

  // Joueur soumet ses sous-titres
  socket.on("submitSubtitles", (playerSubtitles) => {
    submittedPlayers.add(socket.id);
    subtitles.push({ playerId: socket.id, playerSubtitles });

    // Tous les joueurs ont soumis
    if (submittedPlayers.size === players.size && players.size > 0) {
      io.emit("allSubmitted", subtitles);
    }
  });

  // Passer à la vidéo suivante
  socket.on("nextVideo", () => {
    currentVideoIndex = (currentVideoIndex + 1) % config.videos.length;
    currentVideo = config.videos[currentVideoIndex];
    subtitles = [];
    submittedPlayers.clear();
    io.emit("videoChanged", currentVideo);
  });

  socket.on("videoTimeUpdate", (currentTime) => {
    io.emit("videoTimeUpdate", currentTime); // Relaye à TOUTES les télécommandes
    // console.log("Relayage de videoTimeUpdate :", currentTime); // Debug
  });

  socket.on("videoDurationUpdate", (duration) => {
    io.emit("videoDuration", duration); // Relaye à TOUTES les télécommandes
    // console.log("Relayage de videoDuration :", duration); // Debug
  });

  // Dans server.js, à l'intérieur du bloc io.on("connection", (socket) => { ... })
  socket.on("remotePlay", () => {
    io.emit("remotePlay"); // Rediffuse à tous les clients (y compris game_screen.html)
  });

  socket.on("remotePause", () => {
    io.emit("remotePause"); // Rediffuse à tous les clients
  });

  socket.on("remoteSeek", (time) => {
    io.emit("remoteSeek", time); // Rediffuse à tous les clients avec le temps
  });

  // Déconnexion
  socket.on("disconnect", () => {
    players.delete(socket.id);
    submittedPlayers.delete(socket.id);
  });
});

// Surveiller les changements de config.json
fs.watch("public/config.json", (eventType, filename) => {
  if (eventType === "change") {
    console.log("Fichier config.json modifié, rechargement...");
    const newConfig = loadConfig();

    // Vérifie si la vidéo courante existe toujours
    if (currentVideoIndex >= newConfig.videos.length) {
      currentVideoIndex = 0;
    }
    currentVideo = newConfig.videos[currentVideoIndex] || null;
    config = newConfig;

    // Notifie tous les clients
    io.emit("videoChanged", currentVideo);
    console.log("Nouvelle vidéo envoyée aux clients :", currentVideo?.path);
  }
});

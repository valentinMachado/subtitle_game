const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// ---------- CONFIG ----------
const SECRET_PATH = path.resolve("./secret.json"); // chemin vers secret.json
const PLAYER_ID = process.argv[2]; // premier argument : id du joueur
const PASSWORD = process.argv[3]; // deuxième argument : mot de passe
const ROLE = process.argv[4] || "player"; // rôle par défaut "player"

if (!PLAYER_ID || !PASSWORD) {
  console.error("Usage: node addPlayer.js <id> <password> [role]");
  process.exit(1);
}

// ---------- Lire secret.json ----------
let secret = {};
if (fs.existsSync(SECRET_PATH)) {
  try {
    secret = JSON.parse(fs.readFileSync(SECRET_PATH, "utf-8"));
  } catch (err) {
    console.error("❌ Impossible de lire secret.json :", err);
    process.exit(1);
  }
}

// Assurer que secret.players existe
if (!secret.players || typeof secret.players !== "object") {
  secret.players = {};
}

// ---------- Ajouter le joueur ----------
if (secret.players[PLAYER_ID]) {
  console.warn(`⚠️ Le joueur "${PLAYER_ID}" existe déjà. Écrasement.`);
}

secret.players[PLAYER_ID] = {
  passwordHash: bcrypt.hashSync(PASSWORD, 10),
  role: ROLE,
  id: crypto.randomUUID(),
};

// ---------- Écrire secret.json ----------
try {
  fs.writeFileSync(SECRET_PATH, JSON.stringify(secret, null, 2), "utf-8");
  console.log(`✅ Joueur "${PLAYER_ID}" ajouté avec succès !`);
} catch (err) {
  console.error("❌ Impossible d’écrire dans secret.json :", err);
  process.exit(1);
}

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const secretPath = path.join(__dirname, "secret.json");

// Génère une clé aléatoire de 64 octets convertie en hexadécimal
const newSecret = crypto.randomBytes(64).toString("hex");

let data = {};

// Si le fichier existe déjà, on le lit pour ne pas écraser les autres données (comme les users)
if (fs.existsSync(secretPath)) {
  try {
    data = JSON.parse(fs.readFileSync(secretPath, "utf8"));
  } catch (e) {
    console.log("⚠️ Fichier secret.json mal formé, création d'un nouveau.");
  }
}

// On ajoute ou met à jour le JWT_SECRET
data.JWT_SECRET = newSecret;

// Écriture dans le fichier
fs.writeFileSync(secretPath, JSON.stringify(data, null, 2), "utf8");

console.log("✅ JWT_SECRET généré avec succès dans secret.json");

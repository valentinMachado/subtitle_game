const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const USERS_FILE = path.resolve(__dirname, "users.txt");

if (!fs.existsSync(USERS_FILE)) {
  console.error("❌ Fichier users.txt introuvable");
  process.exit(1);
}

const lines = fs
  .readFileSync(USERS_FILE, "utf-8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

(async () => {
  for (const line of lines) {
    const [id, mdp] = line.split(/\s+/);

    if (!id || !mdp) {
      console.warn(`⚠️ Ligne invalide ignorée : "${line}"`);
      continue;
    }

    console.log(`▶ Création utilisateur : ${id}`);

    await new Promise((resolve, reject) => {
      const p = spawn("node", ["./create-user", id, mdp], { stdio: "inherit" });

      p.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`create-user failed (${id})`));
      });
    });
  }

  console.log("✅ Tous les utilisateurs ont été traités");
})();

const express = require("express");
const { getUsersCollection } = require("../lib/db");
const { cors } = require("../lib/cors");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/generate-code
 * Body: { minecraft_username: string }
 *
 * Genera un código numérico aleatorio (1-1000), lo guarda asociado al
 * usuario con estado 'pending' y lo devuelve.
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username } = req.body || {};

    if (!minecraft_username || typeof minecraft_username !== "string") {
      return res.status(400).json({ error: "minecraft_username es requerido." });
    }

    const username = minecraft_username.trim();
    if (username.length < 3 || username.length > 16) {
      return res.status(400).json({ error: "Nombre de usuario de Minecraft inválido." });
    }

    const code = Math.floor(Math.random() * 1000) + 1; // 1-1000

    const users = await getUsersCollection();

    await users.updateOne(
      { minecraft_username: username },
      {
        $set: {
          minecraft_username: username,
          pending_code: code,
          status: "pending",
          updated_at: new Date(),
        },
        $setOnInsert: {
          balance: 0,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    return res.status(200).json({ minecraft_username: username, code, status: "pending" });
  } catch (err) {
    console.error("Error en /generate-code:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Una app de Express es en sí misma una función (req, res) => {...},
// por lo que Vercel puede usarla directamente como Serverless Function.
module.exports = app;

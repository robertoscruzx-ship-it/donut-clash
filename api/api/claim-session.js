const express = require("express");
const crypto = require("crypto");
const { getUsersCollection } = require("../lib/db");
const { cors } = require("../lib/cors");
const { randomServerSeed, hashServerSeed } = require("../lib/fairness");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/claim-session
 * Body: { minecraft_username }
 *
 * Se llama UNA vez desde el frontend justo después de detectar que la
 * cuenta quedó 'linked'. Devuelve un session_token que el frontend debe
 * enviar en cada apuesta, para que solo el dueño real de la cuenta pueda
 * jugar con su saldo (un tercero que solo conozca el username público no
 * podrá apostar). También inicializa el compromiso provably-fair
 * (server_seed + su hash público) que se usará en todas las apuestas
 * hasta que el jugador decida rotarlo (ver /api/fairness/reveal).
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username } = req.body || {};
    if (!minecraft_username) {
      return res.status(400).json({ error: "minecraft_username es requerido." });
    }
    const username = String(minecraft_username).trim();

    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });

    if (!user || user.status !== "linked") {
      return res.status(400).json({ error: "La cuenta no está vinculada." });
    }
    if (user.session_claimed) {
      return res.status(409).json({
        error: "La sesión ya fue reclamada. Si perdiste el token, vuelve a vincular la cuenta.",
      });
    }

    const session_token = crypto.randomBytes(24).toString("hex");
    const server_seed = randomServerSeed();
    const server_seed_hash = hashServerSeed(server_seed);

    await users.updateOne(
      { minecraft_username: username },
      {
        $set: {
          session_token,
          session_claimed: true,
          server_seed,
          server_seed_hash,
          nonce: 0,
        },
      }
    );

    return res.status(200).json({ session_token, server_seed_hash });
  } catch (err) {
    console.error("Error en /claim-session:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

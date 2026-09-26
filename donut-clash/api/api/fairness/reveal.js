const express = require("express");
const { getUserBySession } = require("../../lib/session");
const { getUsersCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { randomServerSeed, hashServerSeed } = require("../../lib/fairness");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/fairness/reveal
 * Body: { minecraft_username, session_token }
 *
 * Revela el server_seed usado hasta ahora (para que el jugador pueda
 * verificar cualquiera de sus apuestas anteriores recalculando
 * HMAC(server_seed, `${client_seed}:${nonce}`)) y genera uno nuevo para
 * las próximas apuestas.
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token } = req.body || {};
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const revealed_server_seed = user.server_seed;
    const revealed_hash = user.server_seed_hash;
    const total_bets_under_seed = user.nonce;

    const new_server_seed = randomServerSeed();
    const new_server_seed_hash = hashServerSeed(new_server_seed);

    const users = await getUsersCollection();
    await users.updateOne(
      { minecraft_username: user.minecraft_username },
      { $set: { server_seed: new_server_seed, server_seed_hash: new_server_seed_hash, nonce: 0 } }
    );

    return res.status(200).json({
      revealed_server_seed,
      revealed_hash,
      total_bets_under_seed,
      new_server_seed_hash,
    });
  } catch (err) {
    console.error("Error en /fairness/reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

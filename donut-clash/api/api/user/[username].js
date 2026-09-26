const express = require("express");
const { getUsersCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * GET /api/user/:username
 * Devuelve los datos públicos de un usuario: saldo y estado.
 * (No expone pending_code ni ningún dato sensible.)
 */
app.get("/", async (req, res) => {
  try {
    // Vercel inyecta el parámetro dinámico [username] en req.query.username
    const username = String(req.query.username || "").trim();

    if (!username) {
      return res.status(400).json({ error: "username es requerido." });
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    return res.status(200).json({
      minecraft_username: user.minecraft_username,
      status: user.status,
      balance: user.balance || 0,
    });
  } catch (err) {
    console.error("Error en /user/:username:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

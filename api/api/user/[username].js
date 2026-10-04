const express = require("express");
const { getUsersCollection, getWithdrawalsCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * GET /api/user/:username
 * Devuelve los datos públicos de un usuario: saldo y estado.
 * (No expone pending_code ni ningún dato sensible.)
 */
app.get("*", async (req, res) => {
  try {
    // Según cómo Vercel reenvíe la petición, el username puede venir en
    // req.query.username (convención clásica de rutas dinámicas) o como
    // el último segmento de la ruta completa (ej. "/api/user/steve").
    const pathSegments = req.path.split("/").filter(Boolean);
    const pathUsername = pathSegments[pathSegments.length - 1] || "";
    const username = String(req.query.username || pathUsername || "").trim();

    if (!username) {
      return res.status(400).json({ error: "username es requerido." });
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const withdrawals = await getWithdrawalsCollection();
    const pendingWithdrawal = await withdrawals.findOne({
      minecraft_username: user.minecraft_username,
      status: { $in: ["pending", "in_progress"] },
    });

    return res.status(200).json({
      minecraft_username: user.minecraft_username,
      status: user.status,
      balance: user.balance || 0,
      has_pending_withdrawal: !!pendingWithdrawal,
    });
  } catch (err) {
    console.error("Error en /user/:username:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

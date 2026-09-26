const express = require("express");
const { getUsersCollection } = require("../lib/db");
const { cors } = require("../lib/cors");
const { requireApiKey } = require("../lib/auth");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/deposit-donuts
 * Body: { minecraft_username, amount, api_key }
 * Protegido por api_key (llamado por el bot de Minecraft cuando el
 * jugador deposita donuts reales del servidor a su cuenta web).
 *
 * Añade `amount` al saldo del usuario, que debe estar en estado 'linked'.
 */
app.post("/", requireApiKey, async (req, res) => {
  try {
    const { minecraft_username, amount } = req.body || {};

    if (!minecraft_username || amount === undefined) {
      return res.status(400).json({ error: "minecraft_username y amount son requeridos." });
    }

    const username = String(minecraft_username).trim();
    const depositAmount = Number(amount);

    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "amount debe ser un número positivo." });
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    if (user.status !== "linked") {
      return res.status(400).json({ error: "La cuenta debe estar vinculada antes de depositar donuts." });
    }

    const result = await users.findOneAndUpdate(
      { minecraft_username: username },
      { $inc: { balance: depositAmount }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );

    return res.status(200).json({
      minecraft_username: username,
      balance: result.value.balance,
    });
  } catch (err) {
    console.error("Error en /deposit-donuts:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

const express = require("express");
const { getUsersCollection } = require("../lib/db");
const { cors } = require("../lib/cors");
const { requireApiKey } = require("../lib/auth");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/verify-link
 * Body: { minecraft_username, payment_amount, api_key }
 * Protegido por api_key (debe llamarlo el bot de Minecraft, no el frontend).
 *
 * Verifica que payment_amount coincida con el pending_code del usuario.
 * Si coincide, cambia el estado a 'linked'.
 */
app.post("/", requireApiKey, async (req, res) => {
  try {
    const { minecraft_username, payment_amount } = req.body || {};

    if (!minecraft_username || payment_amount === undefined) {
      return res.status(400).json({ error: "minecraft_username y payment_amount son requeridos." });
    }

    const username = String(minecraft_username).trim();
    const amount = Number(payment_amount);

    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado. Genera un código primero." });
    }

    if (user.status === "linked") {
      return res.status(200).json({ minecraft_username: username, status: "linked", message: "La cuenta ya estaba vinculada." });
    }

    if (user.pending_code !== amount) {
      return res.status(400).json({ error: "El importe no coincide con el código pendiente." });
    }

    await users.updateOne(
      { minecraft_username: username },
      {
        $set: { status: "linked", linked_at: new Date() },
        $unset: { pending_code: "" },
      }
    );

    return res.status(200).json({ minecraft_username: username, status: "linked" });
  } catch (err) {
    console.error("Error en /verify-link:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

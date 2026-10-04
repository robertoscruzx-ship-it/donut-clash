const express = require("express");
const { getUsersCollection, getWithdrawalsCollection } = require("../db");

const router = express.Router();

/**
 * GET /api/user-:username
 * Devuelve los datos públicos de un usuario: saldo y estado.
 * (No expone pending_code ni ningún dato sensible.)
 */
router.get("/user-:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();

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

module.exports = router;

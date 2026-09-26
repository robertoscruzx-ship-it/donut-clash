const express = require("express");
const { ObjectId } = require("mongodb");
const { getUsersCollection, getMinesGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { getUserBySession } = require("../../lib/session");
const { payoutMultiplier } = require("../../lib/mines");
const { HOUSE_EDGE } = require("../../lib/houseEdge");
const { adjustHouseReserve } = require("../../lib/house");
const { logBet } = require("../../lib/betlog");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/mines/cashout
 * Body: { minecraft_username, session_token, game_id }
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token, game_id } = req.body || {};

    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const mines = await getMinesGamesCollection();
    const game = await mines.findOne({ _id: new ObjectId(game_id), minecraft_username, status: "active" });
    if (!game) return res.status(404).json({ error: "No hay una partida activa con ese game_id." });

    if (game.revealed.length === 0) {
      return res.status(400).json({ error: "Revela al menos una casilla antes de retirar." });
    }

    const multiplier = payoutMultiplier(game.revealed.length, game.bombs_count, HOUSE_EDGE);
    const payout = Math.floor(game.bet_amount * multiplier);

    const users = await getUsersCollection();
    await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
    await mines.updateOne({ _id: game._id }, { $set: { status: "cashed_out", payout, ended_at: new Date() } });
    await adjustHouseReserve(-payout);
    await logBet({
      game: "mines",
      minecraft_username,
      bet_amount: game.bet_amount,
      payout,
      won: true,
      forced_loss: false,
    });

    const finalUser = await users.findOne({ minecraft_username });

    return res.status(200).json({
      payout,
      multiplier,
      balance: finalUser.balance,
      bomb_positions: game.bomb_positions,
    });
  } catch (err) {
    console.error("Error en /mines/cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

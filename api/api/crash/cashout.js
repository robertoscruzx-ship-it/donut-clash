const express = require("express");
const { ObjectId } = require("mongodb");
const { getUsersCollection, getCrashGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { getUserBySession } = require("../../lib/session");
const { multiplierAtTime } = require("../../lib/crash");
const { adjustHouseReserve } = require("../../lib/house");
const { logBet } = require("../../lib/betlog");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/crash/cashout
 * Body: { minecraft_username, session_token, game_id }
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token, game_id } = req.body || {};

    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const crashGames = await getCrashGamesCollection();
    const game = await crashGames.findOne({ _id: new ObjectId(game_id), minecraft_username, status: "active" });
    if (!game) return res.status(404).json({ error: "No hay una partida activa con ese game_id." });

    const elapsedSeconds = (Date.now() - game.start_time) / 1000;
    const currentMultiplier = multiplierAtTime(elapsedSeconds);

    const users = await getUsersCollection();

    if (currentMultiplier >= game.crash_point) {
      // Ya había reventado antes de que llegara la petición de retiro.
      await crashGames.updateOne({ _id: game._id }, { $set: { status: "lost", ended_at: new Date() } });
      await logBet({
        game: "crash",
        minecraft_username,
        bet_amount: game.bet_amount,
        payout: 0,
        won: false,
        forced_loss: game.forced_loss,
      });
      return res.status(200).json({
        result: "crashed",
        crash_point: game.crash_point,
      });
    }

    const payout = Math.floor(game.bet_amount * currentMultiplier);
    await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
    await crashGames.updateOne(
      { _id: game._id },
      { $set: { status: "cashed_out", payout, ended_at: new Date() } }
    );
    await adjustHouseReserve(-payout);
    await logBet({
      game: "crash",
      minecraft_username,
      bet_amount: game.bet_amount,
      payout,
      won: true,
      forced_loss: false,
    });

    const finalUser = await users.findOne({ minecraft_username });

    return res.status(200).json({
      result: "cashed_out",
      multiplier: currentMultiplier,
      payout,
      balance: finalUser.balance,
      crash_point: game.crash_point,
    });
  } catch (err) {
    console.error("Error en /crash/cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

const express = require("express");
const { getUsersCollection, getCrashGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { fairFloat } = require("../../lib/fairness");
const { GROWTH_RATE, crashPointFromRoll } = require("../../lib/crash");
const { HOUSE_EDGE, CRASH_MAX_MULTIPLIER } = require("../../lib/houseEdge");
const { evaluateExposure } = require("../../lib/bankroll");
const { adjustHouseReserve } = require("../../lib/house");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/crash/start
 * Body: { minecraft_username, session_token, bet_amount, client_seed }
 *
 * El punto de choque se decide YA (de forma provably-fair) pero se
 * mantiene oculto: el cliente solo recibe el ritmo de crecimiento y la
 * hora de inicio para animar el multiplicador; el backend calcula en
 * /crash/cashout si dio tiempo de retirar antes de que "reventara".
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, client_seed } = req.body || {};
    const bet = Number(bet_amount);

    if (!minecraft_username || !session_token) {
      return res.status(400).json({ error: "Faltan campos requeridos." });
    }
    if (!Number.isFinite(bet) || bet <= 0) {
      return res.status(400).json({ error: "bet_amount inválido." });
    }

    // Peor caso posible: el jugador retira justo en el tope máximo del juego.
    const exposure = await evaluateExposure(bet * CRASH_MAX_MULTIPLIER);

    const users = await getUsersCollection();
    const crashGames = await getCrashGamesCollection();

    const existingActive = await crashGames.findOne({ minecraft_username, status: "active" });
    if (existingActive) {
      return res.status(409).json({ error: "Ya tienes una partida de Crash en curso.", game_id: existingActive._id });
    }

    const deduction = await users.findOneAndUpdate(
      { minecraft_username, session_token, balance: { $gte: bet } },
      { $inc: { balance: -bet, nonce: 1 } },
      { returnDocument: "after" }
    );
    if (!deduction.value) {
      return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    }
    await adjustHouseReserve(bet); // la casa retiene la apuesta mientras la partida está activa

    const user = deduction.value;
    const nonce = user.nonce;
    const roll = fairFloat(user.server_seed, client_seed || "default", nonce);
    // Modo demostrativo: si la apuesta está marcada como forced_loss, el
    // punto de choque se fija en 1.00x (revienta antes de que se pueda
    // retirar). Ver lib/bankroll.js.
    const crash_point = exposure.forcedLoss ? 1.0 : crashPointFromRoll(roll, HOUSE_EDGE, CRASH_MAX_MULTIPLIER);

    const start_time = Date.now();
    const gameDoc = {
      minecraft_username,
      bet_amount: bet,
      crash_point,
      nonce,
      status: "active",
      forced_loss: exposure.forcedLoss,
      start_time,
    };
    const result = await crashGames.insertOne(gameDoc);

    return res.status(200).json({
      game_id: result.insertedId,
      server_seed_hash: user.server_seed_hash,
      growth_rate: GROWTH_RATE,
      start_time,
    });
  } catch (err) {
    console.error("Error en /crash/start:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

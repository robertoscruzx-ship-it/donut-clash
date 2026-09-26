const express = require("express");
const { getUsersCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { fairFloat } = require("../../lib/fairness");
const { HOUSE_EDGE } = require("../../lib/houseEdge");
const { evaluateExposure } = require("../../lib/bankroll");
const { adjustHouseReserve } = require("../../lib/house");
const { logBet } = require("../../lib/betlog");

const app = express();
app.use(express.json());
app.use(cors);

const FAIR_WIN_PROBABILITY = 0.5; // moneda real y honesta, 50/50
const PAYOUT_MULTIPLIER = 2 * (1 - HOUSE_EDGE); // ej. 1.6x con margen del 20%

/**
 * POST /api/bet/coinflip
 * Body: { minecraft_username, session_token, bet_amount, choice, client_seed }
 * choice: "heads" | "tails"
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, choice, client_seed } = req.body || {};

    if (!minecraft_username || !session_token || !choice) {
      return res.status(400).json({ error: "Faltan campos requeridos." });
    }
    if (!["heads", "tails"].includes(choice)) {
      return res.status(400).json({ error: 'choice debe ser "heads" o "tails".' });
    }
    const bet = Number(bet_amount);
    if (!Number.isFinite(bet) || bet <= 0) {
      return res.status(400).json({ error: "bet_amount inválido." });
    }

    const exposure = await evaluateExposure(bet * PAYOUT_MULTIPLIER);

    const users = await getUsersCollection();

    // Descuenta la apuesta de forma atómica solo si hay saldo suficiente
    // Y el session_token es correcto (evita condiciones de carrera y robo de saldo).
    const deduction = await users.findOneAndUpdate(
      { minecraft_username, session_token, balance: { $gte: bet } },
      { $inc: { balance: -bet, nonce: 1 } },
      { returnDocument: "after" }
    );

    if (!deduction.value) {
      return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    }

    await adjustHouseReserve(bet); // la casa retiene la apuesta mientras se resuelve

    const user = deduction.value;
    const nonce = user.nonce;
    const roll = fairFloat(user.server_seed, client_seed || "default", nonce);

    let result, won;
    if (exposure.forcedLoss) {
      // Modo demostrativo: pérdida forzada (ver lib/bankroll.js).
      result = choice === "heads" ? "tails" : "heads";
      won = false;
    } else {
      result = roll < FAIR_WIN_PROBABILITY ? "heads" : "tails";
      won = result === choice;
    }

    let payout = 0;
    if (won) {
      payout = Math.floor(bet * PAYOUT_MULTIPLIER);
      await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
      await adjustHouseReserve(-payout);
    }

    await logBet({ game: "coinflip", minecraft_username, bet_amount: bet, payout, won, forced_loss: exposure.forcedLoss });

    const finalUser = await users.findOne({ minecraft_username });

    return res.status(200).json({
      result,
      won,
      payout,
      balance: finalUser.balance,
      fairness: { server_seed_hash: user.server_seed_hash, nonce, roll },
    });
  } catch (err) {
    console.error("Error en /bet/coinflip:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

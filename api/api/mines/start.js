const express = require("express");
const { getUsersCollection, getMinesGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { seededShuffle } = require("../../lib/fairness");
const { BOARD_SIZE, payoutMultiplier } = require("../../lib/mines");
const { HOUSE_EDGE } = require("../../lib/houseEdge");
const { evaluateExposure } = require("../../lib/bankroll");
const { adjustHouseReserve } = require("../../lib/house");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/mines/start
 * Body: { minecraft_username, session_token, bet_amount, bombs_count, client_seed }
 *
 * Descuenta la apuesta y crea una partida activa con las posiciones de
 * las bombas ya decididas (de forma provably-fair) pero ocultas para el
 * cliente hasta que pisen una o hagan cash out.
 */
app.post("/", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, bombs_count, client_seed } = req.body || {};

    const bet = Number(bet_amount);
    const bombs = Number(bombs_count);

    if (!minecraft_username || !session_token) {
      return res.status(400).json({ error: "Faltan campos requeridos." });
    }
    if (!Number.isFinite(bet) || bet <= 0) {
      return res.status(400).json({ error: "bet_amount inválido." });
    }
    if (!Number.isInteger(bombs) || bombs < 1 || bombs > BOARD_SIZE - 1) {
      return res.status(400).json({ error: `bombs_count debe ser un entero entre 1 y ${BOARD_SIZE - 1}.` });
    }

    // Peor caso posible: el jugador revela todas las casillas seguras.
    const safeTilesTotal = BOARD_SIZE - bombs;
    const maxMultiplier = payoutMultiplier(safeTilesTotal, bombs, HOUSE_EDGE);
    const exposure = await evaluateExposure(bet * maxMultiplier);

    const users = await getUsersCollection();
    const mines = await getMinesGamesCollection();

    const existingActive = await mines.findOne({ minecraft_username, status: "active" });
    if (existingActive) {
      return res.status(409).json({ error: "Ya tienes una partida de Mines en curso.", game_id: existingActive._id });
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
    const shuffled = seededShuffle(user.server_seed, client_seed || "default", nonce, BOARD_SIZE);
    const bomb_positions = shuffled.slice(0, bombs).sort((a, b) => a - b);

    const gameDoc = {
      minecraft_username,
      bet_amount: bet,
      bombs_count: bombs,
      bomb_positions,
      revealed: [],
      nonce,
      status: "active",
      forced_loss: exposure.forcedLoss,
      created_at: new Date(),
    };
    const result = await mines.insertOne(gameDoc);

    return res.status(200).json({
      game_id: result.insertedId,
      board_size: BOARD_SIZE,
      bombs_count: bombs,
      server_seed_hash: user.server_seed_hash,
    });
  } catch (err) {
    console.error("Error en /mines/start:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

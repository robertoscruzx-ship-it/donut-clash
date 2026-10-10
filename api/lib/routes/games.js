const express = require("express");
const { ObjectId } = require("mongodb");
const { getUsersCollection, getMinesGamesCollection } = require("../db");
const { getUserBySession } = require("../session");
const { fairFloat, seededShuffle } = require("../fairness");
const { HOUSE_EDGE } = require("../houseEdge");
const { evaluateExposure } = require("../bankroll");
const { adjustHouseReserve } = require("../house");
const { logBet } = require("../betlog");
const { xpForBet } = require("../xp");
const { BOARD_SIZE, payoutMultiplier } = require("../mines");
const {
  getCurrentRound,
  joinCurrentRound,
  cashoutCurrentRound,
  getRecentCrashHistory,
  toPublicRound,
} = require("../crashRound");

const router = express.Router();

// Coinflip: paga 1.85x y el jugador gana el 35% de las veces (la casa 65%).
// Valor esperado del jugador = 0.35 * 1.85 = 0.6475 por donut apostado.
const COINFLIP_WIN_PROBABILITY = 0.35;
const COINFLIP_PAYOUT_MULTIPLIER = 1.85;

/**
 * POST /api/games-bet-coinflip
 * Body: { minecraft_username, session_token, bet_amount, choice, client_seed }
 */
router.post("/games-bet-coinflip", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, choice, client_seed } = req.body || {};
    if (!minecraft_username || !session_token || !choice) {
      return res.status(400).json({ error: "Faltan campos requeridos." });
    }
    if (!["heads", "tails"].includes(choice)) {
      return res.status(400).json({ error: 'choice debe ser "heads" o "tails".' });
    }
    const bet = Number(bet_amount);
    if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: "bet_amount inválido." });

    const exposure = await evaluateExposure(bet * COINFLIP_PAYOUT_MULTIPLIER);
    const users = await getUsersCollection();
    const deduction = await users.findOneAndUpdate(
      { minecraft_username, session_token, balance: { $gte: bet } },
      { $inc: { balance: -bet, nonce: 1, xp: xpForBet(bet) } },
      { returnDocument: "after" }
    );
    if (!deduction) return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    await adjustHouseReserve(bet);

    const user = deduction;
    const nonce = user.nonce;
    const roll = fairFloat(user.server_seed, client_seed || "default", nonce);

    // roll < 0.35 => cae el lado que eligió el jugador; si no, el contrario.
    // La tirada sigue saliendo de fairFloat (verificable con la semilla).
    const opposite = choice === "heads" ? "tails" : "heads";
    let result, won;
    if (exposure.forcedLoss) {
      result = opposite;
      won = false;
    } else {
      won = roll < COINFLIP_WIN_PROBABILITY;
      result = won ? choice : opposite;
    }

    let payout = 0;
    if (won) {
      payout = Math.floor(bet * COINFLIP_PAYOUT_MULTIPLIER);
      await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
      await adjustHouseReserve(-payout);
    }
    await logBet({ game: "coinflip", minecraft_username, bet_amount: bet, payout, won, forced_loss: exposure.forcedLoss });

    const finalUser = await users.findOne({ minecraft_username });
    return res.status(200).json({
      result, won, payout, balance: finalUser.balance,
      fairness: { server_seed_hash: user.server_seed_hash, nonce, roll },
    });
  } catch (err) {
    console.error("Error en /games-bet-coinflip:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-mines-start
 * Body: { minecraft_username, session_token, bet_amount, bombs_count, client_seed }
 */
router.post("/games-mines-start", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, bombs_count, client_seed } = req.body || {};
    const bet = Number(bet_amount);
    const bombs = Number(bombs_count);
    if (!minecraft_username || !session_token) return res.status(400).json({ error: "Faltan campos requeridos." });
    if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: "bet_amount inválido." });
    if (!Number.isInteger(bombs) || bombs < 1 || bombs > BOARD_SIZE - 1) {
      return res.status(400).json({ error: `bombs_count debe ser un entero entre 1 y ${BOARD_SIZE - 1}.` });
    }

    const safeTilesTotal = BOARD_SIZE - bombs;
    const maxMultiplier = payoutMultiplier(safeTilesTotal, bombs, HOUSE_EDGE);
    const exposure = await evaluateExposure(bet * maxMultiplier);

    const users = await getUsersCollection();
    const mines = await getMinesGamesCollection();
    const existingActive = await mines.findOne({ minecraft_username, status: "active" });
    if (existingActive) return res.status(409).json({ error: "Ya tienes una partida de Mines en curso.", game_id: existingActive._id });

    const deduction = await users.findOneAndUpdate(
      { minecraft_username, session_token, balance: { $gte: bet } },
      { $inc: { balance: -bet, nonce: 1, xp: xpForBet(bet) } },
      { returnDocument: "after" }
    );
    if (!deduction) return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    await adjustHouseReserve(bet);

    const user = deduction;
    const nonce = user.nonce;
    const shuffled = seededShuffle(user.server_seed, client_seed || "default", nonce, BOARD_SIZE);
    const bomb_positions = shuffled.slice(0, bombs).sort((a, b) => a - b);

    const gameDoc = {
      minecraft_username, bet_amount: bet, bombs_count: bombs, bomb_positions,
      revealed: [], nonce, status: "active", forced_loss: exposure.forcedLoss, created_at: new Date(),
    };
    const result = await mines.insertOne(gameDoc);

    return res.status(200).json({
      game_id: result.insertedId, board_size: BOARD_SIZE, bombs_count: bombs, server_seed_hash: user.server_seed_hash,
    });
  } catch (err) {
    console.error("Error en /games-mines-start:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-mines-reveal
 * Body: { minecraft_username, session_token, game_id, tile_index }
 */
router.post("/games-mines-reveal", async (req, res) => {
  try {
    const { minecraft_username, session_token, game_id, tile_index } = req.body || {};
    const tile = Number(tile_index);
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });
    if (!Number.isInteger(tile) || tile < 0 || tile >= BOARD_SIZE) {
      return res.status(400).json({ error: "tile_index inválido." });
    }

    const mines = await getMinesGamesCollection();
    const game = await mines.findOne({ _id: new ObjectId(game_id), minecraft_username, status: "active" });
    if (!game) return res.status(404).json({ error: "No hay una partida activa con ese game_id." });
    if (game.revealed.includes(tile)) return res.status(400).json({ error: "Esa casilla ya fue revelada." });

    const isBomb = game.forced_loss ? true : game.bomb_positions.includes(tile);
    if (isBomb) {
      await mines.updateOne({ _id: game._id }, { $set: { status: "lost", ended_at: new Date() } });
      await logBet({ game: "mines", minecraft_username, bet_amount: game.bet_amount, payout: 0, won: false, forced_loss: game.forced_loss });
      return res.status(200).json({ result: "bomb", game_over: true, bomb_positions: game.bomb_positions });
    }

    const revealed = [...game.revealed, tile];
    const safeTilesTotal = BOARD_SIZE - game.bombs_count;
    const boardFullyCleared = revealed.length === safeTilesTotal;
    const current_multiplier = payoutMultiplier(revealed.length, game.bombs_count, HOUSE_EDGE);
    await mines.updateOne({ _id: game._id }, { $set: { revealed } });

    return res.status(200).json({ result: "safe", revealed_count: revealed.length, current_multiplier, board_fully_cleared: boardFullyCleared });
  } catch (err) {
    console.error("Error en /games-mines-reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-mines-cashout
 * Body: { minecraft_username, session_token, game_id }
 */
router.post("/games-mines-cashout", async (req, res) => {
  try {
    const { minecraft_username, session_token, game_id } = req.body || {};
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const mines = await getMinesGamesCollection();
    const game = await mines.findOne({ _id: new ObjectId(game_id), minecraft_username, status: "active" });
    if (!game) return res.status(404).json({ error: "No hay una partida activa con ese game_id." });
    if (game.revealed.length === 0) return res.status(400).json({ error: "Revela al menos una casilla antes de retirar." });

    const multiplier = payoutMultiplier(game.revealed.length, game.bombs_count, HOUSE_EDGE);
    const payout = Math.floor(game.bet_amount * multiplier);

    const users = await getUsersCollection();
    await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
    await mines.updateOne({ _id: game._id }, { $set: { status: "cashed_out", payout, ended_at: new Date() } });
    await adjustHouseReserve(-payout);
    await logBet({ game: "mines", minecraft_username, bet_amount: game.bet_amount, payout, won: true, forced_loss: false });

    const finalUser = await users.findOne({ minecraft_username });
    return res.status(200).json({ payout, multiplier, balance: finalUser.balance, bomb_positions: game.bomb_positions });
  } catch (err) {
    console.error("Error en /games-mines-cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-crash-state
 * Body: { minecraft_username? , session_token? } (ambos opcionales — solo
 * para incluir "my_bet" si el que consulta ya apostó en la ronda actual)
 *
 * Devuelve el estado actual de la ronda GLOBAL de Crash (compartida por
 * todos los jugadores) y el historial de las últimas 10 rondas. El
 * frontend debe llamar esto en un intervalo corto (ej. cada 1s) para
 * mantenerse sincronizado — ver el comentario de diseño al inicio de
 * crashRound.js.
 */
router.post("/games-crash-state", async (req, res) => {
  try {
    const { minecraft_username } = req.body || {};
    const round = await getCurrentRound();
    const history = await getRecentCrashHistory(20);
    return res.status(200).json({ ...toPublicRound(round, minecraft_username), history });
  } catch (err) {
    console.error("Error en /games-crash-state:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-crash-join
 * Body: { minecraft_username, session_token, bet_amount }
 * Apuesta en la ventana de 10s de la ronda actual (solo mientras está en
 * estado "betting" — una sola apuesta por jugador por ronda).
 */
router.post("/games-crash-join", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount } = req.body || {};
    const bet = Number(bet_amount);
    if (!minecraft_username || !session_token) return res.status(400).json({ error: "Faltan campos requeridos." });
    if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: "bet_amount inválido." });

    const round = await joinCurrentRound(minecraft_username, session_token, bet);
    const history = await getRecentCrashHistory(20);
    return res.status(200).json({ ...toPublicRound(round, minecraft_username), history });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Error en /games-crash-join:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games-crash-cashout
 * Body: { minecraft_username, session_token }
 * Retira la apuesta propia de la ronda en curso al multiplicador actual
 * (solo mientras la ronda está en estado "running" y no ha explotado).
 */
router.post("/games-crash-cashout", async (req, res) => {
  try {
    const { minecraft_username, session_token } = req.body || {};
    if (!minecraft_username || !session_token) return res.status(400).json({ error: "Faltan campos requeridos." });

    const result = await cashoutCurrentRound(minecraft_username, session_token);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("Error en /games-crash-cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;

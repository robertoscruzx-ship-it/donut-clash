const express = require("express");
const { ObjectId } = require("mongodb");
const { getUsersCollection, getMinesGamesCollection, getCrashGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { getUserBySession } = require("../../lib/session");
const { fairFloat, seededShuffle } = require("../../lib/fairness");
const { HOUSE_EDGE, CRASH_MAX_MULTIPLIER } = require("../../lib/houseEdge");
const { evaluateExposure } = require("../../lib/bankroll");
const { adjustHouseReserve } = require("../../lib/house");
const { logBet } = require("../../lib/betlog");
const { BOARD_SIZE, payoutMultiplier } = require("../../lib/mines");
const { GROWTH_RATE, crashPointFromRoll, multiplierAtTime } = require("../../lib/crash");

const app = express();

// Catch-all: agrupa Coinflip, Mines y Crash en UNA sola función de Vercel
// (igual que account/[...path].js) para no pasarnos del límite de 12
// funciones del plan gratuito.
app.use((req, res, next) => {
  req.url = req.url.replace(/^\/api\/games/, "") || "/";
  next();
});
app.use(express.json());
app.use(cors);

const FAIR_WIN_PROBABILITY = 0.5;
const COINFLIP_PAYOUT_MULTIPLIER = 2 * (1 - HOUSE_EDGE);

/**
 * POST /api/games/bet/coinflip
 * Body: { minecraft_username, session_token, bet_amount, choice, client_seed }
 */
app.post("/bet/coinflip", async (req, res) => {
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
      { $inc: { balance: -bet, nonce: 1 } },
      { returnDocument: "after" }
    );
    if (!deduction.value) return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    await adjustHouseReserve(bet);

    const user = deduction.value;
    const nonce = user.nonce;
    const roll = fairFloat(user.server_seed, client_seed || "default", nonce);

    let result, won;
    if (exposure.forcedLoss) {
      result = choice === "heads" ? "tails" : "heads";
      won = false;
    } else {
      result = roll < FAIR_WIN_PROBABILITY ? "heads" : "tails";
      won = result === choice;
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
    console.error("Error en /games/bet/coinflip:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games/mines/start
 * Body: { minecraft_username, session_token, bet_amount, bombs_count, client_seed }
 */
app.post("/mines/start", async (req, res) => {
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
      { $inc: { balance: -bet, nonce: 1 } },
      { returnDocument: "after" }
    );
    if (!deduction.value) return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    await adjustHouseReserve(bet);

    const user = deduction.value;
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
    console.error("Error en /games/mines/start:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games/mines/reveal
 * Body: { minecraft_username, session_token, game_id, tile_index }
 */
app.post("/mines/reveal", async (req, res) => {
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
    console.error("Error en /games/mines/reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games/mines/cashout
 * Body: { minecraft_username, session_token, game_id }
 */
app.post("/mines/cashout", async (req, res) => {
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
    console.error("Error en /games/mines/cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games/crash/start
 * Body: { minecraft_username, session_token, bet_amount, client_seed }
 */
app.post("/crash/start", async (req, res) => {
  try {
    const { minecraft_username, session_token, bet_amount, client_seed } = req.body || {};
    const bet = Number(bet_amount);
    if (!minecraft_username || !session_token) return res.status(400).json({ error: "Faltan campos requeridos." });
    if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: "bet_amount inválido." });

    const exposure = await evaluateExposure(bet * CRASH_MAX_MULTIPLIER);
    const users = await getUsersCollection();
    const crashGames = await getCrashGamesCollection();
    const existingActive = await crashGames.findOne({ minecraft_username, status: "active" });
    if (existingActive) return res.status(409).json({ error: "Ya tienes una partida de Crash en curso.", game_id: existingActive._id });

    const deduction = await users.findOneAndUpdate(
      { minecraft_username, session_token, balance: { $gte: bet } },
      { $inc: { balance: -bet, nonce: 1 } },
      { returnDocument: "after" }
    );
    if (!deduction.value) return res.status(400).json({ error: "Sesión inválida o saldo insuficiente." });
    await adjustHouseReserve(bet);

    const user = deduction.value;
    const nonce = user.nonce;
    const roll = fairFloat(user.server_seed, client_seed || "default", nonce);
    const crash_point = exposure.forcedLoss ? 1.0 : crashPointFromRoll(roll, HOUSE_EDGE, CRASH_MAX_MULTIPLIER);

    const start_time = Date.now();
    const gameDoc = {
      minecraft_username, bet_amount: bet, crash_point, nonce,
      status: "active", forced_loss: exposure.forcedLoss, start_time,
    };
    const result = await crashGames.insertOne(gameDoc);

    return res.status(200).json({
      game_id: result.insertedId, server_seed_hash: user.server_seed_hash, growth_rate: GROWTH_RATE, start_time,
    });
  } catch (err) {
    console.error("Error en /games/crash/start:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/games/crash/cashout
 * Body: { minecraft_username, session_token, game_id }
 */
app.post("/crash/cashout", async (req, res) => {
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
      await crashGames.updateOne({ _id: game._id }, { $set: { status: "lost", ended_at: new Date() } });
      await logBet({ game: "crash", minecraft_username, bet_amount: game.bet_amount, payout: 0, won: false, forced_loss: game.forced_loss });
      return res.status(200).json({ result: "crashed", crash_point: game.crash_point });
    }

    const payout = Math.floor(game.bet_amount * currentMultiplier);
    await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
    await crashGames.updateOne({ _id: game._id }, { $set: { status: "cashed_out", payout, ended_at: new Date() } });
    await adjustHouseReserve(-payout);
    await logBet({ game: "crash", minecraft_username, bet_amount: game.bet_amount, payout, won: true, forced_loss: false });

    const finalUser = await users.findOne({ minecraft_username });
    return res.status(200).json({
      result: "cashed_out", multiplier: currentMultiplier, payout, balance: finalUser.balance, crash_point: game.crash_point,
    });
  } catch (err) {
    console.error("Error en /games/crash/cashout:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

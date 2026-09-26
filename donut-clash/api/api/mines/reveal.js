const express = require("express");
const { ObjectId } = require("mongodb");
const { getMinesGamesCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { getUserBySession } = require("../../lib/session");
const { BOARD_SIZE, payoutMultiplier } = require("../../lib/mines");
const { HOUSE_EDGE } = require("../../lib/houseEdge");
const { logBet } = require("../../lib/betlog");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/mines/reveal
 * Body: { minecraft_username, session_token, game_id, tile_index }
 */
app.post("/", async (req, res) => {
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

    if (game.revealed.includes(tile)) {
      return res.status(400).json({ error: "Esa casilla ya fue revelada." });
    }

    const isBomb = game.forced_loss ? true : game.bomb_positions.includes(tile);

    if (isBomb) {
      await mines.updateOne({ _id: game._id }, { $set: { status: "lost", ended_at: new Date() } });
      await logBet({
        game: "mines",
        minecraft_username,
        bet_amount: game.bet_amount,
        payout: 0,
        won: false,
        forced_loss: game.forced_loss,
      });
      return res.status(200).json({
        result: "bomb",
        game_over: true,
        bomb_positions: game.bomb_positions,
      });
    }

    const revealed = [...game.revealed, tile];
    const safeTilesTotal = BOARD_SIZE - game.bombs_count;
    const boardFullyCleared = revealed.length === safeTilesTotal;
    const current_multiplier = payoutMultiplier(revealed.length, game.bombs_count, HOUSE_EDGE);

    await mines.updateOne({ _id: game._id }, { $set: { revealed } });

    return res.status(200).json({
      result: "safe",
      revealed_count: revealed.length,
      current_multiplier,
      board_fully_cleared: boardFullyCleared,
    });
  } catch (err) {
    console.error("Error en /mines/reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

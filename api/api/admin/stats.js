const express = require("express");
const { getBetsCollection } = require("../../lib/db");
const { getHouseReserve } = require("../../lib/house");
const { cors } = require("../../lib/cors");
const { requireApiKey } = require("../../lib/auth");

const app = express();
app.use(express.json());
app.use(cors);

/**
 * POST /api/admin/stats
 * Body: { api_key }
 *
 * Endpoint oculto (no está enlazado desde el frontend ni documentado ahí).
 * Solo accesible con tu API_KEY, pensado para el presentador: llama a esto
 * al final de la demostración para mostrar los números reales de la
 * sesión (total apostado, pagado, margen real, cuántas fueron pérdida
 * forzada, etc.).
 */
app.post("/", requireApiKey, async (req, res) => {
  try {
    const bets = await getBetsCollection();

    const pipeline = [
      {
        $group: {
          _id: "$game",
          total_bets: { $sum: 1 },
          total_wagered: { $sum: "$bet_amount" },
          total_paid_out: { $sum: "$payout" },
          wins: { $sum: { $cond: ["$won", 1, 0] } },
          losses: { $sum: { $cond: ["$won", 0, 1] } },
          forced_losses: { $sum: { $cond: ["$forced_loss", 1, 0] } },
        },
      },
    ];

    const perGame = await bets.aggregate(pipeline).toArray();

    const totals = perGame.reduce(
      (acc, g) => {
        acc.total_bets += g.total_bets;
        acc.total_wagered += g.total_wagered;
        acc.total_paid_out += g.total_paid_out;
        acc.wins += g.wins;
        acc.losses += g.losses;
        acc.forced_losses += g.forced_losses;
        return acc;
      },
      { total_bets: 0, total_wagered: 0, total_paid_out: 0, wins: 0, losses: 0, forced_losses: 0 }
    );

    const house_profit = totals.total_wagered - totals.total_paid_out;
    const observed_house_edge =
      totals.total_wagered > 0 ? house_profit / totals.total_wagered : 0;

    const house_reserve = await getHouseReserve();

    return res.status(200).json({
      per_game: perGame,
      totals: {
        ...totals,
        house_profit,
        observed_house_edge, // ej. 0.20 = la casa se quedó con el 20% de lo apostado
        win_rate: totals.total_bets > 0 ? totals.wins / totals.total_bets : 0,
        forced_loss_rate: totals.total_bets > 0 ? totals.forced_losses / totals.total_bets : 0,
      },
      house_reserve,
    });
  } catch (err) {
    console.error("Error en /admin/stats:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

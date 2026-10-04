const express = require("express");
const { getBetsCollection } = require("../db");
const { getHouseReserve, getBotRealBalance } = require("../house");
const { getCirculatingDonuts } = require("../bankroll");
const { MAX_EXPOSURE_FRACTION } = require("../houseEdge");
const { requireAdminPanelAuth } = require("../auth");

const router = express.Router();

/**
 * POST /api/admin-stats
 * Body: { admin_password }
 *
 * Endpoint oculto (no está enlazado desde el frontend ni documentado ahí).
 * Protegido por ADMIN_PANEL_PASSWORD (distinta de la API_KEY real), pensado
 * para el presentador: llama a esto al final de la demostración para
 * mostrar los números reales de la sesión (total apostado, pagado, margen
 * real, cuántas fueron pérdida forzada, etc.).
 */
router.post("/admin-stats", requireAdminPanelAuth, async (req, res) => {
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
    const circulating_donuts = await getCirculatingDonuts();
    const botStatus = await getBotRealBalance();

    return res.status(200).json({
      per_game: perGame,
      totals: {
        ...totals,
        house_profit,
        observed_house_edge,
        win_rate: totals.total_bets > 0 ? totals.wins / totals.total_bets : 0,
        forced_loss_rate: totals.total_bets > 0 ? totals.forced_losses / totals.total_bets : 0,
      },
      // Las tres variables de reserva del diseño original (ver bankroll.js):
      reserves: {
        house_reserve_stats_only: house_reserve,
        circulating_donuts_stats_only: circulating_donuts,
        bot_real_balance: botStatus ? botStatus.balance : null,
        bot_real_balance_reported_at: botStatus ? botStatus.reported_at : null,
        max_exposure_fraction: MAX_EXPOSURE_FRACTION,
        exposure_limit: botStatus ? botStatus.balance * MAX_EXPOSURE_FRACTION : null,
        exposure_ratio: botStatus && botStatus.balance > 0 ? circulating_donuts / botStatus.balance : null,
      },
      house_reserve, // se deja también en la raíz por compatibilidad con el frontend existente
    });
  } catch (err) {
    console.error("Error en /admin/stats:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;

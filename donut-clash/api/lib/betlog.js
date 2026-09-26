const { getBetsCollection } = require("./db");

/**
 * Registra una apuesta ya resuelta (de cualquiera de los 3 juegos) para
 * poder calcular estadísticas agregadas más tarde (ver /api/admin/stats).
 */
async function logBet({ game, minecraft_username, bet_amount, payout, won, forced_loss }) {
  const bets = await getBetsCollection();
  await bets.insertOne({
    game,
    minecraft_username,
    bet_amount,
    payout,
    won,
    forced_loss: !!forced_loss,
    created_at: new Date(),
  });
}

module.exports = { logBet };

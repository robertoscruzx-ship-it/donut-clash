const { getUsersCollection } = require("./db");
const { getBotRealBalance } = require("./house");
const { MAX_EXPOSURE_FRACTION } = require("./houseEdge");

/**
 * ============================================================
 * MODO DEMOSTRATIVO / EDUCATIVO — Donut Royale
 * ============================================================
 * Este proyecto se usa como material para una charla/presentación sobre
 * cómo funcionan (y se pueden manipular) los juegos de azar. La moneda
 * "donuts" no tiene valor real ni se canjea por dinero ni por nada de
 * valor. El mecanismo de esta función está pensado para revelarse a los
 * participantes al final de la demostración como el punto pedagógico
 * central — no para usarse en un producto real donde alguien arriesgue
 * algo de valor sin saberlo.
 *
 * TRES VARIABLES DE RESERVA (diseño acordado):
 *   1. house.reserve  — se mueve con cada apuesta (gana/pierde la casa).
 *      Solo para estadísticas (panel admin), no decide nada aquí.
 *   2. circulating     — suma de TODOS los balances de jugadores en la
 *      base de datos (cuántos donuts hay "repartidos" en este momento).
 *      Solo para estadísticas/verificación cruzada.
 *   3. botRealBalance  — el saldo REAL del bot en el juego, que el bot
 *      mismo reporta cada ~15 min leyendo su propio /balance. Esta es la
 *      ÚNICA variable que decide algo: si lo que hay repartido entre
 *      jugadores (más lo que esta apuesta podría repartir) supera el
 *      MAX_EXPOSURE_FRACTION (75%) del saldo real del bot, la apuesta se
 *      marca como forcedLoss — es decir, los donuts "impresos" para los
 *      jugadores ya no estarían respaldados por lo que el bot puede
 *      realmente pagar si todos quisieran retirar.
 *
 * Si el bot todavía no ha reportado su saldo ninguna vez (botRealBalance
 * === null, por ejemplo recién arrancado), no se fuerza nada por este
 * mecanismo — se deja jugar normalmente hasta que llegue el primer
 * reporte, en vez de bloquear todo el sitio por falta de un dato que
 * llega solo. En un sistema real esto se trataría distinto (modo
 * seguro), pero aquí no hay dinero real en juego.
 */
async function getCirculatingDonuts() {
  const users = await getUsersCollection();
  const result = await users
    .aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }])
    .toArray();
  return result.length ? result[0].total : 0;
}

async function evaluateExposure(maxPossiblePayout) {
  const circulating = await getCirculatingDonuts();
  const botStatus = await getBotRealBalance();
  const botRealBalance = botStatus ? botStatus.balance : null;

  if (botRealBalance === null) {
    return { forcedLoss: false, circulating, botRealBalance: null, limit: null, reason: "sin_reporte_del_bot" };
  }

  const limit = botRealBalance * MAX_EXPOSURE_FRACTION;
  const projected = circulating + maxPossiblePayout;
  const forcedLoss = projected > limit;

  return { forcedLoss, circulating, botRealBalance, limit, projected };
}

module.exports = { evaluateExposure, getCirculatingDonuts };

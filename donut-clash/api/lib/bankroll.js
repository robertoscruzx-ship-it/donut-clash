const { getHouseReserve } = require("./house");
const { MAX_EXPOSURE_FRACTION } = require("./houseEdge");

/**
 * ============================================================
 * MODO DEMOSTRATIVO / EDUCATIVO — Donut Clash
 * ============================================================
 * Este proyecto se usa como material para una charla/presentación sobre
 * cómo funcionan (y se pueden manipular) los juegos de azar. La moneda
 * "donuts" no tiene valor real ni se canjea por dinero ni por nada de
 * valor. El mecanismo de esta función está pensado para revelarse a los
 * participantes al final de la demostración como el punto pedagógico
 * central — no para usarse en un producto real donde alguien arriesgue
 * algo de valor sin saberlo.
 *
 * evaluateExposure() NO limita ni rechaza apuestas. En vez de eso, si la
 * ganancia máxima posible de la apuesta supera el porcentaje configurado
 * (MAX_EXPOSURE_FRACTION) de la reserva actual de la casa, marca la
 * apuesta como forcedLoss: true. Los endpoints de cada juego usan esa
 * bandera para decidir el resultado directamente como pérdida, sin pasar
 * por el generador aleatorio.
 */
async function evaluateExposure(maxPossiblePayout) {
  const reserve = await getHouseReserve();
  const limit = reserve * MAX_EXPOSURE_FRACTION;
  const forcedLoss = maxPossiblePayout > limit;
  return { forcedLoss, reserve, limit };
}

module.exports = { evaluateExposure };

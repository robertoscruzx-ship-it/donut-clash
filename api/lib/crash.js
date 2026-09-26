// Tasa de crecimiento del multiplicador: multiplier(t) = e^(GROWTH_RATE * t)
// con t en segundos. Con 0.07, se llega a 2x en ~9.9s, a 5x en ~23s, etc.
const GROWTH_RATE = 0.07;

// Genera el punto de choque usando la fórmula estándar de juegos "crash"
// con margen de casa incorporado matemáticamente (no es un valor fijo,
// sigue siendo una distribución real de probabilidad):
//   si roll < houseEdge  -> revienta instantáneamente en 1.00x
//   si no                -> crashPoint = floor( (1-houseEdge) / (1-roll) * 100 ) / 100
// El resultado se limita a maxMultiplier: sin este tope, el multiplicador
// podría crecer sin límite y una sola partida ganadora podría reclamar un
// pago imposible de cubrir (los juegos crash reales también topan esto).
function crashPointFromRoll(roll, houseEdge, maxMultiplier) {
  if (roll < houseEdge) return 1.0;
  const point = Math.floor(((1 - houseEdge) / (1 - roll)) * 100) / 100;
  return Math.min(maxMultiplier, Math.max(1.0, point));
}

function multiplierAtTime(elapsedSeconds) {
  return Math.exp(GROWTH_RATE * elapsedSeconds);
}

module.exports = { GROWTH_RATE, crashPointFromRoll, multiplierAtTime };

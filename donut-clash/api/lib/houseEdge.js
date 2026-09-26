// Margen de la casa (RTP = Return To Player = 1 - HOUSE_EDGE).
// 0.20 = 20% de margen para la casa (equivalente en valor esperado a la
// proporción "60/40" que pediste). El margen se aplica reduciendo el
// multiplicador de pago, NO amañando las probabilidades reales del juego:
// el volado sigue siendo 50/50 real, las bombas de Mines están realmente
// distribuidas al azar, y el punto de choque de Crash sigue una
// distribución matemáticamente justa.
const HOUSE_EDGE = 0.20;

// Tope duro al multiplicador de Crash. Sin esto, el multiplicador podría
// crecer sin límite y una sola partida ganadora podría reclamar un pago
// imposible de cubrir. Los juegos "crash" reales (Stake, BC.Game, etc.)
// también usan un tope máximo por esta misma razón.
const CRASH_MAX_MULTIPLIER = 100;

// Qué fracción de la reserva actual de la casa se arriesga como máximo en
// una sola apuesta (considerando el peor resultado posible: el jugador
// gana el máximo pago teórico de esa apuesta). Con 0.75, la casa nunca
// ACEPTA una apuesta cuyo pago máximo posible supere el 75% de su reserva
// actual — la rechaza antes de jugarla, con un mensaje claro. No es un
// límite fijo: sube solo a medida que la reserva de la casa crece, y
// nunca se manipula un resultado ya en curso.
const MAX_EXPOSURE_FRACTION = 0.75;

module.exports = { HOUSE_EDGE, CRASH_MAX_MULTIPLIER, MAX_EXPOSURE_FRACTION };

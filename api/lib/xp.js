/**
 * Sistema de experiencia (XP) / nivel de cuenta.
 *
 * Puramente cosmético: no afecta al juego, el house edge ni las
 * variables de reserva — es solo progresión visual en el perfil del
 * jugador. Cada apuesta (se gane o se pierda) otorga XP en función del
 * monto apostado, con rendimientos decrecientes (escala logarítmica) para
 * que una sola apuesta gigante no suba de nivel instantáneamente.
 */

// XP que otorga una apuesta de `betAmount` donuts.
function xpForBet(betAmount) {
  const amt = Math.max(0, Number(betAmount) || 0);
  const raw = Math.log10(amt + 10) * 3;
  return Math.round(raw * 100) / 100;
}

// XP total necesaria para subir del nivel `level` al `level + 1`.
function xpForNextLevel(level) {
  return Math.round(40 + Math.max(1, level) * 12);
}

// Convierte el XP acumulado total en { level, xp_into_level, xp_for_next_level }.
function levelInfo(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Number(totalXp) || 0);
  let threshold = xpForNextLevel(level);
  while (remaining >= threshold) {
    remaining -= threshold;
    level += 1;
    threshold = xpForNextLevel(level);
  }
  return {
    level,
    xp_into_level: Math.round(remaining * 100) / 100,
    xp_for_next_level: threshold,
  };
}

module.exports = { xpForBet, xpForNextLevel, levelInfo };

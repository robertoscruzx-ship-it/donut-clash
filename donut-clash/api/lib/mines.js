const BOARD_SIZE = 25;

// Multiplicador JUSTO (sin margen) tras revelar `r` casillas seguras,
// dado `k` bombas en un tablero de `total` casillas:
// fair_multiplier(r) = C(total, r) / C(total - k, r)
// Se calcula de forma incremental para evitar overflow con factoriales grandes.
function fairMultiplier(revealedCount, bombsCount, total = BOARD_SIZE) {
  let multiplier = 1;
  for (let i = 0; i < revealedCount; i++) {
    multiplier *= (total - i) / (total - i - bombsCount);
  }
  return multiplier;
}

function payoutMultiplier(revealedCount, bombsCount, houseEdge, total = BOARD_SIZE) {
  return fairMultiplier(revealedCount, bombsCount, total) * (1 - houseEdge);
}

module.exports = { BOARD_SIZE, fairMultiplier, payoutMultiplier };

const crypto = require("crypto");

// Genera un server_seed aleatorio (32 bytes -> 64 chars hex).
function randomServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

// Hash público del server_seed. Se muestra al jugador ANTES de apostar
// (compromiso/commitment); el server_seed real solo se revela después,
// cuando el jugador rota de seed, permitiendo verificar que no cambió
// a mitad de partida.
function hashServerSeed(serverSeed) {
  return crypto.createHash("sha256").update(serverSeed).digest("hex");
}

// Float determinista en [0, 1) a partir de server_seed + client_seed + nonce.
// Cualquiera puede recalcular este mismo valor si conoce los tres datos,
// lo que permite verificar que el resultado no fue manipulado.
function fairFloat(serverSeed, clientSeed, nonce) {
  const hmac = crypto
    .createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest("hex");
  const intVal = parseInt(hmac.slice(0, 13), 16); // 52 bits de precisión
  const maxVal = Math.pow(2, 52);
  return intVal / maxVal;
}

// Baraja (Fisher-Yates determinista) para elegir posiciones de bombas en Mines.
function seededShuffle(serverSeed, clientSeed, nonce, length) {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const f = fairFloat(serverSeed, clientSeed, `${nonce}:${i}`);
    const j = Math.floor(f * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

module.exports = { randomServerSeed, hashServerSeed, fairFloat, seededShuffle };

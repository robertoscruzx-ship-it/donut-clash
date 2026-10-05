const { getHouseCollection } = require("./db");

const HOUSE_DOC_ID = "main";

async function ensureHouseDoc(initialReserve = 0) {
  const house = await getHouseCollection();
  await house.updateOne(
    { _id: HOUSE_DOC_ID },
    { $setOnInsert: { reserve: initialReserve } },
    { upsert: true }
  );
}

async function getHouseReserve() {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  const doc = await house.findOne({ _id: HOUSE_DOC_ID });
  return doc ? doc.reserve : 0;
}

// Suma (o resta, con delta negativo) a la reserva de la casa de forma atómica.
async function adjustHouseReserve(delta) {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  // mongodb v6: findOneAndUpdate devuelve el documento directamente (ya no
  // envuelto en { value }) salvo que pidamos includeResultMetadata.
  const result = await house.findOneAndUpdate(
    { _id: HOUSE_DOC_ID },
    { $inc: { reserve: delta } },
    { returnDocument: "after" }
  );
  return result.reserve;
}

/**
 * Saldo REAL del bot reportado por él mismo cada ~15 min (leyendo su
 * propio /balance en el juego). Esta es la tercera variable de reserva:
 * la única que de verdad decide si se fuerza una pérdida (ver
 * bankroll.js). Las otras dos (reserve de arriba, y el total repartido
 * entre jugadores) son solo para estadísticas/verificación cruzada.
 */
async function getBotRealBalance() {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  const doc = await house.findOne({ _id: HOUSE_DOC_ID });
  if (!doc || typeof doc.bot_balance !== "number") return null;
  return { balance: doc.bot_balance, reported_at: doc.bot_balance_reported_at || null };
}

async function reportBotBalance(balance) {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  await house.updateOne(
    { _id: HOUSE_DOC_ID },
    { $set: { bot_balance: balance, bot_balance_reported_at: new Date() } }
  );
}

/**
 * Número de ronda global de Crash, incrementado atómicamente cada vez que
 * se abre una ronda nueva. Sirve como "nonce" público para la verificación
 * de fairness y como etiqueta visible ("Ronda #123") en el frontend.
 */
async function nextCrashRoundNumber() {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  const result = await house.findOneAndUpdate(
    { _id: HOUSE_DOC_ID },
    { $inc: { crash_round_seq: 1 } },
    { returnDocument: "after" }
  );
  return result.crash_round_seq;
}

module.exports = {
  getHouseReserve,
  ensureHouseDoc,
  adjustHouseReserve,
  getBotRealBalance,
  reportBotBalance,
  nextCrashRoundNumber,
  HOUSE_DOC_ID,
};

/**
 * ============================================================
 * CRASH — RONDA GLOBAL COMPARTIDA
 * ============================================================
 * A diferencia de Mines/Coinflip (donde cada apuesta es su propia
 * "partida" aislada), Crash es UNA sola ronda a la vez compartida por
 * todos los jugadores:
 *
 *   [10s de apuestas] -> [el multiplicador sube para todos] -> [explota]
 *                                                                  |
 *                                                                  v
 *                                              se abre la siguiente ronda
 *                                              de apuestas, de inmediato
 *
 * Como las funciones serverless de Vercel no tienen un proceso corriendo
 * de fondo todo el tiempo, no hay un "reloj" que avance la ronda por sí
 * solo. En su lugar, el estado de la ronda es una función pura del
 * tiempo: cada vez que CUALQUIER request llega (consultar estado, apostar,
 * retirar), getCurrentRound() revisa si ya pasó la hora de cerrar
 * apuestas o de explotar, y si es así aplica esa transición ahí mismo
 * antes de responder. Con el tráfico normal del sitio (varios jugadores
 * consultando cada pocos segundos) esto es indistinguible de un reloj
 * real; si nadie consulta por un buen rato, la siguiente consulta
 * simplemente "pone al día" la ronda de un jalón.
 *
 * FAIRNESS: el server_seed de cada ronda se genera y su hash se fija
 * (commitment) en el momento en que la ronda ABRE — antes de que nadie
 * pueda apostar sabiendo el resultado. El punto de choque "justo"
 * (fair_crash_point) también quedó determinado en ese instante. Al
 * CERRAR las apuestas (10s después), igual que en Mines/Coinflip, se
 * evalúa la exposición real del bote (evaluateExposure) sobre el total
 * apostado por todos los jugadores de esa ronda — si se excede, la ronda
 * se marca forced_loss y explota en 1.00x para todos, sin excepción. El
 * server_seed se revela en cuanto la ronda termina.
 */
const { getCrashRoundsCollection, getUsersCollection } = require("./db");
const { nextCrashRoundNumber, adjustHouseReserve } = require("./house");
const { randomServerSeed, hashServerSeed, fairFloat } = require("./fairness");
const { HOUSE_EDGE, CRASH_MAX_MULTIPLIER } = require("./houseEdge");
const { GROWTH_RATE, crashPointFromRoll, multiplierAtTime } = require("./crash");
const { evaluateExposure } = require("./bankroll");
const { logBet } = require("./betlog");
const { getUserBySession } = require("./session");
const { xpForBet, levelInfo } = require("./xp");

const BETTING_WINDOW_MS = 10000;
// Tras el choque la ronda se queda visible como "crashed" este tiempo (explosión,
// resultados) antes de abrir la siguiente ventana de apuestas de 10 s.
const CRASH_DISPLAY_MS = 4000;
const CRASH_CLIENT_SEED = "global-crash-round";
const MAX_CATCHUP_ITERATIONS = 25;

function timeToCrashMs(crashPoint) {
  return (Math.log(crashPoint) / GROWTH_RATE) * 1000;
}

async function createBettingRound(startAt) {
  const rounds = await getCrashRoundsCollection();
  const round_number = await nextCrashRoundNumber();
  const server_seed = randomServerSeed();
  const server_seed_hash = hashServerSeed(server_seed);
  const roll = fairFloat(server_seed, CRASH_CLIENT_SEED, round_number);
  const fair_crash_point = crashPointFromRoll(roll, HOUSE_EDGE, CRASH_MAX_MULTIPLIER);
  const now = startAt || Date.now();

  const doc = {
    round_number,
    status: "betting", // betting -> running -> crashed
    server_seed,
    server_seed_hash,
    fair_crash_point,
    crash_point: null,
    forced_loss: null,
    betting_start: now,
    betting_end: now + BETTING_WINDOW_MS,
    round_start: null,
    crash_at: null,
    crashed_at: null,
    bets: [],
    created_at: new Date(),
  };
  const result = await rounds.insertOne(doc);
  doc._id = result.insertedId;
  return doc;
}

// Cierra las apuestas de una ronda y decide el punto de choque efectivo
// (el "justo" salvo que la exposición del bote fuerce 1.00x).
async function lockRound(round) {
  const rounds = await getCrashRoundsCollection();
  const totalBet = round.bets.reduce((sum, b) => sum + b.bet_amount, 0);

  let forced_loss = false;
  let crash_point = round.fair_crash_point;
  if (totalBet > 0) {
    const exposure = await evaluateExposure(totalBet * CRASH_MAX_MULTIPLIER);
    forced_loss = exposure.forcedLoss;
    if (forced_loss) crash_point = 1.0;
  }

  const round_start = round.betting_end;
  const crash_at = round_start + timeToCrashMs(crash_point);

  return rounds.findOneAndUpdate(
    { _id: round._id, status: "betting" },
    { $set: { status: "running", crash_point, forced_loss, round_start, crash_at } },
    { returnDocument: "after" }
  );
}

// Marca la ronda como explotada y liquida (como pérdida) a quien no haya
// retirado a tiempo. La siguiente ronda de apuestas se abre CRASH_DISPLAY_MS
// después (ver getCurrentRound).
async function crashRoundAndAdvance(round) {
  const rounds = await getCrashRoundsCollection();
  const crashed = await rounds.findOneAndUpdate(
    { _id: round._id, status: "running" },
    { $set: { status: "crashed", crashed_at: round.crash_at } },
    { returnDocument: "after" }
  );
  if (!crashed) return null; // otro request ya hizo esta misma transición

  for (const bet of crashed.bets) {
    if (!bet.cashed_out) {
      await logBet({
        game: "crash",
        minecraft_username: bet.minecraft_username,
        bet_amount: bet.bet_amount,
        payout: 0,
        won: false,
        forced_loss: crashed.forced_loss,
      });
    }
  }

  return crashed;
}

// Abre la siguiente ronda de apuestas una vez pasado el tiempo de mostrar el
// choque. Solo una petición lo hace (marca atómica "advanced").
async function advanceFromCrashed(round) {
  const rounds = await getCrashRoundsCollection();
  const claimed = await rounds.findOneAndUpdate(
    { _id: round._id, status: "crashed", advanced: { $ne: true } },
    { $set: { advanced: true } },
    { returnDocument: "after" }
  );
  if (!claimed) return null;
  const now = Date.now();
  const planned = round.crashed_at + CRASH_DISPLAY_MS;
  // Si nadie miró el juego en mucho tiempo, no se "repone" el pasado: la
  // nueva ronda arranca ahora.
  const startAt = now > planned + BETTING_WINDOW_MS ? now : planned;
  return createBettingRound(startAt);
}

// Punto de entrada principal: siempre devuelve la ronda "actual", poniendo
// al día cualquier transición de fase que ya debería haber ocurrido.
async function getCurrentRound() {
  const rounds = await getCrashRoundsCollection();
  let round = await rounds.findOne({}, { sort: { round_number: -1 } });
  if (!round) round = await createBettingRound();

  let iterations = 0;
  while (iterations++ < MAX_CATCHUP_ITERATIONS) {
    const now = Date.now();
    if (round.status === "betting" && now >= round.betting_end) {
      const locked = await lockRound(round);
      round = locked || (await rounds.findOne({ _id: round._id }));
      continue;
    }
    if (round.status === "running" && now >= round.crash_at) {
      const next = await crashRoundAndAdvance(round);
      round = next || (await rounds.findOne({}, { sort: { round_number: -1 } }));
      continue;
    }
    if (round.status === "crashed" && now >= round.crashed_at + CRASH_DISPLAY_MS) {
      const next = await advanceFromCrashed(round);
      round = next || (await rounds.findOne({}, { sort: { round_number: -1 } }));
      if (round.status === "crashed") break; // otra petición lo está abriendo; se verá en el siguiente sondeo
      continue;
    }
    break;
  }
  return round;
}

async function joinCurrentRound(minecraft_username, session_token, betAmount) {
  const round = await getCurrentRound();
  if (round.status !== "betting") {
    const err = new Error("La ronda ya inició — espera la siguiente ventana de apuestas.");
    err.status = 400;
    throw err;
  }
  if (round.bets.some((b) => b.minecraft_username === minecraft_username)) {
    const err = new Error("Ya tienes una apuesta en esta ronda.");
    err.status = 409;
    throw err;
  }

  const users = await getUsersCollection();
  const deduction = await users.findOneAndUpdate(
    { minecraft_username, session_token, balance: { $gte: betAmount } },
    { $inc: { balance: -betAmount, nonce: 1, xp: xpForBet(betAmount) } },
    { returnDocument: "after" }
  );
  if (!deduction) {
    const err = new Error("Sesión inválida o saldo insuficiente.");
    err.status = 400;
    throw err;
  }
  await adjustHouseReserve(betAmount);

  const rounds = await getCrashRoundsCollection();
  const updated = await rounds.findOneAndUpdate(
    { _id: round._id, status: "betting" },
    {
      $push: {
        bets: {
          minecraft_username,
          bet_amount: betAmount,
          cashed_out: false,
          cashout_multiplier: null,
          payout: null,
          joined_at: Date.now(),
        },
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    // La ventana de apuestas cerró justo entre que descontamos el saldo y
    // que registramos la apuesta — se devuelve el donut, no se cobra nada
    // por una apuesta que nunca quedó registrada en ninguna ronda.
    await users.updateOne({ minecraft_username }, { $inc: { balance: betAmount, xp: -xpForBet(betAmount) } });
    await adjustHouseReserve(-betAmount);
    const err = new Error("La ronda cerró justo antes de registrar tu apuesta. Intenta con la siguiente.");
    err.status = 409;
    throw err;
  }
  return updated;
}

async function cashoutCurrentRound(minecraft_username, session_token) {
  const user = await getUserBySession(minecraft_username, session_token);
  if (!user) {
    const err = new Error("Sesión inválida.");
    err.status = 401;
    throw err;
  }

  const round = await getCurrentRound();
  if (round.status !== "running") {
    const err = new Error("No hay una ronda en curso para retirar.");
    err.status = 400;
    throw err;
  }
  const bet = round.bets.find((b) => b.minecraft_username === minecraft_username);
  if (!bet) {
    const err = new Error("No tienes una apuesta en esta ronda.");
    err.status = 404;
    throw err;
  }
  if (bet.cashed_out) {
    const err = new Error("Ya retiraste en esta ronda.");
    err.status = 400;
    throw err;
  }

  const now = Date.now();
  const elapsedSeconds = (now - round.round_start) / 1000;
  const currentMultiplier = multiplierAtTime(elapsedSeconds);
  if (now >= round.crash_at || currentMultiplier >= round.crash_point) {
    const err = new Error("El cohete ya explotó.");
    err.status = 400;
    throw err;
  }

  const payout = Math.floor(bet.bet_amount * currentMultiplier);
  const rounds = await getCrashRoundsCollection();
  const updated = await rounds.findOneAndUpdate(
    { _id: round._id, status: "running", "bets.minecraft_username": minecraft_username, "bets.cashed_out": false },
    {
      $set: {
        "bets.$.cashed_out": true,
        "bets.$.cashout_multiplier": currentMultiplier,
        "bets.$.payout": payout,
        "bets.$.cashed_out_at": now,
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    const err = new Error("No se pudo confirmar el retiro a tiempo (puede que ya haya explotado). Intenta de nuevo.");
    err.status = 409;
    throw err;
  }

  const users = await getUsersCollection();
  await users.updateOne({ minecraft_username }, { $inc: { balance: payout } });
  await adjustHouseReserve(-payout);
  await logBet({ game: "crash", minecraft_username, bet_amount: bet.bet_amount, payout, won: true, forced_loss: false });

  const finalUser = await users.findOne({ minecraft_username });
  return { payout, multiplier: currentMultiplier, balance: finalUser.balance };
}

async function getRecentCrashHistory(limit = 10) {
  const rounds = await getCrashRoundsCollection();
  const docs = await rounds.find({ status: "crashed" }).sort({ round_number: -1 }).limit(limit).toArray();
  return docs.reverse().map((d) => ({ round_number: d.round_number, crash_point: d.crash_point }));
}

// Forma pública de una ronda (nunca expone server_seed ni crash_point
// antes de que la ronda termine; ni el fair_crash_point interno).
function toPublicRound(round, viewerUsername) {
  const base = {
    round_number: round.round_number,
    status: round.status,
    server_seed_hash: round.server_seed_hash,
    growth_rate: GROWTH_RATE,
    betting_end: round.betting_end,
    round_start: round.round_start,
    players_count: round.bets.length,
    total_wagered: round.bets.reduce((sum, b) => sum + b.bet_amount, 0),
    bets: round.bets.map((b) => ({
      minecraft_username: b.minecraft_username,
      bet_amount: b.bet_amount,
      cashed_out: b.cashed_out,
      cashout_multiplier: b.cashout_multiplier,
      payout: b.payout || 0,
    })),
  };

  if (round.status === "running" || round.status === "crashed") {
    base.crash_at = round.crash_at;
  }
  if (round.status === "crashed") {
    base.crash_point = round.crash_point;
    base.forced_loss = round.forced_loss;
    base.server_seed = round.server_seed;
  }
  if (viewerUsername) {
    const mine = round.bets.find((b) => b.minecraft_username === viewerUsername);
    if (mine) {
      base.my_bet = {
        bet_amount: mine.bet_amount,
        cashed_out: mine.cashed_out,
        cashout_multiplier: mine.cashout_multiplier,
        payout: mine.payout,
      };
    }
  }
  return base;
}

// Añade `level` a cada apuesta de una ronda pública (para la tabla de
// jugadores). Una sola consulta por llamada; solo lee el XP de los
// usuarios que apostaron en la ronda.
async function attachBetLevels(publicRound) {
  const names = (publicRound.bets || []).map((b) => b.minecraft_username);
  if (!names.length) return publicRound;
  const users = await getUsersCollection();
  const docs = await users.find({ minecraft_username: { $in: names } }, { projection: { minecraft_username: 1, xp: 1 } }).toArray();
  const xpBy = new Map(docs.map((u) => [u.minecraft_username, u.xp || 0]));
  publicRound.bets = publicRound.bets.map((b) => ({ ...b, level: levelInfo(xpBy.get(b.minecraft_username) || 0).level }));
  return publicRound;
}

module.exports = {
  attachBetLevels,
  BETTING_WINDOW_MS,
  getCurrentRound,
  joinCurrentRound,
  cashoutCurrentRound,
  getRecentCrashHistory,
  toPublicRound,
};

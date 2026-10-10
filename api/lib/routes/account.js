const express = require("express");
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { getUsersCollection, getWithdrawalsCollection, getDepositsCollection } = require("../db");
const { requireApiKey } = require("../auth");
const { getUserBySession } = require("../session");
const { randomServerSeed, hashServerSeed } = require("../fairness");
const { reportBotBalance } = require("../house");

const router = express.Router();

/**
 * POST /api/account-bot-balance-sync
 * Body: { api_key, balance }
 * Protegido por api_key (lo llama el bot cada ~15 min con su saldo real
 * leído del juego). Alimenta la tercera variable de reserva (ver
 * bankroll.js) — la única que realmente decide si se fuerza una pérdida.
 */
router.post("/account-bot-balance-sync", requireApiKey, async (req, res) => {
  try {
    const { balance } = req.body || {};
    const parsedBalance = Number(balance);
    if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
      return res.status(400).json({ error: "balance debe ser un número no negativo." });
    }
    await reportBotBalance(parsedBalance);
    return res.status(200).json({ status: "ok", balance: parsedBalance });
  } catch (err) {
    console.error("Error en /account-bot-balance-sync:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// NOTA IMPORTANTE: Vercel, en este proyecto, solo invoca la función
// catch-all cuando la ruta tiene EXACTAMENTE un segmento después de
// "/api/" (ej. "/api/algo" funciona, "/api/algo/otro" da 404 a nivel de
// plataforma, confirmado con los logs de Vercel: cero invocaciones).
// Por eso TODAS las rutas aquí son de un solo segmento, usando guiones
// en vez de "/" para separar grupo/acción (ej. "/account-generate-code"
// en vez de "/account/generate-code").

/**
 * POST /api/account-generate-code
 * Body: { minecraft_username }
 */
router.post("/account-generate-code", async (req, res) => {
  try {
    const { minecraft_username } = req.body || {};
    if (!minecraft_username || typeof minecraft_username !== "string") {
      return res.status(400).json({ error: "minecraft_username es requerido." });
    }
    const username = minecraft_username.trim();
    if (username.length < 3 || username.length > 16) {
      return res.status(400).json({ error: "Nombre de usuario de Minecraft inválido." });
    }
    const code = Math.floor(Math.random() * 1000) + 1;
    const users = await getUsersCollection();
    await users.updateOne(
      { minecraft_username: username },
      {
        $set: { minecraft_username: username, pending_code: code, status: "pending", updated_at: new Date() },
        $setOnInsert: { balance: 0, created_at: new Date() },
      },
      { upsert: true }
    );
    return res.status(200).json({ minecraft_username: username, code, status: "pending" });
  } catch (err) {
    console.error("Error en /account-generate-code:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-verify-link
 * Body: { minecraft_username, payment_amount, api_key }
 * Protegido por api_key (lo llama el bot, no el frontend).
 */
router.post("/account-verify-link", requireApiKey, async (req, res) => {
  try {
    const { minecraft_username, payment_amount } = req.body || {};
    if (!minecraft_username || payment_amount === undefined) {
      return res.status(400).json({ error: "minecraft_username y payment_amount son requeridos." });
    }
    const username = String(minecraft_username).trim();
    const amount = Number(payment_amount);
    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado. Genera un código primero." });
    if (user.status === "linked") {
      return res.status(200).json({ minecraft_username: username, status: "linked", message: "La cuenta ya estaba vinculada." });
    }
    if (user.pending_code !== amount) {
      return res.status(400).json({ error: "El importe no coincide con el código pendiente." });
    }
    await users.updateOne(
      { minecraft_username: username },
      { $set: { status: "linked", linked_at: new Date() }, $unset: { pending_code: "" } }
    );
    return res.status(200).json({ minecraft_username: username, status: "linked" });
  } catch (err) {
    console.error("Error en /account-verify-link:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-claim-session
 * Body: { minecraft_username }
 */
router.post("/account-claim-session", async (req, res) => {
  try {
    const { minecraft_username } = req.body || {};
    if (!minecraft_username) return res.status(400).json({ error: "minecraft_username es requerido." });
    const username = String(minecraft_username).trim();
    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });
    if (!user || user.status !== "linked") {
      return res.status(400).json({ error: "La cuenta no está vinculada." });
    }
    if (user.session_claimed) {
      return res.status(409).json({ error: "La sesión ya fue reclamada. Si perdiste el token, vuelve a vincular la cuenta." });
    }
    const session_token = crypto.randomBytes(24).toString("hex");
    const server_seed = randomServerSeed();
    const server_seed_hash = hashServerSeed(server_seed);
    await users.updateOne(
      { minecraft_username: username },
      { $set: { session_token, session_claimed: true, server_seed, server_seed_hash, nonce: 0 } }
    );
    return res.status(200).json({ session_token, server_seed_hash });
  } catch (err) {
    console.error("Error en /account-claim-session:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-deposit-donuts
 * Body: { minecraft_username, amount, api_key }
 * Protegido por api_key (lo llama el bot, no el frontend).
 */
router.post("/account-deposit-donuts", requireApiKey, async (req, res) => {
  try {
    const { minecraft_username, amount } = req.body || {};
    if (!minecraft_username || amount === undefined) {
      return res.status(400).json({ error: "minecraft_username y amount son requeridos." });
    }
    const username = String(minecraft_username).trim();
    const depositAmount = Number(amount);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "amount debe ser un número positivo." });
    }
    const users = await getUsersCollection();
    const user = await users.findOne({ minecraft_username: username });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
    if (user.status !== "linked") {
      return res.status(400).json({ error: "La cuenta debe estar vinculada antes de depositar donuts." });
    }
    // Solo se acredita si existe una solicitud de depósito activa.
    const deposits = await getDepositsCollection();
    const now = new Date();
    const request = await deposits.findOneAndUpdate(
      { minecraft_username: username, status: "pending", expires_at: { $gt: now } },
      { $set: { status: "completed", paid_amount: depositAmount, completed_at: now } },
      { returnDocument: "after" }
    );
    if (!request) {
      return res.status(409).json({ error: "No hay solicitud de depósito activa para este usuario. No se acreditó." });
    }
    const result = await users.findOneAndUpdate(
      { minecraft_username: username },
      { $inc: { balance: depositAmount }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );
    return res.status(200).json({ minecraft_username: username, balance: result.balance });
  } catch (err) {
    console.error("Error en /account-deposit-donuts:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-deposit-request
 * Body: { minecraft_username, session_token, amount }
 * Crea una solicitud de depósito válida por 15 minutos. Sin ella, los pagos
 * al bot no se acreditan.
 */
const MIN_DEPOSIT = 10000;
const DEPOSIT_TTL_MS = 15 * 60 * 1000;

router.post("/account-deposit-request", async (req, res) => {
  try {
    const { minecraft_username, session_token, amount } = req.body || {};
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });
    const requestedAmount = Math.floor(Number(amount));
    if (!Number.isFinite(requestedAmount) || requestedAmount < MIN_DEPOSIT) {
      return res.status(400).json({ error: `El depósito mínimo es ${MIN_DEPOSIT.toLocaleString("en-US")} donuts.` });
    }
    const deposits = await getDepositsCollection();
    const now = new Date();
    await deposits.updateMany(
      { minecraft_username: user.minecraft_username, status: "pending" },
      { $set: { status: "cancelled" } }
    );
    const expires_at = new Date(now.getTime() + DEPOSIT_TTL_MS);
    await deposits.insertOne({
      minecraft_username: user.minecraft_username,
      amount: requestedAmount,
      status: "pending",
      created_at: now,
      expires_at,
    });
    return res.status(200).json({ status: "pending", amount: requestedAmount, expires_at });
  } catch (err) {
    console.error("Error en /account-deposit-request:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-fairness-reveal
 * Body: { minecraft_username, session_token }
 */
router.post("/account-fairness-reveal", async (req, res) => {
  try {
    const { minecraft_username, session_token } = req.body || {};
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const revealed_server_seed = user.server_seed;
    const revealed_hash = user.server_seed_hash;
    const total_bets_under_seed = user.nonce;

    const new_server_seed = randomServerSeed();
    const new_server_seed_hash = hashServerSeed(new_server_seed);

    const users = await getUsersCollection();
    await users.updateOne(
      { minecraft_username: user.minecraft_username },
      { $set: { server_seed: new_server_seed, server_seed_hash: new_server_seed_hash, nonce: 0 } }
    );

    return res.status(200).json({ revealed_server_seed, revealed_hash, total_bets_under_seed, new_server_seed_hash });
  } catch (err) {
    console.error("Error en /account-fairness-reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-withdraw-request
 * Body: { minecraft_username, session_token, amount }
 * Autenticado por sesión (lo llama el frontend, no el bot).
 *
 * Valida monto > 0, <= saldo, >= mínimo, y que no haya ya un retiro
 * pendiente para ese usuario. Descuenta el saldo de inmediato (para que
 * no se pueda gastar mientras está en cola) y encola la solicitud.
 */
const MIN_WITHDRAWAL = 10000;

router.post("/account-withdraw-request", async (req, res) => {
  try {
    const { minecraft_username, session_token, amount } = req.body || {};
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const requestedAmount = Math.floor(Number(amount));
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ error: "El monto debe ser un número positivo." });
    }
    if (requestedAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `El retiro mínimo es ${MIN_WITHDRAWAL.toLocaleString("en-US")} donuts.` });
    }
    if (requestedAmount > (user.balance || 0)) {
      return res.status(400).json({ error: "No tienes saldo suficiente." });
    }

    const withdrawals = await getWithdrawalsCollection();
    const existingPending = await withdrawals.findOne({
      minecraft_username: user.minecraft_username,
      status: { $in: ["pending", "in_progress"] },
    });
    if (existingPending) {
      return res.status(409).json({ error: "Ya tienes un retiro pendiente. Espera a que se complete." });
    }

    const users = await getUsersCollection();
    const result = await users.findOneAndUpdate(
      { minecraft_username: user.minecraft_username, balance: { $gte: requestedAmount } },
      { $inc: { balance: -requestedAmount }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) {
      return res.status(400).json({ error: "No tienes saldo suficiente." });
    }

    await withdrawals.insertOne({
      minecraft_username: user.minecraft_username,
      amount: requestedAmount,
      status: "pending",
      attempts: 0,
      created_at: new Date(),
    });

    return res.status(200).json({ status: "pending", balance: result.balance });
  } catch (err) {
    console.error("Error en /account-withdraw-request:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

const WITHDRAW_MAX_ATTEMPTS = 2;
const WITHDRAW_COOLDOWN_MS = 60 * 1000; // 1 minuto entre intentos

/**
 * POST /api/account-withdraw-next
 * Body: { api_key }
 * Protegido por api_key (lo llama el bot cada ~15s).
 */
router.post("/account-withdraw-next", requireApiKey, async (req, res) => {
  try {
    const withdrawals = await getWithdrawalsCollection();
    const cutoff = new Date(Date.now() - WITHDRAW_COOLDOWN_MS);

    const candidate = await withdrawals.findOneAndUpdate(
      {
        status: "pending",
        $or: [{ last_attempt_at: { $exists: false } }, { last_attempt_at: { $lte: cutoff } }],
      },
      {
        $set: { status: "in_progress", last_attempt_at: new Date() },
        $inc: { attempts: 1 },
      },
      { sort: { created_at: 1 }, returnDocument: "after" }
    );

    if (!candidate) {
      return res.status(200).json({ withdrawal: null });
    }

    const w = candidate;
    return res.status(200).json({
      withdrawal: {
        withdrawal_id: String(w._id),
        minecraft_username: w.minecraft_username,
        amount: w.amount,
        attempt: w.attempts,
      },
    });
  } catch (err) {
    console.error("Error en /account-withdraw-next:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account-withdraw-confirm
 * Body: { api_key, withdrawal_id, success }
 * Protegido por api_key (lo llama el bot tras intentar el pago en el juego).
 */
router.post("/account-withdraw-confirm", requireApiKey, async (req, res) => {
  try {
    const { withdrawal_id, success } = req.body || {};
    if (!withdrawal_id) return res.status(400).json({ error: "withdrawal_id es requerido." });

    const withdrawals = await getWithdrawalsCollection();
    const withdrawal = await withdrawals.findOne({ _id: new ObjectId(withdrawal_id) });
    if (!withdrawal) return res.status(404).json({ error: "Retiro no encontrado." });
    if (withdrawal.status !== "in_progress") {
      return res.status(409).json({ error: `El retiro ya no está en progreso (status: ${withdrawal.status}).` });
    }

    if (success) {
      await withdrawals.updateOne(
        { _id: withdrawal._id },
        { $set: { status: "completed", completed_at: new Date() } }
      );
      return res.status(200).json({ status: "completed" });
    }

    if (withdrawal.attempts >= WITHDRAW_MAX_ATTEMPTS) {
      const users = await getUsersCollection();
      await users.updateOne(
        { minecraft_username: withdrawal.minecraft_username },
        { $inc: { balance: withdrawal.amount }, $set: { updated_at: new Date() } }
      );
      await withdrawals.updateOne(
        { _id: withdrawal._id },
        { $set: { status: "failed", failed_at: new Date() } }
      );
      return res.status(200).json({ status: "failed", balance_restored: true });
    }

    await withdrawals.updateOne({ _id: withdrawal._id }, { $set: { status: "pending" } });
    return res.status(200).json({ status: "pending_retry" });
  } catch (err) {
    console.error("Error en /account-withdraw-confirm:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;

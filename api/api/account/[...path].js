const express = require("express");
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { getUsersCollection } = require("../../lib/db");
const { cors } = require("../../lib/cors");
const { requireApiKey } = require("../../lib/auth");
const { getUserBySession } = require("../../lib/session");
const { randomServerSeed, hashServerSeed } = require("../../lib/fairness");

const app = express();

// Este archivo es una función "catch-all" de Vercel: agrupa varios
// endpoints pequeños en UNA sola función para no pasarnos del límite de
// 12 funciones del plan gratuito. Vercel reenvía la ruta COMPLETA
// (ej. "/api/account/generate-code"), así que quitamos el prefijo fijo
// antes de que Express intente hacer el match de rutas.
app.use((req, res, next) => {
  req.url = req.url.replace(/^\/api\/account/, "") || "/";
  next();
});
app.use(express.json());
app.use(cors);

/**
 * POST /api/account/generate-code
 * Body: { minecraft_username }
 */
app.post("/generate-code", async (req, res) => {
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
    console.error("Error en /account/generate-code:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account/verify-link
 * Body: { minecraft_username, payment_amount, api_key }
 * Protegido por api_key (lo llama el bot, no el frontend).
 */
app.post("/verify-link", requireApiKey, async (req, res) => {
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
    console.error("Error en /account/verify-link:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account/claim-session
 * Body: { minecraft_username }
 */
app.post("/claim-session", async (req, res) => {
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
    console.error("Error en /account/claim-session:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account/deposit-donuts
 * Body: { minecraft_username, amount, api_key }
 * Protegido por api_key (lo llama el bot, no el frontend).
 */
app.post("/deposit-donuts", requireApiKey, async (req, res) => {
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
    const result = await users.findOneAndUpdate(
      { minecraft_username: username },
      { $inc: { balance: depositAmount }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );
    return res.status(200).json({ minecraft_username: username, balance: result.value.balance });
  } catch (err) {
    console.error("Error en /account/deposit-donuts:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/account/fairness/reveal
 * Body: { minecraft_username, session_token }
 */
app.post("/fairness/reveal", async (req, res) => {
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
    console.error("Error en /account/fairness/reveal:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = app;

const express = require("express");
const { ObjectId } = require("mongodb");
const { connectToDatabase, getUsersCollection } = require("../db");
const { getUserBySession } = require("../session");
const { levelInfo } = require("../xp");

const router = express.Router();

const CHAT_MIN_LEVEL = 15;
const MAX_LEN = 200;
const COOLDOWN_MS = 2000;
const PAGE = 50;
const ONLINE_WINDOW_MS = 90 * 1000; // "activo" = avisó presencia en los últimos 90 s

async function chatCollection() {
  const db = await connectToDatabase();
  return db.collection("chat_messages");
}

const toPublic = (m) => ({
  id: String(m._id),
  minecraft_username: m.minecraft_username,
  level: m.level,
  text: m.text,
  created_at: m.created_at,
});

/**
 * GET /api/chat-messages?after=<id>
 * Público (sin sesión): cualquiera puede leer. Sin `after` devuelve los últimos 50;
 * con `after` solo los mensajes más nuevos que ese id.
 */
router.get("/chat-messages", async (req, res) => {
  try {
    const col = await chatCollection();
    const after = String(req.query.after || "");
    let docs;
    if (ObjectId.isValid(after) && after.length === 24) {
      docs = await col.find({ _id: { $gt: new ObjectId(after) } }).sort({ _id: 1 }).limit(PAGE).toArray();
    } else {
      docs = (await col.find({}).sort({ _id: -1 }).limit(PAGE).toArray()).reverse();
    }
    const users = await getUsersCollection();
    const online = await users.countDocuments({ last_seen: { $gt: new Date(Date.now() - ONLINE_WINDOW_MS) } });
    return res.status(200).json({ messages: docs.map(toPublic), min_level: CHAT_MIN_LEVEL, online });
  } catch (err) {
    console.error("Error en /chat-messages:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/chat-send
 * Body: { minecraft_username, session_token, text }
 * Solo jugadores nivel >= 15. Un mensaje cada 2 s por jugador, máx. 200 caracteres.
 */
router.post("/chat-send", async (req, res) => {
  try {
    const { minecraft_username, session_token } = req.body || {};
    let text = String((req.body && req.body.text) || "");
    // Sin caracteres de control, espacios colapsados.
    text = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return res.status(400).json({ error: "Escribe un mensaje." });
    if (text.length > MAX_LEN) return res.status(400).json({ error: `Máximo ${MAX_LEN} caracteres.` });

    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });
    const { level } = levelInfo(user.xp || 0);
    if (level < CHAT_MIN_LEVEL) {
      return res.status(403).json({ error: `Necesitas nivel ${CHAT_MIN_LEVEL} para hablar en el chat.` });
    }

    const col = await chatCollection();
    const last = await col.findOne({ minecraft_username }, { sort: { _id: -1 } });
    if (last && Date.now() - new Date(last.created_at).getTime() < COOLDOWN_MS) {
      return res.status(429).json({ error: "Espera un momento antes de enviar otro mensaje." });
    }

    const doc = { minecraft_username, level, text, created_at: new Date() };
    const r = await col.insertOne(doc);
    doc._id = r.insertedId;
    return res.status(200).json({ message: toPublic(doc) });
  } catch (err) {
    console.error("Error en /chat-send:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/presence-ping
 * Body: { minecraft_username, session_token } — marca al jugador como activo ahora.
 */
router.post("/presence-ping", async (req, res) => {
  try {
    const { minecraft_username, session_token } = req.body || {};
    if (!minecraft_username || !session_token) return res.status(400).json({ error: "Faltan campos." });
    const users = await getUsersCollection();
    const r = await users.updateOne({ minecraft_username, session_token }, { $set: { last_seen: new Date() } });
    if (!r.matchedCount) return res.status(401).json({ error: "Sesión inválida." });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error en /presence-ping:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/bug-report
 * Body: { minecraft_username, session_token, type, text, page?, user_agent? }
 * Guarda el reporte en la colección bug_reports (máx. 5 por hora por jugador).
 */
const BUG_TYPES = ["crash", "mines", "coinflip", "deposit", "chat", "other"];
router.post("/bug-report", async (req, res) => {
  try {
    const { minecraft_username, session_token, type, page, user_agent } = req.body || {};
    const text = String((req.body && req.body.text) || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (text.length < 5 || text.length > 1000) return res.status(400).json({ error: "El reporte debe tener entre 5 y 1000 caracteres." });
    if (!BUG_TYPES.includes(type)) return res.status(400).json({ error: "Tipo inválido." });
    const user = await getUserBySession(minecraft_username, session_token);
    if (!user) return res.status(401).json({ error: "Sesión inválida." });

    const db = await connectToDatabase();
    const col = db.collection("bug_reports");
    const recent = await col.countDocuments({ minecraft_username, created_at: { $gt: new Date(Date.now() - 3600 * 1000) } });
    if (recent >= 5) return res.status(429).json({ error: "Has enviado muchos reportes; inténtalo más tarde." });

    await col.insertOne({
      minecraft_username,
      level: levelInfo(user.xp || 0).level,
      type,
      text,
      page: String(page || "").slice(0, 30),
      user_agent: String(user_agent || "").slice(0, 200),
      status: "open",
      created_at: new Date(),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error en /bug-report:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

module.exports = router;

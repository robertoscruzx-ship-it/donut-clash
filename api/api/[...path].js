const express = require("express");
const { cors } = require("../lib/cors");

const accountRoutes = require("../lib/routes/account");
const adminRoutes = require("../lib/routes/admin");
const gamesRoutes = require("../lib/routes/games");
const userRoutes = require("../lib/routes/user");

const app = express();

// Función catch-all ÚNICA para toda la API (/api/*). Antes había un
// archivo catch-all por grupo (account/, admin/, games/, user/), pero
// Vercel estaba rechazando (404 a nivel de plataforma, nunca llegaba a
// invocar la función) cualquier ruta con 2+ segmentos después del grupo
// — por ejemplo /api/account/withdraw/next o /api/games/bet/coinflip —
// pese a múltiples intentos de arreglarlo vía vercel.json. Reducir todo
// a UNA sola función catch-all en la raíz de api/ con sub-routers de
// Express por dentro evita ese problema por completo.
app.use(express.json());
app.use(cors);

app.use("/api/account", accountRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/user", userRoutes);

module.exports = app;

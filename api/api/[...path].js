const express = require("express");
const { cors } = require("../lib/cors");

const accountRoutes = require("../lib/routes/account");
const adminRoutes = require("../lib/routes/admin");
const gamesRoutes = require("../lib/routes/games");
const userRoutes = require("../lib/routes/user");

const app = express();

// Función catch-all ÚNICA para toda la API (/api/*).
//
// IMPORTANTE: en este proyecto de Vercel, confirmado con los logs de
// invocación (cero entradas para las rutas que fallaban), el router de
// plataforma de Vercel SOLO invoca esta función cuando la URL tiene
// EXACTAMENTE un segmento después de "/api/" (ej. "/api/algo" sí,
// "/api/algo/otro" no, nunca llega ni siquiera a ejecutarse esta
// función). Por eso TODAS las rutas son de un solo segmento usando
// guiones como separador (ej. "/api/account-withdraw-next" en vez de
// "/api/account/withdraw/next"). No reintroducir rutas con "/" internos.
app.use(express.json());
app.use(cors);

app.use("/api", accountRoutes);
app.use("/api", adminRoutes);
app.use("/api", gamesRoutes);
app.use("/api", userRoutes);

module.exports = app;

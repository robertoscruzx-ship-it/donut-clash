/**
 * Middleware CORS simple. Si tu frontend en GitHub Pages tiene un dominio
 * fijo, sustituye "*" por ese dominio exacto para mayor seguridad, por ej:
 * "https://tu-usuario.github.io"
 */
function cors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
}

module.exports = { cors };

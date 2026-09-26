/**
 * Middleware Express que protege un endpoint verificando que el cuerpo
 * de la petición incluya la api_key correcta, comparada contra la
 * variable de entorno API_KEY configurada en Vercel.
 */
function requireApiKey(req, res, next) {
  const providedKey = req.body?.api_key || req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    return res.status(500).json({ error: "API_KEY no configurada en el servidor." });
  }

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: "api_key inválida o ausente." });
  }

  next();
}

module.exports = { requireApiKey };

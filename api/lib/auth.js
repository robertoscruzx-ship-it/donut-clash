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

/**
 * Middleware para el panel de estadísticas oculto del frontend. Usa una
 * palabra clave SEPARADA de la API_KEY real (ADMIN_PANEL_PASSWORD), para
 * no tener que escribir la API_KEY verdadera en una barra de búsqueda
 * pública. Esta palabra clave solo desbloquea la vista de solo lectura
 * de estadísticas, nunca los endpoints que mueven dinero.
 */
function requireAdminPanelAuth(req, res, next) {
  const provided = req.body?.admin_password;
  const expected = process.env.ADMIN_PANEL_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: "ADMIN_PANEL_PASSWORD no configurada en el servidor." });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Palabra clave incorrecta." });
  }
  next();
}

module.exports.requireAdminPanelAuth = requireAdminPanelAuth;


const { getUsersCollection } = require("./db");

/**
 * Busca un usuario validando que minecraft_username + session_token
 * coincidan. Esto evita que alguien apueste con el saldo de otro jugador
 * conociendo solo su nombre de usuario (público).
 */
async function getUserBySession(minecraft_username, session_token) {
  if (!minecraft_username || !session_token) return null;
  const users = await getUsersCollection();
  return users.findOne({ minecraft_username, session_token });
}

module.exports = { getUserBySession };

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.warn("[db.js] Advertencia: la variable de entorno MONGODB_URI no está definida.");
}

// Cache de conexión para reutilizar entre invocaciones "warm" de la función serverless.
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  const db = cachedClient.db("donut_clash");
  cachedDb = db;
  return db;
}

async function getUsersCollection() {
  const db = await connectToDatabase();
  return db.collection("users");
}

async function getMinesGamesCollection() {
  const db = await connectToDatabase();
  return db.collection("mines_games");
}

async function getCrashGamesCollection() {
  const db = await connectToDatabase();
  return db.collection("crash_games");
}

async function getHouseCollection() {
  const db = await connectToDatabase();
  return db.collection("house");
}

async function getBetsCollection() {
  const db = await connectToDatabase();
  return db.collection("bets");
}

module.exports = {
  connectToDatabase,
  getUsersCollection,
  getMinesGamesCollection,
  getCrashGamesCollection,
  getHouseCollection,
  getBetsCollection,
};

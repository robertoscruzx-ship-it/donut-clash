const { getHouseCollection } = require("./db");

const HOUSE_DOC_ID = "main";

async function ensureHouseDoc(initialReserve = 0) {
  const house = await getHouseCollection();
  await house.updateOne(
    { _id: HOUSE_DOC_ID },
    { $setOnInsert: { reserve: initialReserve } },
    { upsert: true }
  );
}

async function getHouseReserve() {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  const doc = await house.findOne({ _id: HOUSE_DOC_ID });
  return doc ? doc.reserve : 0;
}

// Suma (o resta, con delta negativo) a la reserva de la casa de forma atómica.
async function adjustHouseReserve(delta) {
  await ensureHouseDoc(0);
  const house = await getHouseCollection();
  // mongodb v6: findOneAndUpdate devuelve el documento directamente (ya no
  // envuelto en { value }) salvo que pidamos includeResultMetadata.
  const result = await house.findOneAndUpdate(
    { _id: HOUSE_DOC_ID },
    { $inc: { reserve: delta } },
    { returnDocument: "after" }
  );
  return result.reserve;
}

module.exports = { getHouseReserve, ensureHouseDoc, adjustHouseReserve, HOUSE_DOC_ID };

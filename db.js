import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

// Better Auth (in the Next.js client) stores its users and sessions in this
// database. Business data lives alongside them so role/subscription checks use
// a single source of truth.
export const DB_NAME =
  process.env.AUTH_DB_NAME || process.env.DB_NAME || "YESLY-Databse";

let client;
let db;

/**
 * Create an index without letting an existing dirty dataset stop the API from
 * booting. The warning is loud on purpose: the index backfills the protection.
 */
async function safeIndex(collection, keys, options = {}) {
  try {
    await db.collection(collection).createIndex(keys, options);
  } catch (error) {
    console.warn(
      `[db] Could not create index on ${collection} (${JSON.stringify(keys)}): ${error.message}`,
    );
  }
}

export async function connectDB() {
  if (db) return db;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured on the server");
  }

  client = new MongoClient(uri);

  await client.connect();
  db = client.db(DB_NAME);

  await Promise.all([
    safeIndex("service", { vendorId: 1 }),
    safeIndex("service", { status: 1, isActive: 1 }),
    safeIndex("service", { location: 1 }),
    safeIndex("booking", { customerId: 1 }),
    safeIndex("booking", { vendorId: 1 }),
    safeIndex("booking", { serviceId: 1, eventDate: 1 }),
    // One active request per service per date. The partial index makes the
    // check-then-insert race impossible, not just unlikely.
    safeIndex(
      "booking",
      { serviceId: 1, eventDate: 1 },
      {
        name: "unique_active_booking",
        unique: true,
        partialFilterExpression: { status: { $in: ["pending", "accepted"] } },
      },
    ),
    safeIndex("transaction", { stripeSessionId: 1 }, { unique: true, sparse: true }),
    safeIndex("transaction", { createdAt: -1 }),
    safeIndex("user", { role: 1, createdAt: -1 }),
  ]);

  console.log(`MongoDB connected (database: ${DB_NAME})`);
  return db;
}

export function col(name) {
  if (!db) throw new Error("Database is not connected yet");
  return db.collection(name);
}

export function getDb() {
  return db;
}

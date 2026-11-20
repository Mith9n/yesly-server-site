import "dotenv/config";
import { connectDB, col } from "./db.js";

// Read-only: list every service with its vendor and image count.
await connectDB();
const services = await col("service").find({}).sort({ createdAt: 1 }).toArray();
const vendors = await col("user").find({}, { projection: { email: 1, businessName: 1, name: 1 } }).toArray();
const map = new Map(vendors.map((v) => [v._id.toString(), v]));

for (const s of services) {
  const v = map.get(s.vendorId?.toString());
  console.log(
    `${String(s.status).padEnd(9)} imgs=${(s.images || []).length} active=${s.isActive} ` +
      `${String(s.serviceName).padEnd(38)} :: ${v?.businessName || v?.email || s.vendorId}`,
  );
}
console.log(`total=${services.length}`);
process.exit(0);

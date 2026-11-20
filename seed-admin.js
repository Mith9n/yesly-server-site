import "dotenv/config";
import { connectDB, col } from "./db.js";

/**
 * Promote an existing registered account to admin.
 * Usage: npm run seed:admin -- admin@yesly.com
 *
 * Admin accounts can never be created through public registration; this
 * server-side command is the only way to grant the role.
 */
async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run seed:admin -- <registered-email>");
    process.exit(1);
  }

  await connectDB();
  const user = await col("user").findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(
      `No account found for ${email}. Register it through the Yesly sign-up page first, then run this command.`,
    );
    process.exit(1);
  }

  await col("user").updateOne(
    { _id: user._id },
    { $set: { role: "admin", isBlocked: false, updatedAt: new Date() } },
  );
  console.log(`${email} is now a Yesly admin. Sign in again to refresh the session.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Admin seed failed:", err.message);
  process.exit(1);
});

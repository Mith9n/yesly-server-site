import "dotenv/config";
import path from "node:path";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import authRoutes from "./routes/auth.js";
import serviceRoutes from "./routes/services.js";
import vendorRoutes from "./routes/vendors.js";
import bookingRoutes from "./routes/bookings.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes, { stripeWebhook } from "./routes/payments.js";
import uploadRoutes from "./routes/uploads.js";
import { rateLimit } from "./middleware/rate-limit.js";

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      const localOrigin = isProduction
        ? false
        : /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
      if (!origin || allowedOrigins.includes(origin) || localOrigin) {
        return callback(null, true);
      }
      const error = new Error("Origin is not allowed by Yesly CORS");
      error.status = 403;
      return callback(error);
    },
    credentials: true,
  }),
);

// Stripe requires the untouched request body to verify the webhook signature,
// so this route is registered before the JSON parser.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);

// Uploads accept base64 image payloads, so they get a larger body limit before
// the global parser runs. Every other route stays at the small default.
app.use(
  "/api/uploads",
  rateLimit({ name: "uploads", windowMs: 60 * 60_000, max: 20 }),
  express.json({ limit: "10mb" }),
  uploadRoutes,
);

app.use(express.json({ limit: "1mb" }));

// Development only: when ImgBB rejects an upload the image is kept on disk and
// served from here. Production reports the failure instead of storing it.
// Filenames carry a content hash, so they can be cached permanently.
app.use(
  "/uploads",
  express.static(path.resolve(process.cwd(), "uploads"), {
    maxAge: "365d",
    immutable: true,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "yesly-server" });
});

// The session exchange and sign-in-adjacent calls are the most attractive
// brute-force targets, so they get a tighter budget than the rest of the API.
app.use(
  "/api/auth",
  rateLimit({ name: "auth", windowMs: 60_000, max: 30 }),
  authRoutes,
);
app.use("/api/services", serviceRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  console.error("API error:", err.message);
  const status = err.status || 500;
  res.status(status).json({
    message:
      status === 500
        ? "Something went wrong on the server. Please try again."
        : err.message,
  });
});

async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Yesly API running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start Yesly API:", err.message);
  process.exit(1);
});

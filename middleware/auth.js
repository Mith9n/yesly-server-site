import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { col } from "../db.js";

// Never fall back to a known secret: a predictable signing key lets anyone mint
// valid platform tokens for any account, including admins. Production must be
// configured explicitly; development gets an ephemeral random key.
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "development") {
  throw new Error(
    "JWT_SECRET must be configured before starting the Yesly API (set NODE_ENV=development for a temporary key)",
  );
}

export const JWT_SECRET =
  process.env.JWT_SECRET || randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = "7d";

export function signToken(user, sessionToken) {
  const payload = {
    sub: user._id.toString(),
    role: user.role || "customer",
    email: user.email,
  };
  // Tie the token to the Better Auth session so signing out actually revokes it.
  if (sessionToken) payload.sid = sessionToken;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.slice(name.length + 1));
}

function rawSessionCookie(req) {
  return (
    readCookie(req, "__Secure-better-auth.session_token") ||
    readCookie(req, "better-auth.session_token")
  );
}

export function sessionTokenFromCookie(req) {
  const raw = rawSessionCookie(req);
  if (!raw) return null;
  return raw.split(".")[0] || null;
}

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (!ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

/** Resolve the Better Auth session cookie into a verified platform user. */
export async function sessionUserFromCookie(req) {
  const token = sessionTokenFromCookie(req);
  if (!token) return null;

  const session = await col("session").findOne({
    token,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const userId = toObjectId(session.userId);
  if (!userId) return null;

  return col("user").findOne({ _id: userId });
}

/** True when the account currently holds an unexpired Premium membership. */
export function isPremiumUser(user) {
  if (!user || user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return new Date(user.subscriptionExpiresAt).getTime() > Date.now();
}

/** Apply subscription expiry rules before exposing the user. */
export async function normalizeSubscription(user) {
  if (!user) return user;
  if (
    user.subscriptionPlan === "premium" &&
    user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt).getTime() < Date.now()
  ) {
    await col("user").updateOne(
      { _id: user._id },
      { $set: { subscriptionPlan: "free", subscriptionExpiresAt: null } },
    );
    user.subscriptionPlan = "free";
    user.subscriptionExpiresAt = null;
  }
  return user;
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Session expired, please sign in again" });
  }

  if (!payload.sid) {
    return res.status(401).json({ message: "Session expired, please sign in again" });
  }

  const userId = toObjectId(payload.sub);
  if (!userId) return res.status(401).json({ message: "Invalid session" });

  // Revoked sessions (sign-out, password change) must stop working immediately.
  const session = await col("session").findOne({
    token: payload.sid,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    return res.status(401).json({ message: "Session expired, please sign in again" });
  }

  const user = await col("user").findOne({ _id: userId });
  if (!user) return res.status(401).json({ message: "Account no longer exists" });
  if (user.isBlocked) {
    return res.status(403).json({
      message: "Your account has been blocked. Contact the Yesly concierge.",
    });
  }

  await normalizeSubscription(user);
  req.user = user;
  next();
}

export async function optionalAuthenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = toObjectId(payload.sub);
    if (userId) {
      const user = await col("user").findOne({ _id: userId });
      if (user && !user.isBlocked) {
        await normalizeSubscription(user);
        req.user = user;
      }
    }
  } catch {
    // Ignore invalid tokens for public endpoints.
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this resource" });
    }
    next();
  };
}

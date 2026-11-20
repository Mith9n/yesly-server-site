import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import {
  authenticate,
  normalizeSubscription,
  sessionTokenFromCookie,
  sessionUserFromCookie,
  signToken,
} from "../middleware/auth.js";

const router = express.Router();

export function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    image: user.image || null,
    role: user.role || "customer",
    isBlocked: Boolean(user.isBlocked),
    businessName: user.businessName || null,
    subscriptionPlan: user.subscriptionPlan || "free",
    subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    createdAt: user.createdAt,
  };
}

/**
 * Exchange a verified Better Auth session cookie for a short-lived platform
 * JWT. The role is read from the database, never from the browser.
 */
router.get("/session", async (req, res, next) => {
  try {
    const user = await sessionUserFromCookie(req);
    if (!user) {
      return res.status(401).json({ message: "No active session" });
    }
    if (user.isBlocked) {
      return res.status(403).json({
        message: "Your account has been blocked. Contact the Yesly concierge.",
      });
    }

    await normalizeSubscription(user);
    await col("user").updateOne(
      { _id: user._id, role: { $exists: false } },
      { $set: { role: "customer" } },
    );

    return res.json({
      token: signToken(user, sessionTokenFromCookie(req)),
      user: publicUser(user),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** Only safe, self-editable profile fields are accepted here. */
router.patch("/profile", authenticate, async (req, res, next) => {
  try {
    const { name, image, businessName } = req.body || {};
    const update = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      update.name = name.trim().slice(0, 120);
    }
    if (image !== undefined) {
      if (image !== null && (typeof image !== "string" || !/^https?:\/\//.test(image))) {
        return res.status(400).json({ message: "Profile image must be a valid URL" });
      }
      update.image = image;
    }
    if (businessName !== undefined) {
      if (req.user.role !== "vendor") {
        return res.status(403).json({ message: "Only vendors have a business name" });
      }
      update.businessName =
        typeof businessName === "string" ? businessName.trim().slice(0, 120) : null;
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    update.updatedAt = new Date();
    await col("user").updateOne({ _id: req.user._id }, { $set: update });

    const updated = await col("user").findOne({ _id: req.user._id });
    res.json({ user: publicUser(updated), message: "Profile updated" });
  } catch (err) {
    next(err);
  }
});

export default router;
export { ObjectId };

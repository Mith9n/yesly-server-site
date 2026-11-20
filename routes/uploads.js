import express from "express";
import { authenticate } from "../middleware/auth.js";
import { uploadImage } from "../utils/imgbb.js";

const router = express.Router();

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

router.post("/", authenticate, async (req, res, next) => {
  try {
    const url = await uploadImage(req.body?.image);
    res.status(201).json({ url, message: "Image uploaded" });
  } catch (err) {
    next(err);
  }
});

// Sign-up avatars are uploaded before a session exists. The route is rate
// limited in index.js and capped to small public images to limit abuse.
router.post("/avatar", async (req, res, next) => {
  try {
    const url = await uploadImage(req.body?.image, { maxBytes: AVATAR_MAX_BYTES });
    res.status(201).json({ url, message: "Image uploaded" });
  } catch (err) {
    next(err);
  }
});

export default router;

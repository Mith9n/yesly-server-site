import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import {
  authenticate,
  isPremiumUser,
  optionalAuthenticate,
  requireRole,
} from "../middleware/auth.js";

const router = express.Router();

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

export const FREE_SERVICE_LIMIT = 3;

const CATALOG_FIELDS = {
  businessName: 1,
  name: 1,
  image: 1,
  role: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
};

const MATERIAL_FIELDS = [
  "serviceName",
  "category",
  "description",
  "price",
  "location",
  "images",
];

/**
 * Count the services that take up a free vendor's quota. A listing counts when
 * it is active and has not been rejected by moderation — pending listings do
 * count, because they are already visible to the vendor's quota.
 */
export async function countActiveServices(vendorId, excludeId) {
  const filter = { vendorId, isActive: true, status: { $ne: "rejected" } };
  if (excludeId) filter._id = { $ne: excludeId };
  return col("service").countDocuments(filter);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function serializeService(service, vendor) {
  return {
    id: service._id.toString(),
    vendorId: service.vendorId.toString(),
    serviceName: service.serviceName,
    category: service.category,
    description: service.description,
    price: service.price,
    location: service.location,
    images: service.images || [],
    status: service.status,
    isActive: Boolean(service.isActive),
    createdAt: service.createdAt,
    vendor: vendor
      ? {
          id: vendor._id.toString(),
          name: vendor.businessName || vendor.name,
          contactName: vendor.name,
          image: vendor.image || null,
          businessName: vendor.businessName || vendor.name,
          premium: isPremiumUser(vendor),
        }
      : null,
  };
}

async function attachVendors(services) {
  if (!services.length) return [];
  const ids = [...new Set(services.map((s) => s.vendorId.toString()))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  const vendors = await col("user")
    .find({ _id: { $in: ids } })
    .project(CATALOG_FIELDS)
    .toArray();
  const map = new Map(vendors.map((v) => [v._id.toString(), v]));
  return services.map((s) => serializeService(s, map.get(s.vendorId.toString())));
}

function validateServicePayload(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || body.serviceName !== undefined) {
    const name = String(body.serviceName || "").trim();
    if (name.length < 3) errors.push("Service name must be at least 3 characters");
    out.serviceName = name.slice(0, 140);
  }
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) errors.push("Choose a valid service category");
    out.category = body.category;
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description || "").trim();
    if (description.length < 20) errors.push("Description must be at least 20 characters");
    out.description = description.slice(0, 4000);
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) errors.push("Price must be a positive number");
    out.price = price;
  }
  if (!partial || body.location !== undefined) {
    const location = String(body.location || "").trim();
    if (location.length < 2) errors.push("Location is required");
    out.location = location.slice(0, 140);
  }
  if (!partial || body.images !== undefined) {
    const images = Array.isArray(body.images)
      ? body.images.filter((src) => typeof src === "string" && /^https?:\/\//.test(src))
      : [];
    if (!images.length) errors.push("At least one service image is required");
    if (images.length > 6) errors.push("A service can have at most 6 images");
    out.images = images;
  }

  return { errors, out };
}

/* ----------------------------- Public routes ----------------------------- */

router.get("/categories", (_req, res) => {
  res.json({ categories: CATEGORIES });
});

router.get("/featured", async (_req, res, next) => {
  try {
    const services = await col("service")
      .find({ status: "approved", isActive: true })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();
    res.json({ services: await attachVendors(services) });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { search = "", category = "", location = "", sort = "newest", vendor = "" } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 9));

    const query = { status: "approved", isActive: true };
    if (category && category !== "All") query.category = category;
    if (vendor && ObjectId.isValid(String(vendor))) {
      query.vendorId = new ObjectId(String(vendor));
    }
    if (location && location !== "All") {
      // Anchored so the location index can serve prefix matches.
      query.location = { $regex: `^${escapeRegex(String(location))}`, $options: "i" };
    }
    if (String(search).trim()) {
      // Partial words matter: "photo" must find "Photography". Every term is
      // matched as a case-insensitive substring across the searchable fields,
      // and all terms must match (each one in at least one field).
      const terms = String(search).trim().split(/\s+/).filter(Boolean).slice(0, 5);
      query.$and = terms.map((term) => {
        const pattern = new RegExp(escapeRegex(term), "i");
        return {
          $or: [
            { serviceName: pattern },
            { category: pattern },
            { location: pattern },
            { description: pattern },
          ],
        };
      });
    }

    const sortMap = {
      "price-asc": { price: 1 },
      "price-desc": { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
    };

    const collection = col("service");
    const total = await collection.countDocuments(query);
    const services = await collection
      .find(query)
      .sort(sortMap[String(sort)] || sortMap.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.json({
      services: await attachVendors(services),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- Vendor routes ----------------------------- */

router.get("/vendor/mine", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    const services = await col("service")
      .find({ vendorId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ services: await attachVendors(services) });
  } catch (err) {
    next(err);
  }
});

router.get("/vendor/stats", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    const services = await col("service").find({ vendorId: req.user._id }).toArray();
    const bookings = await col("booking").find({ vendorId: req.user._id }).toArray();
    res.json({
      stats: {
        totalServices: services.length,
        activeServices: services.filter((s) => s.isActive).length,
        approvedServices: services.filter((s) => s.status === "approved").length,
        pendingServices: services.filter((s) => s.status === "pending").length,
        pendingBookings: bookings.filter((b) => b.status === "pending").length,
        acceptedBookings: bookings.filter((b) => b.status === "accepted").length,
        rejectedBookings: bookings.filter((b) => b.status === "rejected").length,
        totalBookings: bookings.length,
      },
      subscriptionPlan: isPremiumUser(req.user) ? "premium" : "free",
      subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
    });
  } catch (err) {
    next(err);
  }
});

// Registered after the static /vendor/* routes so "vendor" is never parsed as
// a service id.
router.get("/:id", optionalAuthenticate, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const service = await col("service").findOne({ _id: new ObjectId(req.params.id) });
    if (!service) return res.status(404).json({ message: "Service not found" });

    const isOwner =
      req.user && req.user._id.toString() === service.vendorId.toString();
    const isAdmin = req.user?.role === "admin";
    if (service.status !== "approved" || !service.isActive) {
      if (!isOwner && !isAdmin) {
        return res.status(404).json({
          message: "This service is not available",
        });
      }
    }

    const vendor = await col("user").findOne({ _id: service.vendorId });
    res.json({ service: serializeService(service, vendor) });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    const { errors, out } = validateServicePayload(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    if (!isPremiumUser(req.user)) {
      const activeCount = await countActiveServices(req.user._id);
      if (activeCount >= FREE_SERVICE_LIMIT) {
        return res.status(403).json({
          message:
            "Free vendors can publish up to 3 active services. Upgrade to Premium for unlimited listings.",
          code: "LIMIT_REACHED",
        });
      }
    }

    const now = new Date();
    const doc = {
      vendorId: req.user._id,
      ...out,
      status: "pending",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const result = await col("service").insertOne(doc);
    const created = await col("service").findOne({ _id: result.insertedId });
    res.status(201).json({
      service: serializeService(created, req.user),
      message: "Service submitted for review",
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const service = await col("service").findOne({ _id: new ObjectId(req.params.id) });
    if (!service) return res.status(404).json({ message: "Service not found" });
    if (service.vendorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only manage your own services" });
    }

    const body = req.body || {};
    const { errors, out } = validateServicePayload(body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be true or false" });
      }
      if (body.isActive && !service.isActive && !isPremiumUser(req.user)) {
        const activeCount = await countActiveServices(req.user._id);
        if (activeCount >= FREE_SERVICE_LIMIT) {
          return res.status(403).json({
            message:
              "Free vendors can publish up to 3 active services. Upgrade to Premium for unlimited listings.",
            code: "LIMIT_REACHED",
          });
        }
      }
      out.isActive = body.isActive;
    }

    // Editing an approved listing must go back through moderation, otherwise a
    // vendor could swap the price, photos and copy while keeping the badge.
    if (
      service.status === "approved" &&
      MATERIAL_FIELDS.some((field) => body[field] !== undefined)
    ) {
      out.status = "pending";
    }

    // Vendors may never approve their own listings.
    out.updatedAt = new Date();

    await col("service").updateOne({ _id: service._id }, { $set: out });
    const updated = await col("service").findOne({ _id: service._id });
    res.json({
      service: serializeService(updated, req.user),
      message: "Service updated",
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const service = await col("service").findOne({
      _id: new ObjectId(req.params.id),
      vendorId: req.user._id,
    });
    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    // Deleting a service with live requests would orphan the couple's booking.
    const activeBookings = await col("booking").countDocuments({
      serviceId: service._id,
      status: { $in: ["pending", "accepted"] },
    });
    if (activeBookings > 0) {
      return res.status(409).json({
        message:
          "This service has active booking requests. Cancel or resolve them before deleting it.",
        code: "ACTIVE_BOOKINGS",
      });
    }

    await col("service").deleteOne({ _id: service._id });
    res.json({ message: "Service deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;

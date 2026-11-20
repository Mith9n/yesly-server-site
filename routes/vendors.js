import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { isPremiumUser } from "../middleware/auth.js";
import { serializeService } from "./services.js";

const router = express.Router();

const PUBLIC_VENDOR_FIELDS = {
  name: 1,
  businessName: 1,
  image: 1,
  role: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a public vendor directory from approved, active services.
 * Vendors only appear once they have at least one published listing.
 *
 * Grouping, search, sorting and pagination all happen in MongoDB so the API
 * never loads the whole catalogue into Node memory.
 */
router.get("/", async (req, res, next) => {
  try {
    const category = String(req.query.category || "").trim();
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 48));

    const serviceFilter = { status: "approved", isActive: true };
    if (category && category !== "All") serviceFilter.category = category;

    const pipeline = [
      { $match: serviceFilter },
      {
        $group: {
          _id: "$vendorId",
          serviceCount: { $sum: 1 },
          categories: { $addToSet: "$category" },
          locations: { $addToSet: "$location" },
          fromPrice: { $min: "$price" },
          image: { $first: { $arrayElemAt: ["$images", 0] } },
          gallery: { $push: "$images" },
        },
      },
      {
        $lookup: {
          from: "user",
          localField: "_id",
          foreignField: "_id",
          as: "vendor",
          pipeline: [
            { $match: { role: "vendor" } },
            { $project: PUBLIC_VENDOR_FIELDS },
          ],
        },
      },
      { $unwind: "$vendor" },
    ];

    if (search) {
      const term = new RegExp(escapeRegex(search), "i");
      pipeline.push({
        $match: {
          $or: [
            { "vendor.name": term },
            { "vendor.businessName": term },
            { categories: term },
            { locations: term },
          ],
        },
      });
    }

    pipeline.push(
      {
        $addFields: {
          premium: {
            $and: [
              { $eq: ["$vendor.subscriptionPlan", "premium"] },
              {
                $or: [
                  { $eq: ["$vendor.subscriptionExpiresAt", null] },
                  { $gt: ["$vendor.subscriptionExpiresAt", new Date()] },
                ],
              },
            ],
          },
        },
      },
      { $sort: { premium: -1, serviceCount: -1, "vendor.name": 1 } },
      {
        $facet: {
          total: [{ $count: "count" }],
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        },
      },
    );

    const [result] = await col("service").aggregate(pipeline).toArray();
    const total = result?.total?.[0]?.count || 0;

    const vendors = (result?.rows || []).map((row) => ({
      id: row._id.toString(),
      name: row.vendor.businessName || row.vendor.name,
      contactName: row.vendor.name,
      image: row.vendor.image || row.image || null,
      // Portfolio frames for the four-image mosaic on each vendor card.
      images: [
        ...new Set((row.gallery || []).flat().filter(Boolean)),
      ].slice(0, 4),
      premium: Boolean(row.premium),
      categories: row.categories || [],
      locations: (row.locations || []).slice(0, 3),
      serviceCount: row.serviceCount,
      fromPrice: row.fromPrice ?? null,
    }));

    res.json({
      vendors,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    const vendor = await col("user").findOne(
      {
        _id: new ObjectId(req.params.id),
        role: "vendor",
      },
      { projection: PUBLIC_VENDOR_FIELDS },
    );
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const services = await col("service")
      .find({ vendorId: vendor._id, status: "approved", isActive: true })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      vendor: {
        id: vendor._id.toString(),
        name: vendor.businessName || vendor.name,
        contactName: vendor.name,
        image: vendor.image || null,
        premium: isPremiumUser(vendor),
        memberSince: vendor.createdAt || null,
      },
      services: services.map((service) => serializeService(service, vendor)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

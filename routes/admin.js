import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { authenticate, isPremiumUser, requireRole } from "../middleware/auth.js";
import { countActiveServices, FREE_SERVICE_LIMIT, serializeService } from "./services.js";

const router = express.Router();

router.use(authenticate, requireRole("admin"));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/stats", async (_req, res, next) => {
  try {
    const users = col("user");
    const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, revenueRows] =
      await Promise.all([
        users.countDocuments({}),
        users.countDocuments({ role: "vendor" }),
        users.countDocuments({ role: "customer" }),
        col("service").countDocuments({}),
        col("service").countDocuments({ status: "pending" }),
        col("transaction")
          .aggregate([
            { $match: { status: "paid" } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                total: { $sum: "$amount" },
              },
            },
          ])
          .toArray(),
      ]);

    const revenue = revenueRows[0] || { count: 0, total: 0 };

    res.json({
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalServices,
        pendingServices,
        totalTransactions: revenue.count,
        premiumTransactions: revenue.count,
        revenue: revenue.total || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const { search = "", role = "all" } = req.query;
    const query = {};
    if (role && role !== "all") query.role = role;
    if (String(search).trim()) {
      const term = new RegExp(escapeRegex(String(search).trim()), "i");
      query.$or = [{ name: term }, { email: term }];
    }

    const users = await col("user")
      .find(query)
      .project({ name: 1, email: 1, image: 1, role: 1, isBlocked: 1, businessName: 1, subscriptionPlan: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray();

    res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        image: u.image || null,
        role: u.role || "customer",
        isBlocked: Boolean(u.isBlocked),
        businessName: u.businessName || null,
        subscriptionPlan: u.subscriptionPlan || "free",
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = await col("user").findOne(
      { _id: new ObjectId(req.params.id) },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          isBlocked: 1,
          businessName: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
        },
      },
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    const [services, bookings] = await Promise.all([
      col("service").countDocuments({ vendorId: user._id }),
      col("booking").countDocuments({ customerId: user._id }),
    ]);

    res.json({
      user: {
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
        services,
        bookings,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id/block", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "User not found" });
    }
    const target = await col("user").findOne({ _id: new ObjectId(req.params.id) });
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot block your own admin account" });
    }
    if (target.role === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be blocked from here" });
    }
    if (typeof req.body?.isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be true or false" });
    }

    await col("user").updateOne(
      { _id: target._id },
      { $set: { isBlocked: req.body.isBlocked } },
    );
    res.json({
      message: req.body.isBlocked ? "User blocked" : "User unblocked",
      isBlocked: req.body.isBlocked,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/services", async (req, res, next) => {
  try {
    const { search = "", status = "all" } = req.query;
    const query = {};
    if (status !== "all") query.status = status;
    if (String(search).trim()) {
      const term = new RegExp(escapeRegex(String(search).trim()), "i");
      query.$or = [{ serviceName: term }, { category: term }, { location: term }];
    }

    const services = await col("service").find(query).sort({ createdAt: -1 }).limit(300).toArray();
    const vendorIds = [...new Set(services.map((s) => s.vendorId.toString()))]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const vendors = await col("user").find({ _id: { $in: vendorIds } }).toArray();
    const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

    res.json({
      services: services.map((service) =>
        serializeService(service, vendorMap.get(service.vendorId.toString())),
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/services/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const { status, isActive } = req.body || {};
    const update = { updatedAt: new Date() };

    if (status !== undefined) {
      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid service status" });
      }
      update.status = status;
    }
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be true or false" });
      }
      update.isActive = isActive;
    }
    if (Object.keys(update).length === 1) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const service = await col("service").findOne({ _id: new ObjectId(req.params.id) });
    if (!service) return res.status(404).json({ message: "Service not found" });

    // Admins can moderate freely, but they cannot let a free vendor hold more
    // active listings than the plan allows.
    const nextStatus = update.status ?? service.status;
    const nextActive = update.isActive ?? Boolean(service.isActive);
    if (nextStatus !== "rejected" && nextActive) {
      const vendor = await col("user").findOne({ _id: service.vendorId });
      if (vendor && !isPremiumUser(vendor)) {
        const activeCount = await countActiveServices(service.vendorId, service._id);
        if (activeCount >= FREE_SERVICE_LIMIT) {
          return res.status(403).json({
            message:
              "Free vendors can publish up to 3 active services. This vendor must upgrade to Premium before this listing can be activated.",
            code: "LIMIT_REACHED",
          });
        }
      }
    }

    const result = await col("service").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: "after" },
    );
    if (!result) return res.status(404).json({ message: "Service not found" });

    res.json({ message: "Service updated", service: serializeService(result, null) });
  } catch (err) {
    next(err);
  }
});

router.delete("/services/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Service not found" });
    }
    const result = await col("service").deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ message: "Service not found" });
    res.json({ message: "Service removed from the marketplace" });
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", async (_req, res, next) => {
  try {
    const transactions = await col("transaction").find({}).sort({ createdAt: -1 }).limit(300).toArray();
    const vendorIds = [...new Set(transactions.map((t) => t.vendorId?.toString()).filter(Boolean))]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const vendors = await col("user")
      .find({ _id: { $in: vendorIds } })
      .project({ businessName: 1, name: 1, email: 1 })
      .toArray();
    const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

    res.json({
      transactions: transactions.map((t) => {
        const vendor = vendorMap.get(t.vendorId?.toString());
        return {
          id: t._id.toString(),
          vendorId: t.vendorId?.toString(),
          vendorName: vendor?.businessName || vendor?.name || "Unknown vendor",
          vendorEmail: vendor?.email || null,
          plan: t.plan,
          amount: t.amount,
          currency: t.currency,
          status: t.status,
          stripeSessionId: t.stripeSessionId,
          createdAt: t.createdAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;

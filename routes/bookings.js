import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = express.Router();

function serializeBooking(booking) {
  return {
    id: booking._id.toString(),
    serviceId: booking.serviceId.toString(),
    vendorId: booking.vendorId.toString(),
    customerId: booking.customerId.toString(),
    serviceName: booking.serviceName,
    serviceImage: booking.serviceImage || null,
    serviceCategory: booking.serviceCategory || null,
    vendorName: booking.vendorName || null,
    customerName: booking.customerName || null,
    customerEmail: booking.customerEmail || null,
    customerImage: booking.customerImage || null,
    eventDate: booking.eventDate,
    eventLocation: booking.eventLocation,
    message: booking.message || "",
    status: booking.status,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

function validateBooking(body) {
  const errors = [];
  const eventDate = String(body.eventDate || "").trim();
  const eventLocation = String(body.eventLocation || "").trim();
  const message = String(body.message || "").trim();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!match) {
    errors.push("Choose a valid event date");
  } else {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const roundTrips =
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day;

    if (!roundTrips) {
      errors.push("Choose a real calendar date");
    } else {
      const today = new Date();
      const todayUtc = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      );
      if (parsed.getTime() < todayUtc) {
        errors.push("Event date cannot be in the past");
      }
    }
  }
  if (eventLocation.length < 3) errors.push("Event location is required");
  if (eventLocation.length > 200) errors.push("Event location is too long");
  if (message.length > 1000) errors.push("Message must be under 1000 characters");

  return { errors, eventDate, eventLocation, message };
}

router.get("/mine", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const bookings = await col("booking")
      .find({ customerId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (err) {
    next(err);
  }
});

router.get("/customer/stats", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const bookings = await col("booking").find({ customerId: req.user._id }).toArray();
    res.json({
      stats: {
        total: bookings.length,
        pending: bookings.filter((b) => b.status === "pending").length,
        accepted: bookings.filter((b) => b.status === "accepted").length,
        rejected: bookings.filter((b) => b.status === "rejected").length,
        cancelled: bookings.filter((b) => b.status === "cancelled").length,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const { serviceId } = req.body || {};
    if (!ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: "Select a valid service" });
    }

    const { errors, eventDate, eventLocation, message } = validateBooking(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const service = await col("service").findOne({ _id: new ObjectId(serviceId) });
    if (!service) return res.status(404).json({ message: "Service not found" });
    if (service.status !== "approved" || !service.isActive) {
      return res.status(400).json({ message: "This service is not available for booking" });
    }
    if (service.vendorId.toString() === req.user._id.toString()) {
      return res.status(403).json({ message: "You cannot book your own service" });
    }

    // A vendor can only serve one wedding per service on a given date, so the
    // clash is checked across all customers rather than per-customer.
    const duplicate = await col("booking").findOne({
      serviceId: service._id,
      eventDate,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res.status(409).json({
        message:
          "This service already has an active booking request on that date. Please choose another date.",
      });
    }

    const vendor = await col("user").findOne({ _id: service.vendorId });
    if (!vendor || vendor.isBlocked) {
      return res.status(400).json({ message: "This vendor is not accepting bookings" });
    }

    const now = new Date();
    const doc = {
      serviceId: service._id,
      vendorId: service.vendorId,
      customerId: req.user._id,
      eventDate,
      eventLocation,
      message,
      status: "pending",
      serviceName: service.serviceName,
      serviceImage: service.images?.[0] || null,
      serviceCategory: service.category,
      vendorName: vendor.businessName || vendor.name,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerImage: req.user.image || null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col("booking").insertOne(doc).catch((error) => {
      // The unique partial index is the final guard against two concurrent
      // requests for the same service and date.
      if (error?.code === 11000) {
        const conflict = new Error(
          "This service already has an active booking request on that date. Please choose another date.",
        );
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    });
    const created = await col("booking").findOne({ _id: result.insertedId });
    res.status(201).json({
      booking: serializeBooking(created),
      message: "Booking request submitted",
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/cancel", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Booking not found" });
    }
    const booking = await col("booking").findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.customerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only manage your own bookings" });
    }
    if (booking.status !== "pending") {
      return res.status(400).json({
        message: `A ${booking.status} booking can no longer be cancelled`,
      });
    }

    const result = await col("booking").updateOne(
      { _id: booking._id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } },
    );
    if (!result.modifiedCount) {
      return res.status(409).json({
        message: "This booking changed while you were cancelling it. Refresh and try again.",
      });
    }
    const updated = await col("booking").findOne({ _id: booking._id });
    res.json({ booking: serializeBooking(updated), message: "Booking cancelled" });
  } catch (err) {
    next(err);
  }
});

router.get("/vendor", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    const bookings = await col("booking")
      .find({ vendorId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/status", authenticate, requireRole("vendor"), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status must be accepted or rejected" });
    }
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = await col("booking").findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.vendorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "This booking does not belong to you" });
    }
    if (booking.status !== "pending") {
      return res.status(400).json({
        message: `This booking has already been ${booking.status}`,
      });
    }

    const result = await col("booking").updateOne(
      { _id: booking._id, status: "pending" },
      { $set: { status, updatedAt: new Date() } },
    );
    if (!result.modifiedCount) {
      return res.status(409).json({
        message: "Another response already resolved this request. Refresh to see the latest status.",
      });
    }
    const updated = await col("booking").findOne({ _id: booking._id });
    res.json({
      booking: serializeBooking(updated),
      message: `Booking ${status}`,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Booking not found" });
    }
    const booking = await col("booking").findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const owns =
      booking.customerId.toString() === req.user._id.toString() ||
      booking.vendorId.toString() === req.user._id.toString() ||
      req.user.role === "admin";
    if (!owns) return res.status(403).json({ message: "Access denied" });

    res.json({ booking: serializeBooking(booking) });
  } catch (err) {
    next(err);
  }
});

export default router;

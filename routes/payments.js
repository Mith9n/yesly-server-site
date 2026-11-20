import express from "express";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = express.Router();

export const PREMIUM_PRICE_CENTS = 9900;
export const PREMIUM_CURRENCY = "usd";
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]+$/;

async function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Premium can only be sold when the webhook is also configured. Otherwise the
 * customer pays and the membership can never be confirmed server-side.
 */
function paymentSetupIssue() {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return "Premium checkout is not available yet. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to the server environment.";
  }
  return null;
}

function clientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
}

function premiumExpiry(from = new Date()) {
  const expiresAt = new Date(from);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return expiresAt;
}

/** Idempotent Premium activation for a paid checkout session. */
async function activatePremium(vendorId, session) {
  const existing = await col("transaction").findOne({ stripeSessionId: session.id });
  if (existing) return true;

  const now = new Date();
  const transaction = {
    vendorId,
    plan: "premium",
    amount: (session.amount_total ?? PREMIUM_PRICE_CENTS) / 100,
    currency: session.currency || PREMIUM_CURRENCY,
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent || null,
    stripeSubscriptionId: session.subscription || null,
    status: "paid",
    createdAt: now,
  };

  try {
    await col("transaction").insertOne(transaction);
  } catch (error) {
    // A concurrent webhook/status call already wrote this session.
    if (error?.code === 11000) return true;
    throw error;
  }

  await col("user").updateOne(
    { _id: vendorId, role: "vendor" },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: premiumExpiry(now),
        updatedAt: now,
      },
    },
  );
  return true;
}

/** Refunds and disputes revoke Premium immediately. */
async function revokePremium(vendorId, paymentIntentId, status) {
  if (vendorId) {
    await col("user").updateOne(
      { _id: vendorId, role: "vendor" },
      {
        $set: {
          subscriptionPlan: "free",
          subscriptionExpiresAt: null,
          updatedAt: new Date(),
        },
      },
    );
  }
  if (paymentIntentId) {
    await col("transaction").updateOne(
      { stripePaymentIntentId: paymentIntentId },
      { $set: { status } },
    );
  }
}

function sessionBelongsToVendor(session, vendorId) {
  if (!session || !vendorId) return false;
  const owner =
    session.metadata?.vendorId || session.client_reference_id || null;
  return owner === vendorId;
}

/* --------------------------- Create checkout --------------------------- */

router.post(
  "/create-checkout-session",
  authenticate,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const setupIssue = paymentSetupIssue();
      if (setupIssue) {
        return res.status(503).json({ message: setupIssue });
      }

      const stripe = await getStripe();
      if (!stripe) {
        return res.status(503).json({ message: "Stripe is not configured on the server" });
      }

      const metadata = {
        vendorId: req.user._id.toString(),
        plan: "premium",
      };

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: req.user.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: PREMIUM_CURRENCY,
              unit_amount: PREMIUM_PRICE_CENTS,
              product_data: {
                name: "Yesly Premium Vendor — Annual Membership",
                description:
                  "Unlimited active services, premium vendor badge and priority discovery for 12 months.",
              },
            },
          },
        ],
        metadata,
        // Charge-level metadata lets refund and dispute events find the vendor.
        payment_intent_data: { metadata },
        success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl()}/payment/cancel`,
        client_reference_id: req.user._id.toString(),
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------- Status -------------------------------- */

router.get(
  "/status/:sessionId",
  authenticate,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      const sessionId = String(req.params.sessionId || "");
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return res.status(404).json({ message: "Checkout session not found" });
      }

      const stripe = await getStripe();
      if (!stripe) {
        return res.status(503).json({ message: "Stripe is not configured on the server" });
      }

      const vendorId = req.user._id.toString();
      const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
      if (!session || !sessionBelongsToVendor(session, vendorId)) {
        return res.status(404).json({ message: "Checkout session not found" });
      }

      // Fallback for a missed webhook: a paid session is enough to activate.
      if (
        session.payment_status === "paid" &&
        session.metadata?.plan === "premium" &&
        session.amount_total === PREMIUM_PRICE_CENTS &&
        (session.currency || PREMIUM_CURRENCY) === PREMIUM_CURRENCY
      ) {
        await activatePremium(req.user._id, session);
      }

      const user = await col("user").findOne({ _id: req.user._id });
      res.json({
        sessionId: session.id,
        paymentStatus: session.payment_status,
        plan: session.metadata?.plan,
        subscriptionPlan: user?.subscriptionPlan || "free",
        subscriptionExpiresAt: user?.subscriptionExpiresAt || null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------- Webhook -------------------------------- */

export async function stripeWebhook(req, res) {
  const stripe = await getStripe();
  if (!stripe) {
    return res.status(503).json({ message: "Stripe is not configured on the server" });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ message: "Stripe webhook secret is not configured" });
  }

  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status !== "paid") {
        return res.json({ received: true, activated: false });
      }

      const vendorId = session.metadata?.vendorId;
      if (!vendorId || !ObjectId.isValid(vendorId)) {
        return res.json({ received: true, activated: false });
      }

      // Never trust the metadata alone: the money must match the product.
      const correctPlan = session.metadata?.plan === "premium";
      const correctAmount = session.amount_total === PREMIUM_PRICE_CENTS;
      const correctCurrency =
        (session.currency || PREMIUM_CURRENCY) === PREMIUM_CURRENCY;
      if (!correctPlan || !correctAmount || !correctCurrency) {
        console.warn(
          `Stripe webhook rejected a mismatched checkout: plan=${session.metadata?.plan} amount=${session.amount_total} currency=${session.currency}`,
        );
        return res.json({ received: true, activated: false });
      }

      await activatePremium(new ObjectId(vendorId), session);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const vendorId = session.metadata?.vendorId;
      if (vendorId && ObjectId.isValid(vendorId)) {
        await col("transaction").updateOne(
          { stripeSessionId: session.id },
          {
            $setOnInsert: {
              vendorId: new ObjectId(vendorId),
              plan: "premium",
              amount: (session.amount_total ?? PREMIUM_PRICE_CENTS) / 100,
              currency: session.currency || PREMIUM_CURRENCY,
              status: "failed",
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      }
    }

    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const charge = event.data.object;
      const vendorId = charge.metadata?.vendorId;
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      const status = event.type === "charge.refunded" ? "refunded" : "disputed";
      await revokePremium(
        vendorId && ObjectId.isValid(vendorId) ? new ObjectId(vendorId) : null,
        paymentIntentId,
        status,
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handling error:", err);
    res.status(500).json({ message: "Webhook processing failed" });
  }
}

export default router;

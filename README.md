# Yesly — Wedding Planning Platform (Server)

Express.js + MongoDB API for **Yesly**, a wedding planning marketplace where couples
request bookings from curated vendors, vendors manage services and subscriptions, and
admins moderate the platform.

This repository is the **API server**. The Next.js client lives in [yesly-client-site](https://github.com/Mith9n/yesly-client-site).

## Features

- Better Auth session exchange for short-lived platform JWTs (`GET /api/auth/session`).
- JWT verification middleware, role middleware and blocked-account enforcement on every
  protected request.
- Public service discovery with backend search, category/location filters, price sorting and
  pagination. Only **approved + active** services are public.
- Vendor service CRUD with ownership checks and the free-plan limit of **3 active services**
  enforced server-side. Premium vendors are unlimited.
- Booking lifecycle: create (customer only), accept/reject (owning vendor, pending only),
  cancel (owning customer, pending only), duplicate active booking prevention, and a
  self-booking guard.
- Admin APIs: user search/filter, block/unblock, service approval/moderation/deletion,
  platform statistics and a read-only transaction ledger.
- Stripe Checkout session creation and a signature-verified webhook that activates Premium.
- ImgBB uploads for service and profile images.
- Profile updates accept only safe fields — role and subscription can never be self-edited.
- Consistent `400 / 401 / 403 / 404` responses and JSON error messages.

## Technology Stack

- Node.js + Express 5 (ES modules)
- MongoDB (official driver)
- JSON Web Tokens (`jsonwebtoken`)
- Stripe Checkout + webhooks
- ImgBB image hosting

## Collections

| Collection | Purpose |
| --- | --- |
| `user` | Better Auth users plus `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt` |
| `session` / `account` | Managed by Better Auth |
| `service` | `vendorId`, `serviceName`, `category`, `description`, `price`, `location`, `images`, `status`, `isActive`, `createdAt` |
| `booking` | `serviceId`, `vendorId`, `customerId`, `eventDate`, `eventLocation`, `message`, `status`, `createdAt` |
| `transaction` | `vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt` |

## Environment Variables

Create `.env` (never commit it). See `.env.example`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://user:password@cluster/...
AUTH_DB_NAME=YESLY-Databse
CLIENT_URL=http://localhost:3000
PUBLIC_API_URL=http://localhost:5000
JWT_SECRET=your-long-random-secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
IMGBB_API_KEY=...
SHOWCASE_PASSWORD=      # only needed for node seed-showcase.js
```

`NODE_ENV=development` lets the API start without `JWT_SECRET` (it generates an
ephemeral key); production requires a real `JWT_SECRET` or the server exits.

`AUTH_DB_NAME` must match the client's database because the API reads Better Auth sessions
from it.

## Installation and Run

```bash
npm install
npm run dev     # node --watch on PORT (default 5000)
npm start       # production
```

Health check: `GET http://localhost:5000/api/health`

## Admin Account

Admin accounts cannot be created by public registration. Register normally in the client,
then promote the account from the server:

```bash
npm run seed:admin -- admin@example.com
```

The account must sign in again to receive the admin role in its session token.

## Demo Catalog

Six approved services (with a demo vendor profile) for local UI review:

```bash
npm run seed:demo
```

The demo catalog only seeds when the `service` collection is empty.

Full showcase catalog (five vendor accounts, seventeen published listings). It creates real
Better Auth accounts, so set `SHOWCASE_PASSWORD` first:

```bash
SHOWCASE_PASSWORD=choose-a-password node seed-showcase.js
```

## API Overview

### Auth
| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/auth/session` | Better Auth cookie → JWT + profile |
| GET | `/api/auth/me` | Authenticated |
| PATCH | `/api/auth/profile` | Authenticated (name, image, businessName only) |

### Uploads
| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/uploads` | Authenticated (service and profile images) |
| POST | `/api/uploads/avatar` | Public, rate limited (sign-up avatar, max 2 MB) |

### Services
| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/services` | Public (`search`, `category`, `location`, `vendor`, `sort`, `page`, `limit`) |
| GET | `/api/services/featured` | Public (6 latest approved/active) |
| GET | `/api/services/categories` | Public (canonical category list) |
| GET | `/api/services/:id` | Public for approved + active listings; owners/admins also see their own pending ones |
| GET | `/api/services/vendor/mine` | Vendor |
| GET | `/api/services/vendor/stats` | Vendor |
| POST | `/api/services` | Vendor (free limit enforced) |
| PATCH | `/api/services/:id` | Owning vendor |
| DELETE | `/api/services/:id` | Owning vendor |

### Vendors
| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/vendors` | Public (`category`, `search`, `page`, `limit`) |
| GET | `/api/vendors/:id` | Public (vendor profile + published listings) |

### Bookings
| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/bookings` | Customer |
| GET | `/api/bookings/mine` | Customer |
| GET | `/api/bookings/customer/stats` | Customer |
| PATCH | `/api/bookings/:id/cancel` | Owning customer, pending only |
| GET | `/api/bookings/vendor` | Vendor |
| PATCH | `/api/bookings/:id/status` | Owning vendor, pending only |
| GET | `/api/bookings/:id` | Owner vendor/customer or admin |

### Admin
`GET /api/admin/stats`, `GET /api/admin/users`, `GET /api/admin/users/:id`,
`PATCH /api/admin/users/:id/block`, `GET /api/admin/services`,
`PATCH /api/admin/services/:id`, `DELETE /api/admin/services/:id`,
`GET /api/admin/transactions`.

### Payments
| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/payments/create-checkout-session` | Vendor |
| GET | `/api/payments/status/:sessionId` | Owning vendor (read-only) |
| POST | `/api/payments/webhook` | Stripe signature only |

The deployed client creates its Checkout session in its own Next.js route handler
(`/api/checkout_sessions` on the client host); this API endpoint remains available for
API-only clients and shares the same webhook for activation.

## Payment Security

- Premium is activated **only** inside the signature-verified
  `checkout.session.completed` webhook with `payment_status === "paid"`.
- Webhook route uses the raw request body before the JSON parser.
- Transactions are idempotent per Stripe session id.
- The success redirect never activates Premium, and admins cannot edit transactions.
- Expired memberships are downgraded to `free` on the next authenticated request.

Local webhook testing:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

## Live Website

- API — https://yesly-server-site.vercel.app (health check: `/api/health`)
- Client — https://yesly-client-site.vercel.app

## Repositories

- Server — https://github.com/Mith9n/yesly-server-site
- Client — https://github.com/Mith9n/yesly-client-site

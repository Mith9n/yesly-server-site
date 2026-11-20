import "dotenv/config";
import { connectDB, col } from "./db.js";

/**
 * Yesly showcase seed — five vendor accounts and seventeen published listings
 * in a single file.
 *
 *   1. premium photography house .... 7 listings
 *   2. wedding venue ............... 3 listings
 *   3. florist / decor ............. 3 listings
 *   4. catering .................... 3 listings
 *   5. wedding fashion ............. 1 listing
 *
 * Every listing carries four gallery images. All 68 images across the whole
 * showcase are unique — no listing, and no vendor, shares an image with any
 * other. Each vendor owns exactly one category so the directory reads as a
 * curated guild rather than a dump.
 *
 * Accounts are created through the real Better Auth sign-up endpoint so the
 * password hash verifies through /sign-in/email. Listings are inserted
 * directly as approved + active, which is what the public directory requires.
 *
 * Idempotent: re-running never duplicates users or listings, and refreshes
 * listing images to the set below.
 *
 * Usage: set SHOWCASE_PASSWORD in the environment, then run node seed-showcase.js.
 */

const PASSWORD = process.env.SHOWCASE_PASSWORD;
const SIGNUP_URL = "http://localhost:3000/api/auth/sign-up/email";
const ORIGIN = "http://localhost:3000";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const img = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

const VENDORS = [
  {
    name: "Naomi Hart",
    email: "naomi@velvethour.com",
    businessName: "Velvet Hour Studios",
    premium: true,
    services: [
      {
        serviceName: "Editorial Wedding Day Coverage",
        category: "Photography & Videography",
        description:
          "A full day of documentary coverage cut with an editorial eye, delivered as a gallery of 600+ retouched frames within six weeks.",
        price: 4200,
        location: "San Francisco, CA",
        images: [
          img("1511285560929-80b456fea0bc"),
          img("1583939411023-14783179e581"),
          img("1537633552985-df8429e8048b"),
          img("1550005809-91ad75fb315f"),
        ],
      },
      {
        serviceName: "Fine Art Bridal Portraits",
        category: "Photography & Videography",
        description:
          "A quiet morning session before the ceremony — soft light, gentle grain and portraits made to feel like magazine pages.",
        price: 2400,
        location: "Napa, CA",
        images: [
          img("1519741497674-611481863552"),
          img("1529626455594-4ff0802cfb7e"),
          img("1522337360788-8b13dee7a37e"),
          img("1512496015851-a90fb38ba796"),
        ],
      },
      {
        serviceName: "Golden Hour Couple Session",
        category: "Photography & Videography",
        description:
          "Ninety minutes at sunset, directed and unhurried, with fifteen signature frames edited in warm, timeless tones.",
        price: 950,
        location: "Big Sur, CA",
        images: [
          img("1591604466107-ec97de577aff"),
          img("1494774157365-9e04c6720e47"),
          img("1516589178581-6cd7833ae3b2"),
          img("1474552226712-ac0f0961a954"),
        ],
      },
      {
        serviceName: "Ceremony & Reception Film",
        category: "Photography & Videography",
        description:
          "Two cinematographers, dual audio and a five-minute highlight film that carries the whole arc of the day.",
        price: 3800,
        location: "Sonoma, CA",
        images: [
          img("1519671482749-fd09be7ccebf"),
          img("1492684223066-81342ee5ff30"),
          img("1517457373958-b7bdd4587205"),
          img("1583939003579-730e3918a45a"),
        ],
      },
      {
        serviceName: "Engagement Story Session",
        category: "Photography & Videography",
        description:
          "An engagement shoot in a place that matters to you, delivered as forty edited images and a complete save-the-date set.",
        price: 1500,
        location: "Oakland, CA",
        images: [
          img("1520854221256-17451cc331bf"),
          img("1532712938310-34cb3982ef74"),
          img("1606216794074-735e91aa2c92"),
          img("1546032996-6dfacbacbf3f"),
        ],
      },
      {
        serviceName: "Black & White Film Add-On",
        category: "Photography & Videography",
        description:
          "A dedicated monochrome pass of your day — grain, contrast and candids that age slowly and gracefully.",
        price: 1200,
        location: "San Francisco, CA",
        images: [
          img("1460978812857-470ed1c77af0"),
          img("1549416878-b9ca95e26903"),
          img("1529333166437-7750a6dd5a70"),
          img("1478146896981-b80fe463b330"),
        ],
      },
      {
        serviceName: "Rings & Details Storyboard",
        category: "Photography & Videography",
        description:
          "A close study of the small things — rings, invitations, florals and heirlooms arranged as a still-life series.",
        price: 1800,
        location: "Palo Alto, CA",
        images: [
          img("1465495976277-4387d4b0b4c6"),
          img("1515934751635-c81c6bc9a2d8"),
          img("1606800052052-a08af7148866"),
          img("1529634806980-85c3dd6d34ac"),
        ],
      },
    ],
  },
  {
    name: "Theo Laurent",
    email: "theo@glasshouse-estate.com",
    businessName: "The Glasshouse Estate",
    services: [
      {
        serviceName: "The Grand Ballroom",
        category: "Wedding Venues",
        description:
          "A chandelier-lit ballroom seating 180 guests, with a marble foyer for cocktails and a resident event captain.",
        price: 14500,
        location: "Healdsburg, CA",
        images: [
          img("1519167758481-83f550bb49b3"),
          img("1464366400600-7168b8af9bc3"),
          img("1517248135467-4c7edcad34c4"),
          img("1600607687939-ce8a6c25118c"),
        ],
      },
      {
        serviceName: "Garden Ceremony Lawn",
        category: "Wedding Venues",
        description:
          "An open lawn framed by oaks for ceremonies of up to 120, with a wet-weather conservatory always on standby.",
        price: 8500,
        location: "Healdsburg, CA",
        images: [
          img("1522673607200-164d1b6ce486"),
          img("1600585154340-be6161a56a0c"),
          img("1560448204-e02f11c3d0e2"),
          img("1505693416388-ac5ce068fe85"),
        ],
      },
      {
        serviceName: "Reception Hall & Tablescape",
        category: "Wedding Venues",
        description:
          "A candlelit reception hall with long-table styling, in-house linen service and a private suite for the couple.",
        price: 6400,
        location: "Glen Ellen, CA",
        images: [
          img("1519225421980-715cb0215aed"),
          img("1522708323590-d24dbb6b0267"),
          img("1586023492125-27b2c045efd7"),
          img("1470217957101-da7150b9b681"),
        ],
      },
    ],
  },
  {
    name: "Iris Delacroix",
    email: "iris@fernandfold.com",
    businessName: "Fern & Fold Atelier",
    services: [
      {
        serviceName: "Ceremony Floral Arch",
        category: "Decoration & Florist",
        description:
          "A sculptural arch built on site from seasonal blooms and foliage, dismantled the same evening by our own team.",
        price: 2800,
        location: "Portland, OR",
        images: [
          img("1523438885200-e635ba2c371e"),
          img("1502635385003-ee1e6a1a742d"),
          img("1462275646964-a0e3386b89fa"),
          img("1490750967868-88aa4486c946"),
        ],
      },
      {
        serviceName: "Bridal Bouquets & Buttonholes",
        category: "Decoration & Florist",
        description:
          "Hand-tied bouquets and buttonholes in your palette, sourced fresh the morning of the wedding.",
        price: 950,
        location: "Portland, OR",
        images: [
          img("1487530811176-3780de880c2d"),
          img("1526047932273-341f2a7631f9"),
          img("1518895949257-7621c3c786d7"),
          img("1471899236350-e3016bf1e69e"),
        ],
      },
      {
        serviceName: "Tablescape & Aisle Florals",
        category: "Decoration & Florist",
        description:
          "Low runners, bud vases and aisle markers designed as one composition across the whole room.",
        price: 1900,
        location: "Seattle, WA",
        images: [
          img("1529636798458-92182e662485"),
          img("1525258946800-98cfd641d0de"),
          img("1525772764200-be829a350797"),
          img("1507504031003-b417219a0fde"),
        ],
      },
    ],
  },
  {
    name: "Priya Sen",
    email: "priya@saltandmarigold.com",
    businessName: "Salt & Marigold",
    services: [
      {
        serviceName: "Grand Wedding Buffet",
        category: "Catering Services",
        description:
          "A five-station buffet with a live carving counter, dietary-friendly plates and butler-passed canapés during cocktails.",
        price: 145,
        location: "Chicago, IL",
        images: [
          img("1555244162-803834f70033"),
          img("1540189549336-e6e99c3679fe"),
          img("1476224203421-9ac39bcb3327"),
          img("1510812431401-41d2bd2722f3"),
        ],
      },
      {
        serviceName: "Plated Fine Dining Service",
        category: "Catering Services",
        description:
          "A three-course plated dinner with paired wines, uniformed service staff and a private tasting for two beforehand.",
        price: 165,
        location: "Chicago, IL",
        images: [
          img("1551218808-94e220e084d2"),
          img("1414235077428-338989a2e8c0"),
          img("1467003909585-2f8a72700288"),
          img("1504674900247-0877df9cc836"),
        ],
      },
      {
        serviceName: "Wedding Cake & Dessert Table",
        category: "Catering Services",
        description:
          "A tiered buttercream cake plus a dessert table of petit fours, built around your flavours and colours.",
        price: 95,
        location: "Evanston, IL",
        images: [
          img("1535254973040-607b474cb50d"),
          img("1547592180-85f173990554"),
          img("1511795409834-ef04bbd61622"),
          img("1522413452208-996ff3f3e740"),
        ],
      },
    ],
  },
  {
    name: "Sofia Reyes",
    email: "sofia@ivorythread.com",
    businessName: "Ivory Thread Couture",
    services: [
      {
        serviceName: "Custom Bridal Gowns",
        category: "Wedding Fashion",
        description:
          "Made-to-measure gowns from first sketch to final fitting, with three alterations included and a nine-month timeline.",
        price: 4800,
        location: "New York, NY",
        // Bridal / womenswear only — this house must never show menswear.
        images: [
          img("1548313093-370cf4ba3892"),
          img("1622277430358-f4d134452e2e"),
          img("1761116065261-586acfd09b7f"),
          img("1540459920617-415d62f1f76b"),
        ],
      },
    ],
  },
];

/** Sign a new vendor up through the live Better Auth endpoint. */
async function signUp(payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(SIGNUP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        referer: `${ORIGIN}/sign-up`,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 429 && attempt < 3) {
      console.log(`  rate limited on sign-up, waiting 62s (attempt ${attempt})`);
      await sleep(62_000);
      continue;
    }
    return res;
  }
  throw new Error(`Sign-up rate limited for ${payload.email}`);
}

/** Ensure the vendor account exists and carries the showcase fields. */
async function ensureVendor(vendor) {
  let user = await col("user").findOne({ email: vendor.email });

  if (!user) {
    const res = await signUp({
      name: vendor.name,
      email: vendor.email,
      password: PASSWORD,
      role: "vendor",
      businessName: vendor.businessName,
    });
    const body = await res.text();
    if (!res.ok && res.status !== 422) {
      throw new Error(`Sign-up failed for ${vendor.email}: ${res.status} ${body.slice(0, 200)}`);
    }
    user = await col("user").findOne({ email: vendor.email });
    if (!user) throw new Error(`Sign-up did not create ${vendor.email}`);
    console.log(`  created account ${vendor.email}`);
  } else {
    console.log(`  account exists  ${vendor.email}`);
  }

  const update = {
    role: "vendor",
    isBlocked: false,
    emailVerified: true,
    businessName: vendor.businessName,
    updatedAt: new Date(),
  };
  if (vendor.premium) {
    update.subscriptionPlan = "premium";
    update.subscriptionExpiresAt = null;
  }
  await col("user").updateOne({ _id: user._id }, { $set: update });
  return user._id;
}

/** Insert missing listings and refresh images on existing ones. */
async function ensureServices(vendorId, services) {
  let created = 0;
  let refreshed = 0;
  for (const service of services) {
    const existing = await col("service").findOne({
      vendorId,
      serviceName: service.serviceName,
    });

    if (!existing) {
      const now = new Date();
      await col("service").insertOne({
        vendorId,
        ...service,
        status: "approved",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
      continue;
    }

    const sameImages =
      JSON.stringify(existing.images || []) === JSON.stringify(service.images);
    if (!sameImages || existing.status !== "approved" || !existing.isActive) {
      await col("service").updateOne(
        { _id: existing._id },
        {
          $set: {
            images: service.images,
            status: "approved",
            isActive: true,
            updatedAt: new Date(),
          },
        },
      );
      refreshed += 1;
    }
  }
  return { created, refreshed };
}

async function main() {
  if (!PASSWORD) {
    throw new Error("SHOWCASE_PASSWORD must be set before running the showcase seed");
  }

  // Fail fast if the showcase data drifted out of sync with the API rules.
  for (const vendor of VENDORS) {
    for (const service of vendor.services) {
      if (!CATEGORIES.includes(service.category)) {
        throw new Error(`Unknown category on ${service.serviceName}`);
      }
      if (service.images.length !== 4) {
        throw new Error(`Expected 4 images on ${service.serviceName}`);
      }
    }
  }

  await connectDB();
  console.log("Seeding Yesly showcase vendors...");

  let totalCreated = 0;
  let totalRefreshed = 0;
  for (const vendor of VENDORS) {
    console.log(`\n${vendor.businessName} (${vendor.services.length} listings)`);
    const vendorId = await ensureVendor(vendor);
    const { created, refreshed } = await ensureServices(vendorId, vendor.services);
    totalCreated += created;
    totalRefreshed += refreshed;
    console.log(`  listings added: ${created} | refreshed: ${refreshed}`);
    // Stay under the Better Auth sign-up rate budget.
    await sleep(4000);
  }

  // ---- Verify: accounts, listings, galleries and image uniqueness ---------
  const users = await col("user")
    .find({ email: { $in: VENDORS.map((v) => v.email) } })
    .toArray();
  const vendorIds = users.map((u) => u._id.toString());
  const services = await col("service")
    .find({ status: "approved", isActive: true })
    .toArray();
  // Only this seed's listings are asserted; other real vendor posts are left
  // untouched and simply excluded from the showcase checks.
  const showcase = services.filter((s) => vendorIds.includes(s.vendorId.toString()));
  const allImages = showcase.flatMap((s) => s.images || []);
  const duplicates = allImages.filter(
    (url, index) => allImages.indexOf(url) !== index,
  );
  const wrongGallery = showcase.filter((s) => (s.images || []).length !== 4);

  console.log("\n---- verification ----");
  console.log(`vendors found: ${users.length}/${VENDORS.length}`);
  for (const vendor of VENDORS) {
    const user = users.find((u) => u.email === vendor.email);
    const listings = showcase.filter(
      (s) => user && s.vendorId.toString() === user._id.toString(),
    );
    const images = listings.flatMap((s) => s.images || []);
    console.log(
      `  ${vendor.businessName.padEnd(24)} role=${user?.role} verified=${user?.emailVerified} plan=${user?.subscriptionPlan} listings=${listings.length} images=${images.length} unique=${new Set(images).size}`,
    );
  }
  console.log(`showcase listings: ${showcase.length}/17`);
  console.log(`total images: ${allImages.length}/68`);
  console.log(`unique images: ${new Set(allImages).size}/${allImages.length}`);
  console.log(`duplicates: ${duplicates.length}`);
  console.log(`galleries not sized 4: ${wrongGallery.length}`);
  console.log(`created this run: ${totalCreated} | refreshed: ${totalRefreshed}`);
  console.log(`other approved listings (not seeded here): ${services.length - showcase.length}`);

  const ok =
    users.length === VENDORS.length &&
    showcase.length === 17 &&
    allImages.length === 68 &&
    duplicates.length === 0 &&
    wrongGallery.length === 0 &&
    users.every((u) => u.role === "vendor" && u.emailVerified);
  console.log(`\nVERIFY: ${ok ? "PASS" : "CHECK MANUALLY"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`Showcase seed failed: ${err.message}`);
  process.exit(1);
});

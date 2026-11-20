import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.AUTH_DB_NAME || process.env.DB_NAME || "YESLY-Databse";
const categories = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

const demoVendors = [
  {
    name: "Elena Rostova",
    businessName: "Céleste Fine Art Photography",
    location: "San Francisco, CA",
    category: categories[0],
    price: 3800,
    image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
    description:
      "Documentary-led fine art photography and cinema informed by European editorial magazines, with archival print delivery and master colour grading.",
    serviceName: "Céleste Editorial Wedding Photography & Cinema",
  },
  {
    name: "Château Reverie",
    businessName: "Château Reverie Estate",
    location: "Carmel Valley, CA",
    category: categories[1],
    price: 8500,
    image: "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=80",
    description:
      "An intimate limestone sanctuary with rolling vineyard vistas, heritage olive groves and Michelin-ready alfresco pavilions for up to 180 guests.",
    serviceName: "Elysian Manor Estate & Gardens",
  },
  {
    name: "Maison Florale",
    businessName: "Maison Florale",
    location: "Sonoma, CA",
    category: categories[2],
    price: 2400,
    image: "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=1200&q=80",
    description:
      "Poetic floral architecture featuring slow-grown regional heirloom blooms, hanging chandeliers and bespoke centrepiece styling.",
    serviceName: "Botanica Bespoke Floral Installations",
  },
  {
    name: "Julien Laurent",
    businessName: "Chef Julien Laurent",
    location: "Napa, CA",
    category: categories[3],
    price: 95,
    image: "https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=1200&q=80",
    description:
      "Seven-course degustation wedding dinners, organic estate pairings and sculptural sugar confectionery crafted by Parisian chefs.",
    serviceName: "Lumière Haute Pâtisserie & Banquets",
  },
  {
    name: "Atelier Vivienne",
    businessName: "Atelier Vivienne",
    location: "Los Angeles, CA",
    category: categories[5],
    price: 4200,
    image: "https://images.unsplash.com/photo-1594552072238-b8a33785b261?auto=format&fit=crop&w=1200&q=80",
    description:
      "Hand-embroidered bridal silhouettes and custom veil tailoring crafted from certified French silk organza and sustainable Italian textiles.",
    serviceName: "Aura Bridal Couture & Styling",
  },
  {
    name: "Camille Dubois",
    businessName: "Camille Dubois Makeup",
    location: "Beverly Hills, CA",
    category: categories[4],
    price: 650,
    image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80",
    description:
      "Effortless red-carpet beauty designed to photograph cleanly under bright sunlit ceremonies and warm candlelight receptions.",
    serviceName: "Gilded Radiance Bridal Artistry",
  },
];

async function main() {
  if (!uri) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const existing = await db.collection("service").countDocuments({});
  if (existing > 0) {
    console.log(`Services already exist (${existing}). Skipping demo seed.`);
    await client.close();
    return;
  }

  let vendor = await db.collection("user").findOne({ role: "vendor" });
  if (!vendor) {
    const now = new Date();
    const result = await db.collection("user").insertOne({
      name: "Yesly Demo Atelier",
      email: "demo.vendor@yesly.com",
      emailVerified: true,
      image: null,
      role: "vendor",
      isBlocked: false,
      businessName: "Yesly Demo Atelier",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    vendor = await db.collection("user").findOne({ _id: result.insertedId });
    console.log("Created demo vendor profile (auth account not attached).");
  }

  const now = new Date();
  const services = demoVendors.map((item, index) => ({
    vendorId: vendor._id,
    serviceName: item.serviceName,
    category: item.category,
    description: item.description,
    price: item.price,
    location: item.location,
    images: [item.image],
    status: "approved",
    isActive: true,
    createdAt: new Date(now.getTime() - index * 86400000),
    updatedAt: now,
  }));

  await db.collection("service").insertMany(services);
  console.log(`Seeded ${services.length} approved services into ${dbName}.`);
  await client.close();
}

main().catch((err) => {
  console.error("Demo seed failed:", err.message);
  process.exit(1);
});

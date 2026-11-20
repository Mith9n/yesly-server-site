import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 6 * 1024 * 1024;

// Images that cannot reach ImgBB live here and are served by express.static.
export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

const EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function publicBaseUrl() {
  const configured = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");
  // A shell that exports PORT=0 would otherwise hand the client an unusable
  // http://localhost:0/uploads/... URL, so only a positive port is trusted.
  const port = Number(process.env.PORT);
  const resolvedPort = Number.isInteger(port) && port > 0 ? port : 5000;
  return `http://localhost:${resolvedPort}`;
}

/** Persist the image on this server and return a URL the client can render. */
async function saveLocally(base64, extension) {
  const buffer = Buffer.from(base64, "base64");
  const digest = createHash("sha1").update(buffer).digest("hex").slice(0, 24);
  const name = `${Date.now().toString(36)}-${digest}.${extension}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  return `${publicBaseUrl()}/uploads/${name}`;
}

async function uploadToImgbb(base64) {
  const form = new FormData();
  form.append("image", base64);
  form.append("name", `yesly-${Date.now()}`);

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    { method: "POST", body: form },
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const error = new Error(
      payload?.error?.message || "Image upload failed, please try again",
    );
    error.status = 502;
    throw error;
  }

  return payload.data.display_url || payload.data.url;
}

export async function uploadImage(dataUrl, { maxBytes = MAX_BYTES } = {}) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl || "",
  );
  if (!match) {
    const error = new Error("Please upload a valid PNG, JPG, WEBP or GIF image");
    error.status = 400;
    throw error;
  }

  const [, mime, base64] = match;
  if (Buffer.byteLength(base64, "base64") > maxBytes) {
    const error = new Error(
      `Image must be smaller than ${Math.round(maxBytes / (1024 * 1024))}MB`,
    );
    error.status = 400;
    throw error;
  }

  // Files written to this server's disk disappear on an ephemeral host, so
  // production never falls back to local storage: returning a URL that 404s
  // after the next deploy is worse than a clear, visible failure.
  const isProduction = process.env.NODE_ENV === "production";

  if (process.env.IMGBB_API_KEY) {
    try {
      return await uploadToImgbb(base64);
    } catch (err) {
      if (isProduction) {
        console.error(`[uploads] ImgBB upload failed: ${err.message}`);
        const error = new Error(
          `Image storage is unavailable right now (${err.message}). Please try again in a few minutes.`,
        );
        error.status = 502;
        throw error;
      }
      console.warn(
        `[uploads] ImgBB upload failed (${err.message}); storing the image locally instead (development only).`,
      );
    }
  } else if (isProduction) {
    const error = new Error(
      "Image uploads are not configured on this server. Add IMGBB_API_KEY before accepting photos.",
    );
    error.status = 503;
    throw error;
  }

  return saveLocally(base64, EXTENSION_BY_MIME[mime] || "jpg");
}

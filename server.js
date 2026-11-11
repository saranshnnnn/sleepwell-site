"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("sleepwell:" + ADMIN_PASSWORD).digest("hex");
const COOKIE = "sw_admin";
const SESSION_MS = 1000 * 60 * 60 * 12;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.copyFileSync(path.join(__dirname, "seed", "products.json"), PRODUCTS_FILE);
}

/* ---------- data helpers ---------- */
function readProducts() {
  try { return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8")); } catch (e) { return []; }
}
function writeProducts(list) {
  const tmp = PRODUCTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, PRODUCTS_FILE);
}
function clean(str, max) {
  return String(str == null ? "" : str).replace(/\s+/g, " ").trim().slice(0, max);
}
function toBool(v) { return v === true || v === "true" || v === "on" || v === "1"; }
function publicProduct(p) {
  return { id: p.id, name: p.name, category: p.category, description: p.description, price: p.price, image: p.image, inStock: p.inStock, featured: p.featured };
}

/* ---------- admin session (signed cookie) ---------- */
function sign(value) { return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex"); }
function makeToken() { const exp = String(Date.now() + SESSION_MS); return exp + "." + sign(exp); }
function validToken(token) {
  if (!token || !ADMIN_PASSWORD) return false;
  const [exp, sig] = String(token).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
function requireAdmin(req, res, next) {
  if (validToken(getCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "Please sign in." });
}
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 8;
}

/* ---------- uploads ---------- */
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(10).toString("hex") + (EXT[file.mimetype] || ".jpg")),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
});
function removeUpload(imageUrl) {
  if (typeof imageUrl === "string" && imageUrl.startsWith("/uploads/")) {
    const file = path.join(UPLOAD_DIR, path.basename(imageUrl));
    fs.unlink(file, () => {});
  }
}

/* ---------- app ---------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

/* public catalogue API */
app.get("/api/products", (req, res) => {
  const category = clean(req.query.category, 80).toLowerCase();
  const q = clean(req.query.q, 80).toLowerCase();
  const featured = req.query.featured === "1";
  let list = readProducts();
  if (category) list = list.filter((p) => p.category.toLowerCase() === category);
  if (q) list = list.filter((p) => (p.name + " " + p.category + " " + p.description).toLowerCase().includes(q));
  if (featured) list = list.filter((p) => p.featured);
  res.setHeader("Cache-Control", "no-cache");
  res.json(list.map(publicProduct));
});
app.get("/api/categories", (req, res) => {
  const counts = {};
  for (const p of readProducts()) counts[p.category] = (counts[p.category] || 0) + 1;
  res.setHeader("Cache-Control", "no-cache");
  res.json(Object.keys(counts).sort().map((name) => ({ name, count: counts[name] })));
});

/* admin API */
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin is switched off. Set the ADMIN_PASSWORD setting on the server." });
  const ip = req.ip || "unknown";
  if (tooManyAttempts(ip)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes and try again." });
  const given = Buffer.from(String(req.body && req.body.password || ""));
  const real = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) { attempts.get(ip).push(Date.now()); return res.status(401).json({ error: "That password is not right." }); }
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
app.get("/api/admin/me", (req, res) => {
  res.json({ signedIn: validToken(getCookie(req, COOKIE)), adminEnabled: Boolean(ADMIN_PASSWORD) });
});
app.get("/api/admin/products", requireAdmin, (req, res) => res.json(readProducts()));

function fieldsFrom(body) {
  const price = clean(body.price, 40);
  return {
    name: clean(body.name, 120),
    category: clean(body.category, 60),
    description: clean(body.description, 600),
    price: price || null,
    inStock: toBool(body.inStock),
    featured: toBool(body.featured),
  };
}
app.post("/api/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  const f = fieldsFrom(req.body);
  if (!f.name || !f.category) { if (req.file) removeUpload("/uploads/" + req.file.filename); return res.status(400).json({ error: "Name and category are required." }); }
  if (!req.file) return res.status(400).json({ error: "Please add a photo (JPG, PNG or WebP, up to 8 MB)." });
  const list = readProducts();
  const item = { id: "p" + crypto.randomBytes(5).toString("hex"), ...f, image: "/uploads/" + req.file.filename, createdAt: new Date().toISOString() };
  list.unshift(item);
  writeProducts(list);
  res.status(201).json(item);
});
app.put("/api/admin/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  const list = readProducts();
  const i = list.findIndex((p) => p.id === req.params.id);
  if (i < 0) { if (req.file) removeUpload("/uploads/" + req.file.filename); return res.status(404).json({ error: "Product not found." }); }
  const f = fieldsFrom(req.body);
  if (!f.name || !f.category) { if (req.file) removeUpload("/uploads/" + req.file.filename); return res.status(400).json({ error: "Name and category are required." }); }
  const old = list[i];
  const next = { ...old, ...f };
  if (req.file) { removeUpload(old.image); next.image = "/uploads/" + req.file.filename; }
  list[i] = next;
  writeProducts(list);
  res.json(next);
});
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const list = readProducts();
  const item = list.find((p) => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Product not found." });
  writeProducts(list.filter((p) => p.id !== req.params.id));
  removeUpload(item.image);
  res.json({ ok: true });
});

/* uploaded photos + static site */
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));

app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That photo is over 8 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

app.listen(PORT, () => {
  console.log(`SleepWell site running on port ${PORT}`);
  if (!ADMIN_PASSWORD) console.log("ADMIN_PASSWORD is not set, so the admin page is switched off.");
});

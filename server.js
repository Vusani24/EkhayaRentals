const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = "Khanya0901@2";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "database");
const DB_FILE = path.join(DATA_DIR, "db.json");
const sessions = new Set();

const defaultDB = {
  rooms: { pending: [], approved: [], taken: [], declined: [], removed: [] },
  reviews: { pending: [], approved: [], declined: [] },
  reports: { pending: [], approved: [], declined: [] },
  settings: { driveFolder: "" }
};

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDB(defaultDB);
}

function readDB() {
  ensureDB();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db.rooms = { ...defaultDB.rooms, ...(db.rooms || {}) };
  db.reviews = { ...defaultDB.reviews, ...(db.reviews || {}) };
  db.reports = { ...defaultDB.reports, ...(db.reports || {}) };
  db.settings = { ...defaultDB.settings, ...(db.settings || {}) };
  return db;
}

function writeDB(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 80 * 1024 * 1024) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function cleanText(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function cleanImages(images) {
  return Array.isArray(images)
    ? images.filter((src) => typeof src === "string" && /^(data:image\/|https?:\/\/)/i.test(src)).slice(0, 5)
    : [];
}

function cleanVideo(video) {
  return typeof video === "string" && /^(data:video\/|https?:\/\/)/i.test(video) ? video : "";
}

function requireAdmin(req, res) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !sessions.has(token)) {
    send(res, 401, { error: "Admin login required" });
    return false;
  }
  return true;
}

function moveItem(db, section, from, to, id) {
  const item = db[section][from].find((entry) => entry.id === id);
  if (!item) return;
  db[section][from] = db[section][from].filter((entry) => entry.id !== id);
  db[section][to] = db[section][to].filter((entry) => entry.id !== id);
  db[section][to].unshift({ ...item, status: to, updatedAt: new Date().toISOString() });
}

function deleteItem(db, section, from, id) {
  db[section][from] = db[section][from].filter((entry) => entry.id !== id);
}

function cleanTakenDetails(details) {
  return {
    companyName: "Ekhaya Rental Rooms",
    landlordName: cleanText(details?.landlordName, 140),
    landlordContact: cleanText(details?.landlordContact, 80),
    tenantName: cleanText(details?.tenantName, 140),
    tenantContact: cleanText(details?.tenantContact, 80),
    serviceFee: cleanText(details?.serviceFee, 40),
    serviceFeeAmount: Math.max(0, Number(details?.serviceFeeAmount) || 0),
    rentPrice: cleanText(details?.rentPrice, 40),
    deposit: cleanText(details?.deposit, 80),
    paymentDate: cleanText(details?.paymentDate, 20),
    moveInDate: cleanText(details?.moveInDate, 20),
    paymentType: cleanText(details?.paymentType, 40),
    receiptNumber: cleanText(details?.receiptNumber || `ER-${Date.now()}`, 60),
    printedAt: cleanText(details?.printedAt || new Date().toLocaleString("en-ZA"), 80)
  };
}

function markTaken(db, id, takenDetails) {
  const room = db.rooms.approved.find((entry) => entry.id === id);
  if (!room) return;
  db.rooms.approved = db.rooms.approved.filter((entry) => entry.id !== id);
  db.rooms.taken = db.rooms.taken.filter((entry) => entry.id !== id);
  db.rooms.taken.unshift({
    ...room,
    takenDetails: cleanTakenDetails(takenDetails),
    status: "taken",
    takenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retainedUntil: "5 years from payment date"
  });
}

async function api(req, res, url) {
  const db = readDB();

  if (req.method === "GET" && url.pathname === "/api/public") {
    const rooms = db.rooms.approved.map(({ posterName, posterContact, ...room }) => room);
    const reports = [
      ...db.reports.approved,
      ...db.reports.pending
    ].map(({ reporterContact, ...report }) => report);
    send(res, 200, { rooms, reviews: db.reviews.approved, reports });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    db.rooms.pending.unshift({
      id: "post-" + Date.now(),
      title: cleanText(body.title, 120),
      address: cleanText(body.address, 220),
      location: cleanText(body.location, 120),
      type: cleanText(body.type, 40),
      amount: cleanText(body.amount, 40),
      deposit: cleanText(body.deposit || "No deposit stated", 80),
      childFriendly: cleanText(body.childFriendly, 10),
      parking: cleanText(body.parking, 10),
      bath: cleanText(body.bath, 120),
      images: cleanImages(body.images),
      video: cleanVideo(body.video),
      posterName: cleanText(body.posterName, 100),
      posterContact: cleanText(body.posterContact, 160),
      notes: cleanText(body.notes, 800),
      status: "pending",
      createdAt: new Date().toISOString()
    });
    writeDB(db);
    send(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reviews") {
    const body = await readBody(req);
    db.reviews.pending.unshift({
      id: "review-" + Date.now(),
      roomId: cleanText(body.roomId, 80),
      roomTitle: cleanText(body.roomTitle, 140),
      name: cleanText(body.name, 100),
      rating: Math.max(1, Math.min(5, Number(body.rating) || 5)),
      comment: cleanText(body.comment, 800),
      status: "pending",
      createdAt: new Date().toISOString()
    });
    writeDB(db);
    send(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reports") {
    const body = await readBody(req);
    db.reports.pending.unshift({
      id: "report-" + Date.now(),
      room: cleanText(body.room, 180),
      reporterContact: cleanText(body.reporterContact, 160),
      reason: cleanText(body.reason, 1000),
      status: "pending",
      createdAt: new Date().toISOString()
    });
    writeDB(db);
    send(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readBody(req);
    if (body.password !== ADMIN_PASSWORD) return send(res, 401, { error: "Incorrect password" });
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    send(res, 200, { token });
    return;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!requireAdmin(req, res)) return;
    if (req.method === "GET" && url.pathname === "/api/admin/data") return send(res, 200, db);

    if (req.method === "POST" && url.pathname === "/api/admin/action") {
      const body = await readBody(req);
      if (body.action === "move") moveItem(db, body.section, body.from, body.to, body.id);
      if (body.action === "mark-taken") markTaken(db, body.id, body.takenDetails);
      if (body.action === "delete") deleteItem(db, body.section, body.from, body.id);
      if (body.action === "repost") {
        const room = db.rooms[body.from].find((entry) => entry.id === body.id);
        if (room) db.rooms.pending.unshift({ ...room, id: "repost-" + Date.now(), status: "pending" });
      }
      if (body.action === "remove-image") {
        const room = db.rooms[body.from].find((entry) => entry.id === body.id);
        if (room) room.images = (room.images || []).filter((_, index) => index !== Number(body.index));
      }
      if (body.action === "remove-video") {
        const room = db.rooms[body.from].find((entry) => entry.id === body.id);
        if (room) room.video = "";
      }
      writeDB(db);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/drive") {
      const body = await readBody(req);
      db.settings.driveFolder = cleanText(body.driveFolder, 500);
      writeDB(db);
      send(res, 200, { ok: true });
      return;
    }
  }

  send(res, 404, { error: "Not found" });
}

function serveFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".zip": "application/zip" }[ext] || "application/octet-stream";
  send(res, 200, fs.readFileSync(file), type);
}

ensureDB();
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    serveFile(req, res, url);
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
}).listen(PORT, () => console.log(`Ekhaya Rentals running at http://localhost:${PORT}`));

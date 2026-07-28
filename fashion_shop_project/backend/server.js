const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { createServer } = require("http");
const { Server } = require("socket.io");

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");

// Load .env file nếu có
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split("\n").forEach(line => {
        const [key, ...rest] = line.split("=");
        if (key && rest.length > 0 && !key.startsWith("#")) {
            process.env[key.trim()] = rest.join("=").trim();
        }
    });
}

// ====== PayOS config ======
// Lấy từ https://my.payos.vn (Kênh thanh toán)
const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID || "";
const PAYOS_API_KEY = process.env.PAYOS_API_KEY || "";
const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || "";

const PAYOS_API = "https://api-merchant.payos.vn/v2";

async function createPayOSPaymentLink({ orderCode, amount, description, items, cancelUrl, returnUrl }) {
  if (!PAYOS_CLIENT_ID || !PAYOS_API_KEY || !PAYOS_CHECKSUM_KEY) {
    throw new Error("PayOS chưa được cấu hình. Vui lòng set PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY.");
  }

  // Tạo signature
  const dataToSign = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
  const signature = crypto.createHmac("sha256", PAYOS_CHECKSUM_KEY).update(dataToSign).digest("hex");

  const body = {
    orderCode,
    amount,
    description,
    cancelUrl,
    returnUrl,
    items: items || [],
    signature
  };

  const res = await fetch(`${PAYOS_API}/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": PAYOS_CLIENT_ID,
      "x-api-key": PAYOS_API_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (data.code !== "00") {
    throw new Error(`PayOS lỗi: ${data.desc || "Không xác định"}`);
  }
  return data.data;
}

async function getPayOSPaymentLink(paymentLinkId) {
  const res = await fetch(`${PAYOS_API}/payment-requests/${paymentLinkId}`, {
    headers: {
      "x-client-id": PAYOS_CLIENT_ID,
      "x-api-key": PAYOS_API_KEY
    }
  });
  const data = await res.json();
  if (data.code !== "00") {
    throw new Error(`PayOS lỗi: ${data.desc}`);
  }
  return data.data;
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
const port = 3000;
const BASE_URL = `http://localhost:${port}`;

// Helper: chuyển đường dẫn ảnh tương đối thành tuyệt đối
function absUrl(url) {
  if (!url || url.startsWith("http")) return url;
  return BASE_URL + url;
}

// ----- Cấu hình upload hình ảnh -----
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const PRODUCTS_IMG_DIR = path.join(UPLOADS_DIR, "products");
const ADS_IMG_DIR = path.join(UPLOADS_DIR, "ads");

// Tạo thư mục nếu chưa tồn tại
[UPLOADS_DIR, PRODUCTS_IMG_DIR, ADS_IMG_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || 'products';
    const dir = type === 'ads' ? ADS_IMG_DIR : PRODUCTS_IMG_DIR;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = file.fieldname + '-' + Date.now() + ext;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpe?g|png|webp|gif|svg/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk || mimeOk);
  },
});

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

// Serve thư mục uploads và frontend dưới dạng tĩnh
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(FRONTEND_DIR));

// Khởi tạo database
const db = new Database(path.join(__dirname, "pho_studio.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    content TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pending_ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    color_hex TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT,
    phone TEXT,
    items TEXT,
    total_amount INTEGER,
    status TEXT DEFAULT 'pending',
    order_status TEXT DEFAULT 'mới',
    qr_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME
  );
`);

// Migration: thêm cột order_status cho DB cũ
const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
const hasOrderStatus = tableInfo.some(col => col.name === 'order_status');
if (!hasOrderStatus) {
  db.exec("ALTER TABLE orders ADD COLUMN order_status TEXT DEFAULT 'mới'");
  console.log("✅ Đã migrate: thêm cột order_status cho bảng orders");
}

// Migration: thêm cột email cho DB cũ
const hasEmail = tableInfo.some(col => col.name === 'customer_email');
if (!hasEmail) {
  db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT DEFAULT ''");
  console.log("✅ Đã migrate: thêm cột customer_email cho bảng orders");
}

console.log("✅ Database đã sẵn sàng: pho_studio.db");

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-token"],
}));
app.use(express.json());

// ====== Admin Auth ======
// Đổi mật khẩu ở đây hoặc set biến môi trường ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pho@admin2026";

// Middleware kiểm tra admin token
function adminAuth(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token === ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized. Vui lòng đăng nhập." });
}

// Endpoint đăng nhập admin (không cần auth)
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: password });
  }
  return res.status(401).json({ success: false, error: "Sai mật khẩu!" });
});

// Route gốc — chỉ để xác nhận server sống
app.get("/", (req, res) => {
    res.send("PHỐ STUDIO backend đang chạy. Endpoint agent: POST /api/agent/trigger");
});

// Cố gắng lấy text trả lời từ nhiều dạng JSON khác nhau mà `openclaw agent --json` có thể trả về.
// Đã thêm "content" và "answer" vào danh sách vì đây là field phổ biến ở
// một số phiên bản output của openclaw agent --json.
function extractReply(json) {
    if (Array.isArray(json.payloads) && json.payloads.length > 0) {
        const texts = json.payloads
            .map((p) => p.text)
            .filter((t) => typeof t === "string" && t.trim() !== "");
        if (texts.length > 0) return texts.join("\n\n");
    }

    // Gateway agent response: result.payloads[].text
    if (json?.result?.payloads && Array.isArray(json.result.payloads) && json.result.payloads.length > 0) {
        const texts = json.result.payloads
            .map((p) => p.text)
            .filter((t) => typeof t === "string" && t.trim() !== "");
        if (texts.length > 0) return texts.join("\n\n");
    }

    const candidates = [
        json.reply,
        json.content,
        json.message,
        json.text,
        json.output,
        json.response,
        json.answer,
        json?.result?.text,
        json?.message?.content,
        json?.assistant?.text,
    ];
    const found = candidates.find((v) => typeof v === "string" && v.trim() !== "");
    if (found) return found;

    console.warn(
        "[Backend] ⚠️ Không tìm thấy field trả lời quen thuộc trong JSON. " +
        "Xem cấu trúc JSON đầy đủ bên dưới và cập nhật lại extractReply() trong server.js cho khớp:"
    );
    console.warn(JSON.stringify(json, null, 2));
    return null;
}

// Hàm dùng chung để gọi agent qua CLI `openclaw agent` qua gateway
// và trả về reply đã trích xuất, hoặc throw lỗi có message rõ ràng.
// Mặc định gọi consultant-agent (Vân 👗) cho tư vấn thời trang.
function runAgent({ prompt, sessionId, agentId }) {
    const agent = agentId || "consultant-agent";
    return new Promise((resolve, reject) => {
        execFile(
            "openclaw",
            [
                "agent",
                "--agent", agent,
                "--session-id", sessionId || `web-${agent}-${Date.now()}`,
                "--message", prompt,
                "--json",
            ],
            { timeout: 240000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("[Backend] openclaw agent lỗi:", error.message);
                    if (stderr) console.error("[Backend] stderr:", stderr);
                    return reject(new Error("Agent local (OpenClaw) báo lỗi. Xem log backend trong terminal để biết chi tiết."));
                }

                let parsed;
                try {
                    parsed = JSON.parse(stdout.trim());
                } catch (e) {
                    console.error("[Backend] Không parse được JSON từ openclaw agent. Raw output:");
                    console.error(stdout);
                    return reject(new Error("Không đọc được phản hồi từ agent (không phải JSON hợp lệ)."));
                }

                const reply = extractReply(parsed);
                if (!reply) {
                    return reject(new Error("Agent trả lời nhưng backend chưa biết lấy field nào. Xem console backend để lấy đúng tên field, rồi cập nhật extractReply() trong server.js."));
                }

                resolve(reply);
            }
        );
    });
}

// Lấy danh sách bài đăng gần đây (dùng cho index.html hiển thị lại
// những bài đã đăng từ social_feed.html, kể cả sau khi tải lại trang).
// Helper: chuyển đường dẫn ảnh tương đối thành tuyệt đối
function absUrl(url) {
  if (!url || url.startsWith("http")) return url;
  return BASE_URL + url;
}

app.get("/api/ads", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = db
        .prepare("SELECT id, platform, content, image_url, created_at FROM ads ORDER BY created_at DESC LIMIT ?")
        .all(limit);
    const ads = rows.map((a) => ({ ...a, image_url: absUrl(a.image_url) }));
    res.json({ ads });
});

// Xóa một bài đã đăng từ index.html và thông báo realtime cho các tab khác.
// Helper: lấy stock theo size cho 1 sản phẩm
function getStockBySize(productId) {
  const rows = db.prepare("SELECT size, stock FROM product_stock WHERE product_id = ? ORDER BY size ASC").all(productId);
  const total = rows.reduce((s, r) => s + r.stock, 0);
  return { bySize: rows, total };
}

app.get("/api/images/products", (req, res) => {
  const rows = db
    .prepare("SELECT id, product_id, product_name, image_url, color_hex, sort_order FROM product_images ORDER BY sort_order ASC")
    .all();
  const products = rows.map((p) => {
    const stockInfo = getStockBySize(p.product_id);
    return {
      ...p,
      image_url: absUrl(p.image_url),
      stock: stockInfo.total,
      stock_by_size: stockInfo.bySize,
    };
  });
  res.json({ products });
});

// Cập nhật số lượng tồn kho theo size
app.post("/api/images/stock", adminAuth, (req, res) => {
  const { product_id, size, stock } = req.body;
  if (!product_id || stock === undefined || stock < 0) {
    return res.status(400).json({ error: "product_id và stock (>=0) là bắt buộc." });
  }
  const existing = db.prepare("SELECT id FROM product_images WHERE product_id = ?").get(product_id);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy sản phẩm." });
  
  if (size) {
    // Cập nhật theo size
    db.prepare("INSERT INTO product_stock (product_id, size, stock) VALUES (?, ?, ?) ON CONFLICT(product_id, size) DO UPDATE SET stock = ?")
      .run(product_id, size, stock, stock);
    console.log(`[Stock] ✅ ${product_id} (${size}): stock = ${stock}`);
    const stockInfo = getStockBySize(product_id);
    res.json({ message: `✅ Đã cập nhật tồn kho size ${size}.`, product_id, stock_by_size: stockInfo.bySize, total: stockInfo.total });
  } else {
    // Cập nhật tất cả size về cùng 1 số
    const sizes = db.prepare("SELECT size FROM product_stock WHERE product_id = ?").all(product_id);
    const upd = db.prepare("UPDATE product_stock SET stock = ? WHERE product_id = ? AND size = ?");
    for (const s of sizes) {
      upd.run(stock, product_id, s.size);
    }
    console.log(`[Stock] ✅ ${product_id}: tất cả size = ${stock}`);
    const stockInfo = getStockBySize(product_id);
    res.json({ message: `✅ Đã cập nhật tất cả size.`, product_id, stock_by_size: stockInfo.bySize, total: stockInfo.total });
  }
});

// Lấy danh sách tồn kho theo size
app.get("/api/images/stock", adminAuth, (req, res) => {
  const rows = db.prepare("SELECT p.product_id, p.product_name, ps.size, ps.stock FROM product_images p JOIN product_stock ps ON p.product_id = ps.product_id ORDER BY p.sort_order ASC, ps.size ASC").all();
  // Nhóm theo sản phẩm
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.product_id]) grouped[r.product_id] = { product_id: r.product_id, product_name: r.product_name, sizes: [] };
    grouped[r.product_id].sizes.push({ size: r.size, stock: r.stock });
  }
  res.json({ products: Object.values(grouped) });
});

// Upload hình ảnh cho sản phẩm hoặc bài đăng
app.post("/api/images/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Không có file nào được upload." });
  const imageUrl = "/uploads/" + (req.body.type || "products") + "/" + req.file.filename;

  // Nếu có product_id, lưu vào DB
  if (req.body.product_id) {
    const existing = db
      .prepare("SELECT id FROM product_images WHERE product_id = ?")
      .get(req.body.product_id);
    if (existing) {
      db.prepare("UPDATE product_images SET image_url = ? WHERE product_id = ?")
        .run(imageUrl, req.body.product_id);
    } else {
      db.prepare(
        "INSERT INTO product_images (product_id, product_name, image_url, color_hex) VALUES (?, ?, ?, ?)"
      ).run(req.body.product_id, req.body.product_name || "", imageUrl, req.body.color_hex || null);
    }
  }

  console.log(`[Upload] Đã upload: ${imageUrl}`);
  res.json({ message: "Upload thành công.", image_url: imageUrl });
});

app.delete("/api/ads/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "Invalid ad id." });
    }

    const ad = db
        .prepare("SELECT id, platform, content, image_url, created_at FROM ads WHERE id = ?")
        .get(id);
    if (!ad) return res.status(404).json({ error: "Không tìm thấy bài đăng." });

    ad.image_url = absUrl(ad.image_url);
    db.prepare("DELETE FROM ads WHERE id = ?").run(id);
    console.log(`[SocialPost] Đã xóa bài #${id}`);
    return res.json({ message: "Đã xóa bài đăng.", ad });
});

const allowedPlatforms = ["facebook", "instagram", "twitter", "linkedin", "tiktok", "web"];

function validateAd(platform, content) {
    if (!platform || typeof content !== "string" || !content.trim()) {
        return "Both 'platform' and 'content' fields are required.";
    }
    if (!allowedPlatforms.includes(platform)) {
        return `Unsupported platform: ${platform}`;
    }
    return null;
}

// Hàng đợi kiểm duyệt: index.html gửi bài vào đây, chưa xuất hiện trong ads.
app.post("/api/approvals", (req, res) => {
    const { platform, content } = req.body;
    const validationError = validateAd(platform, content);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = db
        .prepare("INSERT INTO pending_ads (platform, content) VALUES (?, ?)")
        .run(platform, content.trim());
    const approval = db
        .prepare("SELECT id, platform, content, status, created_at FROM pending_ads WHERE id = ?")
        .get(result.lastInsertRowid);

    io.emit("approval-requested", approval);
    console.log(`[Approval] Bài #${approval.id} đang chờ duyệt cho ${platform}`);
    return res.status(201).json({ message: "Đã gửi bài sang trang kiểm duyệt.", approval });
});

app.get("/api/approvals", (req, res) => {
    const status = req.query.status || "pending";
    if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: `Unsupported status: ${status}` });
    }
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const approvals = db
        .prepare(`SELECT id, platform, content, status, created_at, reviewed_at
                  FROM pending_ads WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
        .all(status, limit);
    return res.json({ approvals });
});

const approvePendingAd = db.transaction((id) => {
    const approval = db
        .prepare("SELECT id, platform, content, status, created_at FROM pending_ads WHERE id = ?")
        .get(id);
    if (!approval) return { error: "not_found" };
    if (approval.status !== "pending") return { error: "already_reviewed", approval };

    db.prepare("UPDATE pending_ads SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    const result = db.prepare("INSERT INTO ads (platform, content) VALUES (?, ?)").run(approval.platform, approval.content);
    const ad = db
        .prepare("SELECT id, platform, content, image_url, created_at FROM ads WHERE id = ?")
        .get(result.lastInsertRowid);
    return { approval, ad };
});

// Cập nhật nội dung bài chờ duyệt trước khi duyệt.
app.put("/api/approvals/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "Invalid approval id." });
    }
    const { content } = req.body;
    if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "'content' is required and cannot be empty." });
    }
    const approval = db
        .prepare("SELECT id, platform, content, status FROM pending_ads WHERE id = ?")
        .get(id);
    if (!approval) return res.status(404).json({ error: "Không tìm thấy bài chờ duyệt." });
    if (approval.status !== "pending") return res.status(409).json({ error: "Bài này đã được xử lý, không thể sửa." });

    db.prepare("UPDATE pending_ads SET content = ? WHERE id = ?").run(content.trim(), id);
    console.log(`[Approval] Đã sửa bài #${id}`);
    return res.json({ message: "Đã cập nhật nội dung.", approval: { ...approval, content: content.trim() } });
});

app.post("/api/approvals/:id/approve", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid approval id." });

    const result = approvePendingAd(id);
    if (result.error === "not_found") return res.status(404).json({ error: "Không tìm thấy bài chờ duyệt." });
    if (result.error === "already_reviewed") return res.status(409).json({ error: "Bài này đã được xử lý." });

    io.emit("approval-reviewed", { id, status: "approved" });
    result.ad.image_url = absUrl(result.ad.image_url);
    io.emit("new-ad", result.ad);
    console.log(`[Approval] Đã duyệt bài #${id} và đăng lên ${result.ad.platform}`);
    return res.json({ message: "Đã duyệt và đăng bài.", ad: result.ad });
});

app.post("/api/approvals/:id/reject", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid approval id." });

    const result = db
        .prepare("UPDATE pending_ads SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
        .run(id);
    if (!result.changes) {
        const exists = db.prepare("SELECT status FROM pending_ads WHERE id = ?").get(id);
        return res.status(exists ? 409 : 404).json({ error: exists ? "Bài này đã được xử lý." : "Không tìm thấy bài chờ duyệt." });
    }

    io.emit("approval-reviewed", { id, status: "rejected" });
    console.log(`[Approval] Đã từ chối bài #${id}`);
    return res.json({ message: "Đã từ chối bài." });
});

// ------------------------------------------------------------
// Route chính — khớp với frontend (index.html, social_feed.html)
// ------------------------------------------------------------

// Trigger agent tạo nội dung. Body: { agentId, prompt }
// agentId hiện chưa dùng để rẽ nhánh logic (chỉ có 1 agent), nhưng được
// giữ lại trong signature để dễ mở rộng nhiều agent sau này.
app.post("/api/agent/trigger", async (req, res) => {
    const { agentId, prompt } = req.body;
    const sessionId = `agent-${agentId || "default"}-${Date.now()}`;

    if (!prompt || prompt.trim() === "") {
        return res.status(400).json({ error: "'prompt' is required and cannot be empty." });
    }

    console.log(`[Backend] (${agentId || "unknown-agent"}) -> "${prompt}"`);

    try {
        const content = await runAgent({ prompt, sessionId, agentId });

        db.prepare("INSERT INTO chat_history (session_id, role, message) VALUES (?, ?, ?)").run(sessionId, "user", prompt);
        db.prepare("INSERT INTO chat_history (session_id, role, message) VALUES (?, ?, ?)").run(sessionId, "assistant", content);

        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Đăng bài (giả lập). Body: { platform, content, image_url }
app.post("/api/agent/post", (req, res) => {
    const { platform, content } = req.body;
    const validationError = validateAd(platform, content);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = db.prepare("INSERT INTO ads (platform, content, image_url) VALUES (?, ?, ?)").run(platform, content, req.body.image_url || null);
    const ad = db.prepare("SELECT id, platform, content, image_url, created_at FROM ads WHERE id = ?").get(result.lastInsertRowid);
    ad.image_url = absUrl(ad.image_url);

    console.log(`[SocialPost] Platform: ${platform}\nContent: ${content}`);
    io.emit("new-ad", ad);

    return res.json({ message: `✅ Nội dung đã được "đăng" lên ${platform} (giả lập).`, ad });
});

// ------------------------------------------------------------
// Route cũ giữ lại làm alias — để không phá vỡ bất kỳ nơi nào khác
// (ví dụ tool test cũ, hoặc widget chat riêng) vẫn đang gọi /api/chat
// và /api/post theo contract cũ.
// ------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || "web-chat-default";
    const agentId = req.body.agentId || "consultant-agent";

    if (!userMessage || userMessage.trim() === "") {
        return res.status(400).json({ error: "Message is required and cannot be empty." });
    }

    console.log(`[Backend] (${sessionId}) -> "${userMessage}"`);

    try {
        const reply = await runAgent({ prompt: userMessage, sessionId, agentId });

        db.prepare("INSERT INTO chat_history (session_id, role, message) VALUES (?, ?, ?)").run(sessionId, "user", userMessage);
        db.prepare("INSERT INTO chat_history (session_id, role, message) VALUES (?, ?, ?)").run(sessionId, "assistant", reply);

        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/post", (req, res) => {
    const { platform, content } = req.body;
    const validationError = validateAd(platform, content);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = db.prepare("INSERT INTO ads (platform, content, image_url) VALUES (?, ?, ?)").run(platform, content, req.body.image_url || null);
    const ad = db.prepare("SELECT id, platform, content, image_url, created_at FROM ads WHERE id = ?").get(result.lastInsertRowid);
    ad.image_url = absUrl(ad.image_url);

    console.log(`[SocialPost] Platform: ${platform}\nContent: ${content}`);
    io.emit("new-ad", ad);

    return res.json({ message: `✅ Nội dung đã được "đăng" lên ${platform} (giả lập).`, ad });
});

// ------------------------------------------------------------
// Thanh toán qua PayOS
// ------------------------------------------------------------

// Tạo đơn hàng và link thanh toán PayOS
app.post("/api/payment/create", (req, res) => {
    const { amount, items, customer_name, customer_phone, customer_email, customer_address, customer_note } = req.body;
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Số tiền không hợp lệ." });
    }

    const date = new Date();
    const yymmdd = date.getFullYear().toString() + 
        String(date.getMonth() + 1).padStart(2, '0') + 
        String(date.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const orderId = `PHO-${yymmdd}-${seq}`;

    const description = `TT PHO ${orderId}`.slice(-25);
    const bankCode = "MB";
    const accountNo = "1506006899999";
    const qrData = `https://img.vietqr.io/image/${bankCode}-${accountNo}-compact.jpg?amount=${amount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent("HOANG HA NAM")}`;

    const stmt = db.prepare(`INSERT INTO orders (id, items, total_amount, status, order_status, qr_data, customer_name, customer_phone, customer_email, customer_address, customer_note) VALUES (?, ?, ?, 'pending', 'mới', ?, ?, ?, ?, ?, ?)`);
    stmt.run(orderId, JSON.stringify(items || []), amount, qrData, customer_name || "", customer_phone || "", customer_email || "", customer_address || "", customer_note || "");

    res.json({
        orderId,
        amount,
        transferContent: description,
        qrData,
        bankInfo: {
            bank: bankCode,
            account: accountNo,
            holder: "HOANG HA NAM"
        }
    });
});

// Webhook từ PayOS
// Kiểm tra trạng thái đơn hàng (từ PayOS hoặc local)
// Hàm gửi thông báo đơn hàng mới qua Telegram (gọi main agent)
function notifyNewOrder(order) {
    let items = [];
    try { items = JSON.parse(order.items); } catch(e) { items = [{ name: "Sản phẩm", quantity: 1 }]; }
    
    const itemList = items.map(i => `${i.name} x${i.quantity}`).join(", ");
    const amount = (order.total_amount || 0).toLocaleString('vi-VN');
    
    // Thông tin khách hàng
    const name = order.customer_name || "—";
    const phone = order.customer_phone || "—";
    const email = order.customer_email || "—";
    const address = order.customer_address || "—";
    const note = order.customer_note ? `\n📝 Ghi chú: ${order.customer_note}` : "";
    
    const orderStatus = order.order_status || 'mới';
    const message = `🛒 **ĐƠN HÀNG MỚI!**\n\n` +
        `🧾 Mã đơn: \`${order.id}\`\n` +
        `👤 Khách: ${name} — ${phone}\n` +
        `📧 Email: ${email}\n` +
        `📍 Địa chỉ: ${address}\n` +
        `📦 Sản phẩm: ${itemList}\n` +
        `💰 Tổng tiền: **${amount}₫**\n` +
        `✅ Trạng thái TT: **Đã thanh toán**\n` +
        `📋 Tình trạng ĐH: **${orderStatus}**\n` +
        `⏰ Thời gian: ${order.paid_at || "vừa xong"}${note}`;

    execFile("openclaw", [
        "agent", "--agent", "main", "--message", message, "--channel", "telegram", "--to", "1415995118", "--deliver", "--json"
    ], { timeout: 30000 }, (err) => {
        if (err) console.error("[Notify] Lỗi gửi thông báo:", err.message);
        else console.log(`[Notify] ✅ Đã thông báo đơn hàng: ${order.id}`);
    });
}

// Kiểm tra trạng thái đơn hàng (frontend poll)
app.get("/api/payment/status/:orderId", (req, res) => {
    const order = db.prepare("SELECT id, status, order_status, paid_at FROM orders WHERE id = ?").get(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
    res.json({ id: order.id, status: order.status, order_status: order.order_status, paid_at: order.paid_at });
});

// Xác nhận thanh toán (thủ công từ chủ shop)
app.post("/api/payment/confirm/:orderId", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
    db.prepare("UPDATE orders SET status = 'paid', order_status = 'mới', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.orderId);
    
    // Gửi thông báo
    order.status = 'paid';
    order.order_status = 'mới';
    order.paid_at = new Date().toISOString();
    notifyNewOrder(order);
    
    res.json({ message: "✅ Đã xác nhận thanh toán.", orderId: req.params.orderId });
});

// ------------------------------------------------------------
// Danh sách đơn hàng
// ------------------------------------------------------------

app.get("/api/orders", adminAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const status = req.query.status; // lọc theo order_status (mới, đã xử lý, đã hủy)
    
    let query = "SELECT * FROM orders";
    let params = [];
    
    if (status && ['mới', 'đã xử lý', 'đã hủy'].includes(status)) {
        query += " WHERE order_status = ?";
        params.push(status);
    }
    
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    
    const orders = db.prepare(query).all(...params);
    
    const result = orders.map(o => ({
        id: o.id,
        customer_name: o.customer_name || "—",
        customer_phone: o.customer_phone || o.phone || "—",
        customer_email: o.customer_email || "Không có",
        customer_address: o.customer_address || "—",
        customer_note: o.customer_note || "",
        items: (() => { try { return JSON.parse(o.items); } catch(e) { return []; } })(),
        total_amount: o.total_amount,
        payment_status: o.status,
        order_status: o.order_status || 'mới',
        created_at: o.created_at,
        paid_at: o.paid_at || null
    }));
    
    res.json({ orders: result });
});

// ------------------------------------------------------------
// Chi tiết đơn hàng
// ------------------------------------------------------------

app.get("/api/orders/:id", adminAuth, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
    
    // Parse items từ JSON string
    let items = [];
    try { items = JSON.parse(order.items); } catch(e) { items = []; }
    
    res.json({
        id: order.id,
        customer_name: order.customer_name || "—",
        customer_phone: order.customer_phone || order.phone || "—",
        customer_email: order.customer_email || "Không có",
        customer_address: order.customer_address || "—",
        customer_note: order.customer_note || "",
        items: items,
        total_amount: order.total_amount,
        payment_status: order.status,
        order_status: order.order_status || 'mới',
        created_at: order.created_at,
        paid_at: order.paid_at || null
    });
});

// ------------------------------------------------------------
// Cập nhật trạng thái đơn hàng (mới → đã xử lý / đã hủy)
// ------------------------------------------------------------

app.post("/api/orders/:id/status", adminAuth, (req, res) => {
    const { order_status } = req.body;
    
    if (!['mới', 'đã xử lý', 'đã hủy'].includes(order_status)) {
        return res.status(400).json({ error: "Trạng thái không hợp lệ. Chỉ chấp nhận: mới, đã xử lý, đã hủy." });
    }
    
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng." });
    
    db.prepare("UPDATE orders SET order_status = ? WHERE id = ?").run(order_status, req.params.id);
    
    console.log(`[Đơn hàng] ${req.params.id}: ${order.order_status || 'mới'} → ${order_status}`);
    
    res.json({ message: `✅ Đã cập nhật trạng thái đơn hàng thành: ${order_status}`, orderId: req.params.id, order_status });
});

// ------------------------------------------------------------
// Báo cáo doanh thu
// ------------------------------------------------------------

app.get("/api/revenue", adminAuth, (req, res) => {
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    // Doanh thu từ đơn đã thanh toán
    const paidOrders = db.prepare(`
        SELECT * FROM orders 
        WHERE status = 'paid' 
        AND paid_at >= ? AND paid_at < ?
        ORDER BY paid_at DESC
    `).all(startDate, endDate);

    const total = paidOrders.reduce((sum, o) => sum + o.total_amount, 0);

    // Thống kê sản phẩm bán chạy
    const productStats = {};
    paidOrders.forEach(order => {
        try {
            const items = JSON.parse(order.items);
            items.forEach(item => {
                const name = item.name || item.productName || 'Unknown';
                const qty = item.quantity || 1;
                productStats[name] = (productStats[name] || 0) + qty;
            });
        } catch (e) {}
    });

    const topProducts = Object.entries(productStats)
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

    res.json({
        month,
        year,
        totalRevenue: total,
        orderCount: paidOrders.length,
        topProducts,
        orders: paidOrders.map(o => ({
            id: o.id,
            amount: o.total_amount,
            paidAt: o.paid_at
        }))
    });
});

// ------------------------------------------------------------
// Khởi động server — đặt SAU khi mọi route đã được đăng ký
// ------------------------------------------------------------
httpServer.listen(port, () => {
    console.log(`✅ Backend PHỐ STUDIO đang chạy tại http://localhost:${port}`);
    console.log(`   Endpoint agent (mới): POST http://localhost:${port}/api/agent/trigger`);
    console.log(`   Endpoint post (mới):  POST http://localhost:${port}/api/agent/post`);
    console.log(`   Endpoint kiểm duyệt:  GET/POST http://localhost:${port}/api/approvals`);
    console.log(`   Endpoint chỉnh sửa duyệt: PUT http://localhost:${port}/api/approvals/:id`);
    console.log(`   Endpoint ảnh sản phẩm: GET  http://localhost:${port}/api/images/products`);
    console.log(`   Endpoint upload ảnh:   POST http://localhost:${port}/api/images/upload`);
    console.log(`   Thư mục ảnh tĩnh:      http://localhost:${port}/uploads/products/`);
    console.log(`   Endpoint chat (cũ, vẫn hoạt động): POST http://localhost:${port}/api/chat`);
    console.log(`   Endpoint post (cũ, vẫn hoạt động): POST http://localhost:${port}/api/post`);
    console.log(`   Mọi request agent sẽ được gọi tới: openclaw agent --agent consultant-agent (qua gateway)`);
});

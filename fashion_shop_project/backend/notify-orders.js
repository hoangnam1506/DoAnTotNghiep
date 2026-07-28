#!/usr/bin/env node
// Kiểm tra đơn hàng mới và thông báo qua Telegram
const Database = require("better-sqlite3");
const { execFile } = require("child_process");
const path = require("path");

const db = new Database(path.join(__dirname, "pho_studio.db"));

// Tìm đơn hàng đã thanh toán nhưng chưa thông báo
const newOrders = db.prepare(`
  SELECT * FROM orders 
  WHERE status = 'paid' AND notified = 0
  ORDER BY paid_at DESC
`).all();

if (newOrders.length === 0) {
  process.exit(0);
}

for (const order of newOrders) {
  let items = [];
  try { items = JSON.parse(order.items); } catch(e) { items = [{ name: "Sản phẩm", quantity: 1 }]; }
  
  const itemList = items.map(i => `${i.name} x${i.quantity}`).join(", ");
  const amount = (order.total_amount || 0).toLocaleString('vi-VN');
  
  const orderStatus = order.order_status || 'mới';
  const message = `🛒 **ĐƠN HÀNG MỚI!**\n\n` +
    `🧾 Mã đơn: \`${order.id}\`\n` +
    `📦 Sản phẩm: ${itemList}\n` +
    `💰 Tổng tiền: **${amount}₫**\n` +
    `✅ Trạng thái TT: **Đã thanh toán**\n` +
    `📋 Tình trạng ĐH: **${orderStatus}**\n` +
    `⏰ Thời gian: ${order.paid_at || "vừa xong"}\n\n` +
    `👉 Thảo báo cáo doanh thu để xem chi tiết nhé!`;

  // Gửi thông báo qua main agent (Telegram)
  execFile("openclaw", [
    "agent",
    "--agent", "main",
    "--message", message,
    "--json"
  ], { timeout: 30000 }, (err) => {
    if (err) console.error("Lỗi gửi thông báo:", err.message);
  });

  // Đánh dấu đã thông báo
  db.prepare("UPDATE orders SET notified = 1 WHERE id = ?").run(order.id);
  console.log(`✅ Đã thông báo đơn hàng: ${order.id}`);
}

db.close();
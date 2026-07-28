#!/usr/bin/env node
/**
 * Kiểm tra đơn hàng mới chuyển từ "Mới" → "Đã xử lý"
 * và gửi mail thông báo cho khách hàng (nếu có email).
 *
 * Chạy mỗi 2 phút qua cron job.
 */

const Database = require("better-sqlite3");
const { execFile } = require("child_process");
const path = require("path");

const DB_PATH = path.join(__dirname, "pho_studio.db");
const SEND_MAIL_SCRIPT = path.join(__dirname, "..", "..", "send-mail.js");

async function sendMail(to, subject, body) {
  return new Promise((resolve, reject) => {
    execFile("node", [SEND_MAIL_SCRIPT, to, subject, body], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function main() {
  const db = new Database(DB_PATH);

  // Tìm đơn đã xử lý, có email, chưa gửi mail
  const orders = db.prepare(`
    SELECT * FROM orders 
    WHERE order_status = 'đã xử lý'
      AND email_sent = 0
      AND customer_email IS NOT NULL
      AND customer_email != ''
      AND customer_email != 'Không có'
    ORDER BY paid_at DESC
  `).all();

  if (orders.length === 0) {
    console.log(`[OrderEmailNotifier] Không có đơn nào cần gửi mail.`);
    db.close();
    return;
  }

  console.log(`[OrderEmailNotifier] Tìm thấy ${orders.length} đơn cần gửi mail.`);

  for (const order of orders) {
    let items = [];
    try { items = JSON.parse(order.items); } catch (e) { items = [{ name: "Sản phẩm", quantity: 1 }]; }

    const itemList = items.map(i => `${i.name} x${i.quantity}`).join(", ");
    const amount = (order.total_amount || 0).toLocaleString('vi-VN');

    const emailTo = order.customer_email;
    const customerName = order.customer_name || "Khách yêu";

    const subject = `🧾 Xác nhận đơn hàng ${order.id} đã được xử lý — Phố Shop`;

    const body = `Chào ${customerName},\n\n` +
      `Cảm ơn bạn đã mua sắm tại Phố Shop! 🎉\n\n` +
      `Đơn hàng dưới đây của bạn đã được xử lý và đang được chuẩn bị giao:\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 Mã đơn: ${order.id}\n` +
      `📦 Sản phẩm: ${itemList}\n` +
      `💰 Tổng tiền: ${amount}₫\n` +
      `📍 Địa chỉ: ${order.customer_address || "—"}\n` +
      `📝 Ghi chú: ${order.customer_note || "Không có"}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Chúng tôi sẽ giao hàng trong thời gian sớm nhất. Nếu có thắc mắc, vui lòng phản hồi email này hoặc liên hệ qua fanpage Phố Shop.\n\n` +
      `Trân trọng,\n` +
      `🏪 Phố Shop`;

    try {
      const result = await sendMail(emailTo, subject, body);
      console.log(`[OrderEmailNotifier] ✅ Đã gửi mail cho ${order.id} → ${emailTo}: ${result}`);

      // Đánh dấu đã gửi
      db.prepare("UPDATE orders SET email_sent = 1 WHERE id = ?").run(order.id);
    } catch (err) {
      console.error(`[OrderEmailNotifier] ❌ Lỗi gửi mail cho ${order.id}: ${err.message}`);
    }
  }

  db.close();
  console.log(`[OrderEmailNotifier] Hoàn thành.`);
}

main().catch(err => {
  console.error(`[OrderEmailNotifier] Fatal: ${err.message}`);
  process.exit(1);
});

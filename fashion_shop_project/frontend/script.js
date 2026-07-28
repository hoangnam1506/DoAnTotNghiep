// script.js — PHỐ STUDIO Frontend

const BACKEND_URL = "http://localhost:3000/api/chat";

// ====== Product Data ======
const PRODUCTS = [
  { id:'sp01', name:'Áo khoác denim PHỐ', price:890000, sizes:['S','M','L','XL'], image:null, material:'Denim dày, form oversized' },
  { id:'sp02', name:'Quần kaki ống đứng', price:650000, sizes:['S','M','L','XL'], image:null, material:'Kaki dày chính phục' },
  { id:'sp03', name:'Áo thun cotton dày', price:320000, sizes:['M','L','XL'], image:null, material:'Cotton compact 100%' },
  { id:'sp04', name:'Áo sơ mi linen', price:590000, sizes:['S','M','L','XL'], image:null, material:'Linen cao cấp' },
  { id:'sp05', name:'Áo hoodie nỉ bông', price:790000, sizes:['M','L','XL'], image:null, material:'Nỉ bông dày' },
  { id:'sp06', name:'Váy linen tay bồng', price:550000, sizes:['S','M','L'], image:null, material:'Linen pha cotton' },
  { id:'sp07', name:'Quần shorts kaki', price:420000, sizes:['S','M','L','XL'], image:null, material:'Kaki dày thoáng khí' },
  { id:'sp08', name:'Áo sơ mi denim', price:720000, sizes:['S','M','L','XL'], image:null, material:'Denim wash nhẹ' },
];

async function loadProductImages() {
  try {
    const res = await fetch('http://localhost:3000/api/images/products');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const images = data.products || data;
    if (!Array.isArray(images)) { renderProducts(); return; }
    images.forEach(img => {
      const p = PRODUCTS.find(x => x.id === img.product_id);
      if (p) {
        p.image = img.image_url;
        if (img.stock !== undefined) p.stock = img.stock;
        if (img.stock_by_size) p.stock_by_size = img.stock_by_size;
      }
    });
    renderProducts();
  } catch (e) {
    console.warn('Không tải được ảnh từ DB, dùng fallback màu swatch:', e.message);
    renderProducts();
  }
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  grid.innerHTML = PRODUCTS.map((p) => {
    const imgUrl = p.image || null;
    const stock = p.stock ?? 200;
    const stockBadge = stock === 0 ? '<span style="position:absolute;top:12px;right:12px;background:#c62828;color:#fff;font-size:11px;padding:3px 8px;border-radius:4px;">Hết hàng</span>'
      : stock <= 5 ? `<span style="position:absolute;top:12px;right:12px;background:#e65100;color:#fff;font-size:11px;padding:3px 8px;border-radius:4px;">Chỉ còn ${stock}</span>`
      : '';
    return `<div class="product-card" data-id="${p.id}" style="position:relative;">
      <div class="product-image" style="border-radius:10px;overflow:hidden;">
        ${imgUrl
          ? `<img class="product-swatch" src="${imgUrl}" alt="${p.name}" loading="lazy" style="width:100%; height:280px; object-fit:cover;">`
          : `<div style="width:100%; height:280px; display:flex; align-items:center; justify-content:center; color:#8e8e8e; font-size:13px;">📷</div>`
        }
      </div>
      <div class="product-info">
        <h3 class="product-name">${p.name}</h3>
        <p class="product-material">${p.material}</p>
        <p class="product-price">${p.price.toLocaleString('vi-VN')}₫</p>
      </div>
      ${stockBadge}
    </div>`;
  }).join('');

  // Gắn sự kiện click
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      const p = PRODUCTS.find(x => x.id === id);
      if (p) openProductModal(p);
    });
  });
}

// ====== Product Modal ======
let selectedSize = null;
let cart = [];

function openProductModal(p) {
  selectedSize = null;
  const m = document.getElementById("productModal");
  document.getElementById("modalImage").src = p.image || '';
  document.getElementById("modalImage").style.display = p.image ? 'block' : 'none';
  document.getElementById("modalName").textContent = p.name;
  document.getElementById("modalDesc").textContent = p.material;
  document.getElementById("modalPrice").textContent = `${p.price.toLocaleString('vi-VN')}₫`;
  
  // Hiển thị tồn kho — ưu tiên stock_by_size nếu có
  const stockEl = document.getElementById("modalStock");
  const stockBySize = p.stock_by_size;
  if (stockBySize && stockBySize.length > 0) {
    // Tạo map size → stock
    const sizeStockMap = {};
    stockBySize.forEach(item => { sizeStockMap[item.size] = item.stock; });
    const total = stockBySize.reduce((s, i) => s + i.stock, 0);
    const sizes = p.sizes.map(s => `${s}: ${sizeStockMap[s] !== undefined ? sizeStockMap[s] : '?'} cái`).join(" | ");
    stockEl.innerHTML = `<span style="font-size:12px;">📦 Kho: </span><span style="font-size:12px;font-weight:500;">${sizes}</span>`;
    stockEl.style.color = total === 0 ? "#c62828" : "#555";
    
    // Cập nhật stock tổng
    p.stock = total;
  } else {
    const stock = p.stock ?? 200;
    if (stock === 0) {
      stockEl.textContent = "❌ Hết hàng";
      stockEl.style.color = "#c62828";
    } else if (stock <= 5) {
      stockEl.textContent = `⚠️ Chỉ còn ${stock} cái`;
      stockEl.style.color = "#e65100";
    } else {
      stockEl.textContent = `✅ Còn ${stock} cái trong kho`;
      stockEl.style.color = "#2e7d32";
    }
  }
  
  const sizeContainer = document.getElementById("modalSizes");
  sizeContainer.innerHTML = '';
  p.sizes.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'size-btn';
    btn.textContent = s;
    btn.addEventListener('click', () => {
      sizeContainer.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSize = s;
      // Cập nhật stock theo size được chọn
      const pStockBySize = p.stock_by_size;
      if (pStockBySize && pStockBySize.length > 0) {
        const sizeInfo = pStockBySize.find(i => i.size === s);
        if (sizeInfo) {
          const totalEl = document.getElementById("modalStock");
          if (sizeInfo.stock === 0) {
            totalEl.innerHTML = `🔴 <b>${s}</b>: Hết hàng`;
            totalEl.style.color = "#c62828";
          } else if (sizeInfo.stock <= 5) {
            totalEl.innerHTML = `🟠 <b>${s}</b>: Chỉ còn ${sizeInfo.stock} cái`;
            totalEl.style.color = "#e65100";
          } else {
            totalEl.innerHTML = `🟢 <b>${s}</b>: Còn ${sizeInfo.stock} cái`;
            totalEl.style.color = "#2e7d32";
          }
        }
      }
    });
    if (!selectedSize) { btn.classList.add('active'); selectedSize = s; }
    sizeContainer.appendChild(btn);
  });
  
  document.getElementById("modalAddCart").onclick = () => {
    if (!selectedSize) { alert('Vui lòng chọn size!'); return; }
    const qtyInput = document.getElementById("modalQty");
    const qty = parseInt(qtyInput?.value) || 1;
    const existing = cart.find(item => item.id === p.id && item.size === selectedSize);
    if (existing) { existing.qty += qty; }
    else { cart.push({ id: p.id, name: p.name, price: p.price, image: p.image, size: selectedSize, qty }); }
    localStorage.setItem('pho-cart', JSON.stringify(cart));
    updateCartUI();
    qtyInput.value = 1;
    m.style.display = 'none';
  };
  m.style.display = 'flex';
}

function closeProductModal() {
  document.getElementById("productModal").style.display = 'none';
}

function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + (parseFloat(i.price) || 0) * (i.qty || 0), 0);
  document.getElementById("cartCount").textContent = count;
  document.getElementById("cartTotal").textContent = total ? `${total.toLocaleString('vi-VN')}₫` : '0₫';

  const list = document.getElementById("cartList");
  list.innerHTML = '';
  if (cart.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Giỏ hàng trống';
    empty.style.cssText = 'color:#8e8e8e; text-align:center; padding:2rem;';
    list.appendChild(empty);
    return;
  }
  cart.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    const imgUrl = item.image || null;
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        ${imgUrl ? `<img src="${imgUrl}" alt="${item.name}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : '<div style="width:50px;height:50px;background:#e8e4da;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">👕</div>'}
        <div>
          <strong>${item.name}</strong> — ${item.size}<br>
          <small>${(parseFloat(item.price) || 0).toLocaleString('vi-VN')}₫ x ${item.qty || 0}</small>
        </div>
      </div>
      <button class="cart-item-remove" data-index="${idx}">✕</button>
    `;
    div.querySelector('.cart-item-remove').addEventListener('click', () => {
      cart.splice(idx, 1);
      localStorage.setItem('pho-cart', JSON.stringify(cart));
      updateCartUI();
    });
    list.appendChild(div);
  });
}

document.getElementById("cartBtn").addEventListener("click", () => {
  document.getElementById("cartPanel").classList.toggle("open");
});
document.getElementById("cartClose").addEventListener("click", () => {
  document.getElementById("cartPanel").classList.remove("open");
});
document.addEventListener("click", (e) => {
  const panel = document.getElementById("cartPanel");
  const btn = document.getElementById("cartBtn");
  if (panel.classList.contains("open") && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove("open");
  }
});
document.getElementById("productModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeProductModal();
});
document.getElementById("modalClose").addEventListener("click", closeProductModal);

const savedCart = localStorage.getItem('pho-cart');
if (savedCart) {
  try {
    cart = JSON.parse(savedCart);
    // Chuẩn hóa dữ liệu cũ: đảm bảo mỗi item có qty
    cart.forEach(item => {
      if (item.qty === undefined) item.qty = item.quantity || 1;
      delete item.quantity;
    });
    updateCartUI();
  } catch(e) {}
}

// ====== Modal quantity controls ======
let modalQty = 1;
document.getElementById("modalQtyMinus")?.addEventListener("click", () => {
  const input = document.getElementById("modalQty");
  let val = parseInt(input.value) || 1;
  if (val > 1) { val--; input.value = val; }
});
document.getElementById("modalQtyPlus")?.addEventListener("click", () => {
  const input = document.getElementById("modalQty");
  let val = parseInt(input.value) || 1;
  if (val < 10) { val++; input.value = val; }
});

// ====== Chat widget ======
const chatWidget = document.getElementById("chatWidget");
const chatToggle = document.getElementById("chatToggle");
const chatPanel = document.getElementById("chatPanel");
const chatClose = document.getElementById("chatClose");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");
const chatSend = document.getElementById("chatSend");
const chatStatus = document.getElementById("chatStatus");

const SESSION_ID = localStorage.getItem('pho-studio-chat-session') || (() => {
  const id = "web-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem('pho-studio-chat-session', id);
  return id;
})();

const CHAT_STORAGE_KEY = 'pho-studio-chat-messages';

function saveChatMessages() {
  const msgs = [];
  chatMessages.querySelectorAll('.msg').forEach((el) => {
    const kind = el.className.replace('msg msg-', '');
    msgs.push({ kind, html: el.innerHTML });
  });
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
}

function restoreChatMessages() {
  const saved = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!saved) return;
  try {
    const msgs = JSON.parse(saved);
    chatMessages.innerHTML = '';
    msgs.forEach(({ kind, html, text }) => {
      const div = document.createElement('div');
      div.className = `msg msg-${kind}`;
      // Hỗ trợ cả dữ liệu cũ (text) và mới (html)
      if (html) {
        div.innerHTML = html;
      } else if (text) {
        let processed = text
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        processed = processed.replace(/\n/g, '<br>');
        processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        div.innerHTML = processed;
      }
      chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (e) { /* ignore corrupt data */ }
}

restoreChatMessages();

function openChat() {
  if (!chatPanel || !chatInput) return;
  chatPanel.style.display = 'flex';
  chatInput.focus();
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}
function closeChat() {
  if (!chatPanel) return;
  chatPanel.style.display = 'none';
}

chatToggle?.addEventListener("click", (e) => {
  if (!chatPanel) return;
  if (chatPanel.style.display === 'none') {
    openChat();
  }
  e.stopPropagation();
});
chatClose?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeChat();
});

chatWidget?.addEventListener("click", (e) => {
  if (!chatPanel || chatPanel.style.display !== 'none') return;
  if (e.target.closest('#chatPanel')) return;
  openChat();
});

function appendMessage(text, kind) {
  const div = document.createElement("div");
  div.className = `msg msg-${kind}`;
  if (kind === "bot" || kind === "loading") {
    let html = text
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    // Xử lý các định dạng markdown theo thứ tự
    // 1. Hình ảnh ![alt](url) — ưu tiên trước
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;display:block">');
    // 2. Link [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#0d3b66;text-decoration:underline">$1</a>');
    // 3. In đậm **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 4. In nghiêng *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 5. Dòng gạch ngang
    html = html.replace(/^[-—]{2,}$/gm, '<hr>');
    // 6. Trích dẫn > text
    html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // 7. Danh sách
    html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // 8. Xuống dòng
    html = html.replace(/\n/g, '<br>');
    
    div.innerHTML = html;
  } else {
    div.textContent = text;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  saveChatMessages();
  return div;
}

// ----- Resize chat-panel từ góc trên-trái -----
const chatPanelEl = document.getElementById('chatPanel');
const resizeHandle = document.getElementById('chatResizeHandle');

let isResizing = false;
let startX, startY, startW, startH;

function startResize(clientX, clientY) {
  isResizing = true;
  startX = clientX;
  startY = clientY;
  startW = chatPanelEl.offsetWidth;
  startH = chatPanelEl.offsetHeight;
}

function doResize(clientX, clientY) {
  if (!isResizing) return;
  const dx = startX - clientX;
  const dy = startY - clientY;
  const newW = Math.min(Math.max(startW + dx, 320), window.innerWidth * 0.9);
  const newH = Math.min(Math.max(startH + dy, 300), window.innerHeight * 0.8);
  chatPanelEl.style.width = newW + 'px';
  chatPanelEl.style.height = newH + 'px';
}

function stopResize() {
  isResizing = false;
}

resizeHandle?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  startResize(e.clientX, e.clientY);
});
document.addEventListener('mousemove', (e) => doResize(e.clientX, e.clientY));
document.addEventListener('mouseup', stopResize);

resizeHandle?.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  startResize(t.clientX, t.clientY);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  doResize(t.clientX, t.clientY);
}, { passive: true });
document.addEventListener('touchend', stopResize);

// ----- Gửi tin nhắn -----
chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  
  appendMessage(text, "user");
  chatInput.value = "";
  chatInput.style.height = "auto";
  
  const loadingEl = appendMessage("⏳ Đang suy nghĩ...", "loading");
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        session_id: SESSION_ID
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server lỗi ${res.status}`);
    }
    
    const data = await res.json();
    loadingEl.remove();
    const reply = data.reply || data.message || data.text || JSON.stringify(data);
    appendMessage(reply, "bot");
  } catch (err) {
    loadingEl.remove();
    if (err.name === 'AbortError') {
      appendMessage("❌ Server không phản hồi, vui lòng thử lại sau.", "error");
    } else {
      appendMessage("❌ Lỗi: " + err.message, "error");
    }
  }
});

// Auto-resize input
chatInput?.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

// ====== Sản phẩm gợi ý nhanh ======
// ----- Payment / Checkout -----

// ====== Payment Modal ======
document.getElementById("checkoutBtn")?.addEventListener("click", () => {
  if (cart.length === 0) { alert("Giỏ hàng trống!"); return; }
  document.getElementById("customerInfoSection").style.display = 'block';
  document.getElementById("paymentSection").style.display = 'none';
  document.getElementById("paymentModal").style.display = 'flex';
});

document.getElementById("paymentClose")?.addEventListener("click", () => {
  document.getElementById("paymentModal").style.display = 'none';
});

document.addEventListener("click", (e) => {
  const modal = document.getElementById("paymentModal");
  if (e.target === modal) modal.style.display = 'none';
});

document.getElementById("submitInfoBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const email = document.getElementById("customerEmail").value.trim();
  const address = document.getElementById("customerAddress").value.trim();
  const note = document.getElementById("customerNote").value.trim();

  if (!name) { alert("Vui lòng nhập họ tên!"); return; }
  if (!phone) { alert("Vui lòng nhập số điện thoại!"); return; }
  if (!address) { alert("Vui lòng nhập địa chỉ!"); return; }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const items = cart.map(i => ({ name: i.name, quantity: i.qty, price: i.price, size: i.size || '' }));

  try {
    const res = await fetch("http://localhost:3000/api/payment/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: total, items,
        customer_name: name, customer_phone: phone, customer_email: email, customer_address: address, customer_note: note
      })
    });
    const data = await res.json();
    if (!res.ok) { alert("Lỗi: " + (data.error || "Không thể tạo đơn")); return; }

    // Hiển thị QR
    window._currentOrderId = data.orderId;
    document.getElementById("customerInfoSection").style.display = 'none';
    document.getElementById("paymentSection").style.display = 'block';
    document.getElementById("qrImage").src = data.qrData;
    document.getElementById("paymentInfo").innerHTML = `
      <p><strong>Số tiền:</strong> ${data.amount.toLocaleString('vi-VN')}₫</p>
      <p><strong>Mã đơn:</strong> ${data.orderId}</p>
      <p><strong>Nội dung CK:</strong> ${data.transferContent}</p>
      <p><strong>STK:</strong> ${data.bankInfo.account} - ${data.bankInfo.bank}</p>
      <p><strong>Chủ TK:</strong> ${data.bankInfo.holder}</p>
    `;

    // Polling kiểm tra thanh toán
    window._paymentCheckInterval = setInterval(async () => {
      try {
        const checkRes = await fetch("http://localhost:3000/api/payment/status/" + data.orderId);
        const checkData = await checkRes.json();
        if (checkData.status === 'paid') {
          clearInterval(window._paymentCheckInterval);
          alert("✅ Thanh toán thành công! Cảm ơn bạn!");
          cart = [];
          localStorage.setItem('pho-cart', JSON.stringify(cart));
          updateCartUI();
          document.getElementById("paymentModal").style.display = 'none';
        }
      } catch(e) {}
    }, 5000);

  } catch(err) {
    alert("Lỗi kết nối: " + err.message);
  }
});

// Nút "Đã chuyển khoản" — xác nhận thủ công
document.getElementById("paymentDoneBtn")?.addEventListener("click", async () => {
  if (!window._currentOrderId) { alert("Không có đơn hàng để xác nhận."); return; }
  try {
    const res = await fetch("http://localhost:3000/api/payment/confirm/" + window._currentOrderId, {
      method: "POST"
    });
    const result = await res.json();
    if (!res.ok) { alert("Lỗi: " + (result.error || "Xác nhận thất bại")); return; }
    if (window._paymentCheckInterval) clearInterval(window._paymentCheckInterval);
    alert("✅ Đã xác nhận thanh toán! Cảm ơn bạn!");
    cart = [];
    localStorage.setItem('pho-cart', JSON.stringify(cart));
    updateCartUI();
    document.getElementById("paymentModal").style.display = 'none';
  } catch(err) {
    alert("Lỗi kết nối: " + err.message);
  }
});

// Xử lý returnUrl từ PayOS
const urlParams = new URLSearchParams(window.location.search);
const returnOrderId = urlParams.get('orderId');
if (returnOrderId) {
  fetch(`http://localhost:3000/api/payment/status/${returnOrderId}`)
    .then(r => r.json())
    .then(order => {
      if (order.status === 'paid') {
        alert(`✅ Đơn hàng ${returnOrderId} đã thanh toán thành công! Cảm ơn bạn!`);
        cart = [];
        localStorage.setItem('pho-cart', JSON.stringify(cart));
        updateCartUI();
      }
    })
    .catch(() => {});
  window.history.replaceState({}, '', window.location.pathname);
}

loadProductImages();
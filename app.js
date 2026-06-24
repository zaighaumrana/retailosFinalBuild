/* ═══════════════════════════════════════════════════════════════════
   RetailOS — app.js (POS only)
   Roles served: Cashier, Technician
   Admin/Manager → redirected to admin.html
═══════════════════════════════════════════════════════════════════ */
import {
  sb, state, CFG, loadConfig, applyBranding, currentTenant,
  _loadSession, _saveSession, _clearSession,
  can, verifyLogin, validatePassword,
  createTicket, updateTicket,
  printThermal, buildTicketSlip, buildReceiptSlip, buildReturnSlip,
  money, fld, modalActions, statusBadge,
  openPinPrompt, pinPromptHTML, handlePpKey,
  logBillEvent,
} from "./shared.js";

/* ── POS-only state ── */
const posState = {
  cart:            [],
  checkoutPayment: "Cash",
  cashTendered:    0,
  cartTicketId:    null,
  cartAdvance:     0,
  cartLabour:      0,
  udharName:       "",
  udharPhone:      "",
  invSearch:       "",
};

let SESSION = _loadSession();

/* ── Load data needed by POS ── */
async function load() {
  await loadConfig();
  const fetchInventory = CFG.inventory_module_enabled
    ? sb.from("inventory").select("*").order("name")
    : Promise.resolve({ data: [] });
  const [tickets, sales, udhar, returns_, inventory_] = await Promise.all([
    sb.from("tickets").select("*").order("id", { ascending: false }),
    sb.from("sales").select("*").order("id", { ascending: false }),
    sb.from("udhar").select("*").order("id", { ascending: false }),
    sb.from("returns").select("*").order("id", { ascending: false }),
    fetchInventory,
  ]);
  state.data = {
    tickets:   tickets.data    || [],
    sales:     sales.data      || [],
    employees: [],
    udhar:     udhar.data      || [],
    returns:   returns_.data   || [],
    inventory: inventory_.data || [],
  };
  applyBranding();
  render();
}

/* ── Login screen ── */
function loginScreen() {
  return `
    <div style="min-height:100vh;display:grid;place-items:center;background:var(--bg);padding:16px">
      <div class="card" style="width:min(400px,95vw);display:grid;gap:20px;padding:32px">
        <div style="text-align:center;display:grid;gap:8px">
          <div class="logo" style="margin:0 auto 8px;width:72px;height:72px;font-size:20px;overflow:hidden">
            ${CFG.shop_logo ? `<img src="${CFG.shop_logo}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">` : CFG.shop_name?.slice(0,2).toUpperCase()||"FP"}
          </div>
          <h2 style="margin:0">${CFG.shop_name||"RetailOS"}</h2>
          <p class="muted" style="font-size:13px;margin:0">Sign in to continue</p>
        </div>
        <div style="display:grid;gap:10px">
          <label class="field"><span>Email</span>
            <input id="login-email" type="email" autocomplete="email" placeholder="your@email.com" style="font-size:15px" autofocus></label>
          <label class="field"><span>Password</span>
            <input id="login-password" type="password" autocomplete="current-password" placeholder="Your password" style="font-size:15px"></label>
          <div id="login-error" class="hidden" style="color:var(--danger);font-size:13px;text-align:center;padding:4px 0">Incorrect email or password.</div>
          <button type="button" data-action="forgot-password"
            style="font-size:12px;color:var(--primary);background:none;border:none;cursor:pointer;text-align:right;padding:0">
            Forgot password?
          </button>
          <div id="cf-turnstile-wrap" style="display:flex;justify-content:center;margin:4px 0"></div>
          <button id="login-btn" class="primary-button" style="width:100%;font-size:15px;padding:12px" data-action="login-submit">
            Login
          </button>
        </div>
        <p class="muted" style="text-align:center;font-size:12px;margin:0">${CFG.shop_address||""}</p>
      </div>
    </div>`;
}

async function submitLogin() {
  const emailEl = document.getElementById("login-email");
  const passEl  = document.getElementById("login-password");
  const errEl   = document.getElementById("login-error");
  const btn     = document.getElementById("login-btn");
  const email   = emailEl?.value?.trim() || "";
  const pass    = passEl?.value?.trim()  || "";
  if (!email || !pass) {
    if (errEl) { errEl.textContent = "Please enter your email and password."; errEl.classList.remove("hidden"); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "Logging in…"; }
  if (errEl) errEl.classList.add("hidden");

  // 1. Owner login → redirect to admin
  if (email.toLowerCase() === (CFG.owner_email || "").toLowerCase() && pass === CFG.owner_password) {
    SESSION = { employee: { name: "Admin", role: "Business Owner", email }, isAdmin: true };
    _saveSession(SESSION, "admin", "dashboard");
    // Small delay to ensure sessionStorage is written before redirect
    setTimeout(() => { window.location.href = "./admin.html"; }, 50);
    return;
  }

  // 2. Employee login
  const res = await verifyLogin(email, pass);
  if (res.ok) {
    SESSION = { employee: res.employee, isAdmin: false };
    const role = res.employee.role;
    state.role = role;
    if (role === "Business Owner" || role === "Manager") {
      _saveSession(SESSION, "admin", "dashboard");
      setTimeout(() => { window.location.href = "./admin.html"; }, 50);
      return;
    }
    const route = role === "Technician" ? "workshop" : "pos";
    _saveSession(SESSION, route, "");
    render();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = "Login"; }
    if (errEl) { errEl.textContent = "Incorrect email or password."; errEl.classList.remove("hidden"); }
    if (passEl) { passEl.value = ""; passEl.focus(); }
  }
}

/* ── Render ── */
function render() {
  if (!SESSION.employee) {
    document.getElementById("app").innerHTML = loginScreen();
    const wrap = document.getElementById("cf-turnstile-wrap");
    if (wrap && window.turnstile && !wrap.dataset.mounted) {
      wrap.dataset.mounted = "1";
      window.turnstile.render(wrap, {
        sitekey: "0x4AAAAAADl87EDGnxcg5eJZ",
        theme:   state.theme === "dark" ? "dark" : "light",
        callback: () => { const b=document.getElementById("login-btn"); if(b) b.disabled=false; },
        "error-callback": () => { const b=document.getElementById("login-btn"); if(b) b.disabled=true; },
      });
      const b = document.getElementById("login-btn"); if (b) b.disabled = true;
    }
    return;
  }
  if (CFG.suspended) {
    document.getElementById("app").innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;text-align:center;padding:24px">
        <div style="font-size:48px">🔒</div>
        <h2 style="color:var(--danger)">Account Suspended</h2>
        <p class="muted" style="max-width:360px;line-height:1.6">This RetailOS account has been suspended. Please contact your service provider.</p>
      </div>`; return;
  }
  state.role = SESSION.employee.role;
  const tenant = currentTenant();
  const view   = state.role === "Technician" ? "Workshop" : "POS Counter";
  document.getElementById("app").innerHTML = `
    <div class="app-shell client-shell">
      <main class="main">
        <header class="topbar">
          <div class="brand top-brand">
            <div class="logo">${tenant.logo?`<img alt="" src="${tenant.logo}">`:tenant.name.slice(0,2).toUpperCase()}</div>
            <div>
              <strong>${tenant.name}</strong>
              <span class="muted" style="font-size:12px">${state.role} · ${view}</span>
            </div>
          </div>
          <div class="top-actions">
            <span class="chip"><strong style="font-size:12px">${SESSION.employee.name}</strong></span>
            <span class="chip"><i class="dot ${state.online?"":"offline"}"></i>${state.online?"Online":"Offline"}</span>
            ${state.installPrompt?`<button class="icon-button" data-action="install">Install</button>`:""}
            <button class="icon-button" data-action="theme">${state.theme==="dark"?"Light":"Dark"}</button>
            <button class="icon-button" data-action="logout" style="color:var(--danger)">Logout</button>
          </div>
        </header>
        <section class="content">
          ${state.role === "Technician" ? workshopView() : posView()}
        </section>
      </main>
    </div>
    ${renderModal()}`;
}

/* ── POS View ── */
function posView() {
  const tenant   = currentTenant();
  const subtotal = posState.cart.reduce((s,i) => s + i.soldPrice * i.qty, 0);
  const disc     = posState.cart.reduce((s,i) => s + (i.originalPrice - i.soldPrice)*i.qty, 0);
  const tax      = subtotal * (tenant.taxRate / 100);
  const grandTotal = subtotal + tax;
  const tendered = posState.cashTendered || 0;
  const change   = tendered - grandTotal;

  return `
    <div class="page-title">
      <div>
        <h1>Point of Sale</h1>
        <p class="muted">Counter · ${tenant.name} · <strong>${SESSION.employee.name}</strong></p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="secondary-button" data-action="shift-stats">📋 Shift Stats</button>
        ${CFG.repair_module_enabled ? `
          <button class="primary-button" data-modal="repair">+ New Ticket</button>
          <button class="secondary-button" data-action="add-ticket-to-cart">Collect Repair</button>` : ""}
        <button class="secondary-button" data-action="open-return">↩ Return</button>
        <button class="secondary-button" data-action="open-udhar">₨ Credits</button>
      </div>
    </div>
    <div class="grid pos-layout">
      <div class="grid" style="align-content:start;gap:12px">
        ${quickItemsPanel(tenant)}
        ${inventoryPanel()}
        ${repairQueuePanel(tenant)}
      </div>
      <aside class="card cart">
        <h2>Cart</h2>
        ${posState.cart.length ? posState.cart.map(item => `
          <div class="cart-line">
            <div>
              <strong>${item.name}</strong><br>
              <small class="muted">${money(item.soldPrice)} each${item.reason?" · "+item.reason:""}</small>
            </div>
            <div class="qty-controls">
              <button data-qty="${item.productId}" data-delta="-1">−</button>
              <strong>${item.qty}</strong>
              <button data-qty="${item.productId}" data-delta="1">+</button>
            </div>
            <button class="secondary-button" data-modal="override" data-id="${item.productId}">Price</button>
          </div>`).join("") : `<div class="empty">No items in cart.</div>`}
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
          ${disc>0?`<div class="total-row"><span>Discounts</span><strong style="color:var(--success)">− ${money(disc)}</strong></div>`:""}
          ${tax>0?`<div class="total-row"><span>Tax ${tenant.taxRate}%</span><strong>${money(tax)}</strong></div>`:""}
          <div class="total-row grand"><span>Total</span><strong>${money(grandTotal)}</strong></div>
        </div>
        <select class="tenant-switcher" data-action="payment">
          ${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer","Udhar (Credit)"].map(m=>
            `<option ${posState.checkoutPayment===m?"selected":""}>${m}</option>`).join("")}
        </select>
        ${posState.checkoutPayment === "Cash" ? `
          <div style="display:grid;gap:6px;margin-top:4px">
            <label style="font-size:13px;font-weight:500;color:var(--muted)">Cash Received</label>
            <input type="number" min="0" placeholder="Enter amount received"
              value="${tendered||""}" data-cash-tendered
              style="border:1px solid var(--border);border-radius:8px;padding:9px 12px;
                     background:var(--surface);color:var(--text);font-size:16px;width:100%">
            ${tendered>0?`
            <div style="display:flex;justify-content:space-between;padding:9px 12px;border-radius:8px;font-weight:600;font-size:15px;
                background:${change>=0?"color-mix(in srgb,#22c55e 12%,var(--surface))":"color-mix(in srgb,#ef4444 12%,var(--surface))"}">
              <span>${change>=0?"Change Due":"Short by"}</span>
              <span style="color:${change>=0?"#22c55e":"#ef4444"}">${money(Math.abs(change))}</span>
            </div>` : ""}
          </div>` : ""}
        ${posState.checkoutPayment === "Udhar (Credit)" ? `
          <div style="display:grid;gap:8px;margin-top:4px">
            <input class="search" placeholder="Customer name *" data-udhar="name" value="${posState.udharName||""}">
            <input class="search" placeholder="Customer phone *" data-udhar="phone" value="${posState.udharPhone||""}">
          </div>` : ""}
        <button class="primary-button" data-action="checkout" ${posState.cart.length?"":"disabled"}>
          Checkout & Receipt
        </button>
      </aside>
    </div>`;
}

function quickItemsPanel(tenant) {
  if (!(CFG.quick_items||[]).length) return `
    <div class="card">
      <h2 style="margin-bottom:12px">Custom Item</h2>
      ${customItemEntry()}
    </div>`;
  return `
    <div class="card">
      <h2 style="margin-bottom:12px">Quick Items</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        ${CFG.quick_items.map(item=>`
          <button class="secondary-button" style="font-size:15px;padding:11px 18px;border-radius:10px;font-weight:500"
            data-qitem-name="${item.name}" data-qitem-prices='${JSON.stringify(item.prices)}'>
            ${item.name}
          </button>`).join("")}
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <p style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Custom / One-off Item</p>
        ${customItemEntry()}
      </div>
    </div>`;
}

function customItemEntry() {
  return `
    <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:end">
      <label class="field" style="margin:0"><span style="font-size:12px">Item Name</span>
        <input id="custom-item-name" placeholder="e.g. Screen Guard" style="font-size:13px"></label>
      <label class="field" style="margin:0"><span style="font-size:12px">Price</span>
        <input id="custom-item-price" type="number" min="0" placeholder="0" style="width:90px;font-size:13px"></label>
      <button class="primary-button" style="padding:9px 14px;font-size:13px;white-space:nowrap" data-action="add-custom-item">+ Add</button>
    </div>`;
}

function inventoryPanel() {
  if (!CFG.inventory_module_enabled) return "";
  const invItems = (state.data.inventory||[]).filter(i=>Number(i.qty||0)>0);
  if (!invItems.length) return "";
  const f = (posState.invSearch||"").toLowerCase();
  const filtered = f ? invItems.filter(i=>(i.name||"").toLowerCase().includes(f)||(i.category||"").toLowerCase().includes(f)) : invItems;
  return `
    <div class="card">
      <h2 style="margin-bottom:10px">Stock Items</h2>
      <input placeholder="Search stock…" value="${posState.invSearch||""}" data-inv-search
        style="width:100%;margin-bottom:10px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text);font-size:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${filtered.slice(0,24).map(i=>`
          <button class="secondary-button" style="font-size:13px;padding:8px 14px;border-radius:8px;text-align:left"
            data-inv-pos-add="${i.id}" data-inv-pos-name="${i.name}" data-inv-pos-price="${i.price}">
            <div style="font-weight:600">${i.name}</div>
            <div style="font-size:11px;color:var(--muted)">${money(i.price)} · ${i.qty} left</div>
          </button>`).join("")}
      </div>
    </div>`;
}

function repairQueuePanel(tenant) {
  if (!CFG.repair_module_enabled) return `
    <div class="card"><h2>Quick Sale</h2>
      <p class="muted" style="font-size:13px">Add items using the cart panel.</p>
    </div>`;
  const open = (state.data.tickets||[]).filter(t=>!["Delivered","Declined"].includes(t.status)).slice(0,8);
  return `
    <div class="card">
      <h2 style="margin-bottom:12px">Open Repair Tickets</h2>
      ${open.map(t=>`
        <div class="list-row" style="margin-bottom:6px">
          <div>
            <strong>${t.customer_name}</strong>
            <span class="badge warn" style="margin-left:6px">${t.status}</span><br>
            <small class="muted">${t.ticket_number} · ${t.device_brand} ${t.device_model}</small>
          </div>
          <button class="primary-button" style="font-size:12px;padding:6px 10px" data-quick-collect="${t.id}">Collect</button>
        </div>`).join("") || `<div class="empty">No open tickets.</div>`}
    </div>`;
}

/* ── Workshop View (Technician) ── */
function workshopView() {
  const active = (state.data.tickets||[]).filter(t=>
    !["Delivered","Declined"].includes(t.status) &&
    (`${t.customer_name} ${t.ticket_number} ${t.device_brand} ${t.device_model} ${t.status}`)
      .toLowerCase().includes((state.filter||"").toLowerCase())
  );
  const statusColors = {"Pending":"warn","In Progress":"warn","Ready":"good","Delivered":"good","Declined":"bad"};
  return `
    <div style="display:grid;gap:16px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h1 style="margin:0;font-size:20px">My Repair Queue</h1>
          <p class="muted" style="font-size:13px;margin:4px 0 0">${active.length} active ticket${active.length!==1?"s":""}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${["Pending","In Progress","Ready"].map(s=>{
            const count=(state.data.tickets||[]).filter(t=>t.status===s).length;
            return `<span class="badge ${statusColors[s]}" style="font-size:12px;padding:5px 10px">${s}: ${count}</span>`;
          }).join("")}
        </div>
      </div>
      <input class="search" placeholder="Search customer, device, ticket…" data-filter="repair" value="${state.filter||""}" style="font-size:14px;padding:10px 14px">
      ${active.length ? active.map(t=>`
        <div class="card" style="display:grid;gap:12px;cursor:pointer" data-view-ticket="${t.id}">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
            <div style="display:grid;gap:3px">
              <strong style="font-size:16px">${t.customer_name}</strong>
              <span class="muted" style="font-size:12px">${t.ticket_number} · ${t.customer_phone||""}</span>
            </div>
            <span class="badge ${statusColors[t.status]||"warn"}" style="flex-shrink:0;font-size:12px">${t.status}</span>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
            <span>📱 <strong>${t.device_brand} ${t.device_model}</strong></span>
            ${t.imei?`<span class="muted">IMEI: ${t.imei}</span>`:""}
          </div>
          ${(t.components_noted||[]).length?`<div style="font-size:12px;color:var(--muted)">Parts: ${t.components_noted.map(c=>c.name).join(", ")}</div>`:""}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${["Pending","In Progress","Ready"].map(s=>s!==t.status?`
              <button class="secondary-button" style="font-size:12px;padding:6px 12px"
                data-action="tech-status" data-ticket-id="${t.id}" data-status="${s}">→ ${s}</button>`:""
            ).join("")}
            <button class="primary-button" style="font-size:12px;padding:6px 12px"
              data-action="open-ticket-editor" data-ticket-id="${t.id}">Edit Components</button>
            <button class="secondary-button" style="font-size:12px;padding:6px 12px"
              data-action="workshop-collect" data-ticket-id="${t.id}">Collect → POS</button>
          </div>
        </div>`).join("") : `
        <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
          <div style="font-size:36px;margin-bottom:12px">✅</div>
          <strong>All clear</strong>
          <p style="font-size:13px;margin:6px 0 0">No active repair tickets right now.</p>
        </div>`}
    </div>`;
}

/* ── Shift stats ── */
function buildShiftStats() {
  const tenant    = currentTenant();
  const todayStr  = new Date().toISOString().slice(0,10);
  const empName   = SESSION.employee?.name || "";
  const shiftSales = (state.data.sales||[]).filter(s=>(s.created_at||"").slice(0,10)===todayStr&&(!empName||s.employee_name===empName));
  const itemsSold  = shiftSales.reduce((s,sale)=>s+(sale.items_sold||[]).reduce((x,i)=>x+(i.qty||1),0),0);
  const revenue    = shiftSales.reduce((s,sale)=>s+Number(sale.total_bill||0),0);
  const cashOnly   = shiftSales.filter(s=>s.payment_method==="Cash").reduce((s,sale)=>s+Number(sale.total_bill||0),0);
  const discounts  = shiftSales.reduce((s,sale)=>s+Number(sale.discount||0),0);
  const custCount  = new Set(shiftSales.map(s=>s.customer_name).filter(Boolean)).size;
  const allTickets = state.data.tickets||[];
  const shiftTkts  = allTickets.filter(t=>(t.created_at||"").slice(0,10)===todayStr&&(!empName||t.created_by===empName));
  const pendingAll = allTickets.filter(t=>!["Delivered","Declined"].includes(t.status));
  return `
    <div class="shift-print">
      <center><strong>${tenant.name}</strong><br>Shift Summary — ${todayStr}<br>${empName||"All Staff"}</center>
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
      <div class="stat-row"><span>Products sold</span><span>${itemsSold}</span></div>
      <div class="stat-row"><span>Total revenue</span><span>${money(revenue)}</span></div>
      <div class="stat-row"><span>Cash collected</span><span>${money(cashOnly)}</span></div>
      <div class="stat-row"><span>Discounts given</span><span>${money(discounts)}</span></div>
      <div class="stat-row"><span>Customers served</span><span>${custCount}</span></div>
      ${CFG.repair_module_enabled?`
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
      <div class="stat-row"><span>Tickets this shift</span><span>${shiftTkts.length}</span></div>
      <div class="stat-row"><span>All pending (shop)</span><span>${pendingAll.length}</span></div>
      `:""}
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
      <center style="color:#888;font-size:11px">Printed ${new Date().toLocaleString()}</center>
    </div>`;
}

/* ── Modals ── */
function renderModal() {
  if (!state.modal) return "";
  const { type, id } = state.modal;
  const tenant = currentTenant();

  if (type === "pinPrompt") return `<div class="modal-backdrop">${pinPromptHTML(state.modal.purpose)}</div>`;

  if (type === "shiftStats") return `<div class="modal-backdrop">
    <div class="modal" style="max-width:480px">
      <h2>Shift Stats</h2>
      <div class="shift-print-wrap">${buildShiftStats()}</div>
      <div class="modal-actions">
        <button class="secondary-button" data-close>Close</button>
        <button class="primary-button" data-action="print-shift">Print / Save PDF</button>
      </div>
    </div></div>`;

  if (type === "receipt") return `<div class="modal-backdrop">
    <div class="modal">
      <h2>Receipt</h2>
      ${receiptPreview(state.modal.sale)}
      <div class="modal-actions">
        <button class="secondary-button" data-close>Close</button>
        <button class="primary-button" data-action="print-receipt">Print / Save PDF</button>
      </div>
    </div></div>`;

  if (type === "ticketCheckout") {
    const ticket = (state.data.tickets||[]).find(t=>String(t.id)===String(id));
    if (!ticket) return `<div class="modal-backdrop"><div class="modal"><p class="muted">Ticket not found.</p><div class="modal-actions"><button class="secondary-button" data-close>Close</button></div></div></div>`;
    const comps   = ticket.components_noted || [];
    const advance = Number(ticket.advance_payment||0);
    return `<div class="modal-backdrop" data-close>
      <div class="modal" style="max-width:640px" onclick="event.stopPropagation()">
        <h2>Checkout — ${ticket.ticket_number}</h2>
        <p class="muted">${ticket.customer_name} · ${ticket.device_brand} ${ticket.device_model}</p>
        ${advance>0?`<div style="background:color-mix(in srgb,var(--warning) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--warning) 30%,var(--border));border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:8px">
          Advance paid: ${money(advance)} (${ticket.advance_method}) — will be deducted.</div>`:""}
        <div style="display:grid;gap:6px;margin-bottom:10px" id="tc-list">
          ${comps.map((c,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:9px;background:var(--surface-2);border-radius:8px">
              <span style="flex:1"><strong>${c.name}</strong><span class="badge warn" style="margin-left:6px">${c.condition||""}</span></span>
              <input type="number" placeholder="Price" value="${c.price||""}" data-tc-price="${i}" min="0"
                style="width:110px;border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--surface);color:var(--text)">
              <button type="button" data-tc-remove="${i}" style="color:var(--danger);background:none;border:none;font-size:20px;line-height:1;padding:0 4px">×</button>
            </div>`).join("")}
        </div>
        <button type="button" class="secondary-button" data-tc-add style="font-size:13px;margin-bottom:12px">+ Add Component</button>
        <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;align-items:center;gap:10px">
          <label style="flex:1;font-size:14px">Labour / Technician Cost</label>
          <input type="number" id="tc-labour" value="${posState.cartLabour||0}" min="0"
            style="width:120px;border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--surface);color:var(--text)">
        </div>
        ${advance>0?`<div style="display:flex;justify-content:space-between;padding-top:8px;color:var(--success)"><span>Advance Deduction</span><strong>− ${money(advance)}</strong></div>`:""}
        <div style="display:flex;justify-content:space-between;padding-top:8px;font-size:20px;font-weight:800">
          <span>Total Payable</span><strong id="tc-total">${money(0)}</strong>
        </div>
        <div class="modal-actions" style="margin-top:12px">
          <button class="secondary-button" data-close>Cancel</button>
          <button class="danger-button" data-tc-decline>Declined by Customer</button>
          <button class="primary-button" data-tc-confirm>Add to Cart</button>
        </div>
      </div>
      <script>(function(){
        function recalc(){
          const prices=[...document.querySelectorAll('[data-tc-price]')].map(i=>Number(i.value)||0);
          const labour=Number(document.getElementById('tc-labour')?.value||0);
          const total=prices.reduce((s,p)=>s+p,0)+labour-${advance};
          const el=document.getElementById('tc-total');
          if(el)el.textContent='${CFG.currency||"Rs."} '+Math.max(0,total).toLocaleString();
        }
        document.addEventListener('input',function(e){if(e.target.dataset.tcPrice!==undefined||e.target.id==='tc-labour')recalc();});
        recalc();
      })()</\script></div>`;
  }

  if (type === "ticket-editor") {
    const tk = (state.data.tickets||[]).find(t=>String(t.id)===String(id));
    if (!tk) return "";
    const comps    = tk.components_noted||[];
    const partsTotal = comps.reduce((s,c)=>s+Number(c.price||0),0);
    const labourVal  = state.teLabour ?? Math.max(0,Number(tk.estimated_quote||0)-partsTotal);
    return `<div class="modal-backdrop" data-close>
      <div class="modal" style="max-width:500px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
        <h2>${tk.customer_name}</h2>
        <p class="muted" style="font-size:13px;margin-bottom:16px">${tk.ticket_number} · ${tk.device_brand} ${tk.device_model}</p>
        <div style="display:grid;gap:8px;margin-bottom:14px">
          <strong style="font-size:13px">Components</strong>
          ${comps.map((c,i)=>`
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center">
              <span style="font-size:13px">${c.name} <small class="muted">(${c.condition})</small></span>
              <input type="number" min="0" id="te-price-${i}" value="${c.price||0}" data-te-price="${i}"
                style="width:100px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface);color:var(--text);font-size:13px">
              <button type="button" data-te-remove="${i}" style="color:var(--danger);background:none;border:none;font-size:18px;cursor:pointer;padding:0 4px">×</button>
            </div>`).join("")}
          ${!comps.length?`<p class="muted" style="font-size:13px">No components yet.</p>`:""}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input id="te-new-comp" class="search" placeholder="Component name" style="flex:1">
          <select id="te-new-cond" style="border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--surface);color:var(--text);font-size:13px">
            ${["Repaired","Replaced","New","Cleaned","Checked"].map(c=>`<option>${c}</option>`).join("")}
          </select>
          <button type="button" class="secondary-button" data-action="te-add-comp">+ Add</button>
        </div>
        <label style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--surface-2);border-radius:8px;margin-bottom:8px;gap:12px">
          <span style="font-size:13px;font-weight:500">Labour Charge</span>
          <input type="number" min="0" id="te-labour" value="${labourVal<0?0:labourVal}" data-te-labour
            style="width:110px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface);color:var(--text);font-size:13px">
        </label>
        <div style="display:flex;justify-content:space-between;font-weight:600;padding:10px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <span>Updated Quote</span><span id="te-total">${money(partsTotal+(isNaN(labourVal)?0:labourVal))}</span>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" data-close>Cancel</button>
          <button class="primary-button" data-action="te-save">Save to Ticket</button>
        </div>
      </div></div>`;
  }

  if (type === "repair") {
    const comps = CFG.quick_components||[];
    const sel   = state.modal?.selectedComponents||[];
    const d     = state.modal?._draft||{};
    const fldV  = (label,name,val="",t="text") => `<label class="field"><span>${label}</span><input name="${name}" type="${t}" value="${String(val).replace(/"/g,'&quot;')}" placeholder="${label}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text)"></label>`;
    return `<div class="modal-backdrop">
      <form class="modal" data-form="repair" style="max-width:680px">
        <h2>New Repair Ticket</h2>
        <div class="form-grid">
          ${fldV("Customer Name","customerName",d.customerName)}
          ${fldV("Customer Phone","customerPhone",d.customerPhone,"tel")}
          ${fldV("Device Brand","deviceBrand",d.deviceBrand)}
          ${fldV("Device Model","deviceModel",d.deviceModel)}
          ${fldV("IMEI / Serial","imei",d.imei)}
          ${fldV("Estimated Quote","estimatedQuote",d.estimatedQuote??"","number")}
          ${fldV("Advance Received","advance",d.advance??"","number")}
          <label class="field"><span>Advance Method</span>
            <select name="advanceMethod">
              <option value="">None</option>
              ${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer"].map(m=>`<option ${d.advanceMethod===m?"selected":""}>${m}</option>`).join("")}
            </select></label>
          <label class="field" style="grid-column:1/-1"><span>Technician Note</span>
            <textarea name="technicianNote" style="min-height:56px">${d.technicianNote||""}</textarea></label>
        </div>
        <p class="muted" style="font-size:13px;margin:8px 0 6px">Tap to add issues:</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          ${comps.map(c=>{const active=sel.find(s=>s.name===c);return `<button type="button" class="${active?"primary-button":"secondary-button"}" style="font-size:13px;padding:6px 14px" data-comp="${c}">${c}${active?" ✓":""}</button>`;}).join("")}
        </div>
        ${sel.length?`<div style="display:grid;gap:6px;margin-bottom:10px">
          ${sel.map((s,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--surface-2);border-radius:8px">
              <strong style="flex:1">${s.name}</strong>
              <select data-comp-tag="${i}" style="border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface);color:var(--text)">
                ${["Repaired","Replaced","New","Cleaned","Checked"].map(t=>`<option ${t===s.tag?"selected":""}>${t}</option>`).join("")}
              </select>
              <button type="button" data-remove-comp="${i}" style="color:var(--danger);background:none;border:none;font-size:20px;line-height:1;padding:0 4px">×</button>
            </div>`).join("")}
        </div>`:""}
        ${modalActions()}
      </form></div>`;
  }

  if (type === "ticketDetail") {
    const tk = (state.data.tickets||[]).find(t=>String(t.id)===String(id));
    if (!tk) return `<div class="modal-backdrop"><div class="modal"><p class="muted">Ticket not found.</p><div class="modal-actions"><button class="secondary-button" data-close>Close</button></div></div></div>`;
    const statusColors = {"Pending":"warn","In Progress":"warn","Ready":"good","Delivered":"good","Declined":"bad"};
    return `<div class="modal-backdrop">
      <div class="modal" style="max-width:600px">
        <h2>${tk.ticket_number} <span class="badge ${statusColors[tk.status]||"warn"}" style="margin-left:8px">${tk.status}</span></h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:14px;margin-bottom:14px;padding:12px;background:var(--surface-2);border-radius:8px">
          <div><span class="muted">Customer</span><br><strong>${tk.customer_name}</strong></div>
          <div><span class="muted">Phone</span><br><strong>${tk.customer_phone||"—"}</strong></div>
          <div><span class="muted">Device</span><br><strong>${tk.device_brand} ${tk.device_model}</strong></div>
          <div><span class="muted">IMEI</span><br><strong>${tk.imei||"—"}</strong></div>
          <div><span class="muted">Quote</span><br><strong>${money(tk.estimated_quote||0)}</strong></div>
          <div><span class="muted">Advance</span><br><strong>${money(tk.advance_payment||0)}${tk.advance_method?" ("+tk.advance_method+")":""}</strong></div>
        </div>
        ${tk.technician_note?`<div style="background:color-mix(in srgb,var(--warning) 10%,var(--surface));border-left:3px solid var(--warning);padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:12px;font-size:14px"><strong>Note:</strong> ${tk.technician_note}</div>`:""}
        ${(tk.components_noted||[]).length?`
          <div style="display:grid;gap:6px;margin-bottom:12px">
            ${tk.components_noted.map(c=>`
              <div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--surface-2);border-radius:8px;font-size:14px">
                <span><strong>${c.name}</strong> <span class="badge warn" style="font-size:11px">${c.condition||""}</span></span>
                <span>${c.price>0?money(c.price):'<span class="muted">Not priced</span>'}</span>
              </div>`).join("")}
          </div>`:``}
        <div style="border-top:1px solid var(--border);padding-top:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="td-status" style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text);flex:1">
              ${["Pending","In Progress","Ready","Delivered","Declined"].map(s=>`<option ${s===tk.status?"selected":""}>${s}</option>`).join("")}
            </select>
            <input type="number" id="td-actual-quote" placeholder="Actual price (optional)" value="${tk.actual_quote||""}"
              style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text);width:180px">
          </div>
          <textarea id="td-note" placeholder="Add a note…" style="width:100%;margin-top:8px;min-height:60px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text);box-sizing:border-box">${tk.update_note||""}</textarea>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" data-close>Close</button>
          <button class="primary-button" data-action="save-ticket-detail" data-id="${tk.id}">Save Update</button>
        </div>
      </div></div>`;
  }

  if (type === "override") {
    const cartItem = posState.cart.find(i=>i.productId===id);
    return `<div class="modal-backdrop"><form class="modal" data-form="override">
      <h2>Price Override</h2>
      <p class="muted">Original: ${money(cartItem?.originalPrice||0)}</p>
      ${fld("Sold Price","soldPrice",cartItem?.soldPrice||0,"number")}
      <label class="field"><span>Reason for Discount</span><textarea name="reason">${cartItem?.reason||""}</textarea></label>
      ${modalActions()}
    </form></div>`;
  }

  if (type === "udharInfo") return `<div class="modal-backdrop"><form class="modal" data-form="udharInfo" style="max-width:420px">
    <h2>Credit Sale — Customer Details</h2>
    <div class="form-grid">${fld("Customer Name","udharName")}${fld("Customer Phone","udharPhone","","tel")}</div>
    ${modalActions()}
  </form></div>`;

  if (type === "udharList") {
    const outstanding = (state.data.udhar||[]).filter(u=>u.status!=="Settled");
    return `<div class="modal-backdrop"><div class="modal" style="max-width:640px">
      <h2>Outstanding Credits</h2>
      ${outstanding.length===0?`<div class="empty">No outstanding credits.</div>`:`<div style="display:grid;gap:10px">
        ${outstanding.map(u=>`
          <div style="padding:12px;background:var(--surface-2);border-radius:8px;display:grid;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div><strong>${u.customer_name}</strong> · ${u.customer_phone}<br>
                <small class="muted">INV-${u.sale_id} · ${new Date(u.created_at).toLocaleDateString()}</small></div>
              <span class="badge ${u.status==="Settled"?"good":"bad"}">${u.status}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>Balance: <strong>${money(u.balance_due)}</strong></span>
              <span class="muted">Total: ${money(u.total_amount)}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="number" placeholder="Amount to settle" data-settle-amount="${u.id}" min="1"
                style="flex:1;border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--surface);color:var(--text)">
              <select data-settle-method="${u.id}" style="border:1px solid var(--border);border-radius:6px;padding:7px 9px;background:var(--surface);color:var(--text)">
                ${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer"].map(m=>`<option>${m}</option>`).join("")}
              </select>
              <button class="primary-button" data-settle-id="${u.id}">Settle</button>
            </div>
          </div>`).join("")}
      </div>`}
      <div class="modal-actions"><button class="secondary-button" data-close>Close</button></div>
    </div></div>`;
  }

  if (type === "returnFlow") {
    const receiptInput = state.modal?.receiptNo||"";
    const saleId = receiptInput.replace("INV-","");
    const sale   = (state.data.sales||[]).find(s=>String(s.id)===String(saleId));
    if (!sale) return `<div class="modal-backdrop"><form class="modal" data-form="return-lookup" style="max-width:440px">
      <h2>Process Return</h2>
      <p class="muted">Enter the invoice number from the original receipt.</p>
      ${fld("Invoice No. (e.g. INV-42)","receiptNo",receiptInput)}
      ${state.modal?.notFound?`<p style="color:var(--danger);font-size:13px">Invoice not found.</p>`:""}
      <div class="modal-actions"><button class="secondary-button" data-close>Cancel</button><button class="primary-button">Look Up</button></div>
    </form></div>`;
    const items = sale.items_sold||[];
    return `<div class="modal-backdrop"><form class="modal" data-form="return-confirm" style="max-width:560px">
      <h2>Return — INV-${sale.id}</h2>
      <p class="muted">${sale.customer_name||"Walk-in"} · ${new Date(sale.created_at).toLocaleDateString()}</p>
      <div style="display:grid;gap:8px;margin:10px 0">
        ${items.map((item,i)=>`
          <label style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface-2);border-radius:8px">
            <input type="checkbox" name="ret_${i}" value="${i}" checked>
            <span style="flex:1">${item.name} × ${item.qty}</span>
            <strong>${money(item.sold_price*item.qty)}</strong>
          </label>`).join("")}
      </div>
      <label class="field"><span>Refund Method</span>
        <select name="refundMethod">${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer"].map(m=>`<option>${m}</option>`).join("")}</select>
      </label>
      <label class="field"><span>Notes</span><textarea name="notes"></textarea></label>
      <input type="hidden" name="saleId" value="${sale.id}">
      <div class="modal-actions"><button class="secondary-button" data-close>Cancel</button><button class="primary-button">Process Return</button></div>
    </form></div>`;
  }

  if (type === "qitem-pick") {
    const { name, prices } = state.modal;
    return `<div class="modal-backdrop"><div class="modal" style="max-width:340px">
      <h2>${name}</h2><p class="muted">Select price:</p>
      <div style="display:grid;gap:8px;margin-top:8px">
        ${(prices||[]).map((p,i)=>`<button class="secondary-button" style="font-size:16px;min-height:48px" data-pick-price="${i}">${money(p)}</button>`).join("")}
      </div>
      <div class="modal-actions"><button class="secondary-button" data-close>Cancel</button></div>
    </div></div>`;
  }

  return "";
}

function receiptPreview(sale) {
  if (!sale) return "";
  const t = currentTenant();
  return `<div class="receipt-preview">
    <center>${t.logo?`<img src="${t.logo}" style="max-width:120px;max-height:44px;object-fit:contain;margin-bottom:6px"><br>`:""}
    <strong>${t.name}</strong><br>${t.address||""}<br>${t.phone||""}</center>
    <hr>
    Receipt: ${sale.receiptNo||"—"}<br>Date: ${sale.date?new Date(sale.date).toLocaleString():new Date().toLocaleString()}<br>
    Cashier: ${sale.cashier||"Counter"}<br>Customer: ${sale.customer||"Walk-in"}
    <hr>
    ${(sale.items||[]).map(i=>`${i.name}<br><small>${i.qty} × ${money(i.soldPrice)}${i.discount>0?` (disc ${money(i.discount)})`:""}</small>`).join("<br>")}
    <hr>
    ${sale.discount>0?`Discount: ${money(sale.discount)}<br>`:""}
    ${sale.tax>0?`Tax: ${money(sale.tax)}<br>`:""}
    <strong>Total: ${money(sale.total)}</strong><br>Payment: ${sale.payment||"—"}
    ${sale.payment==="Cash"&&sale.cashTendered>0?`<br>Cash Received: <strong>${money(sale.cashTendered)}</strong><br>Change Given: <strong>${money(sale.changeGiven||0)}</strong>`:""}
    <hr>
    <center>${t.receiptFooter||""}</center>
  </div>`;
}

/* ── Cart helpers ── */
function updateQty(productId, delta) {
  const item = posState.cart.find(i=>i.productId===productId);
  if (!item) return;
  item.qty += delta;
  posState.cart = posState.cart.filter(i=>i.qty>0);
  render();
}

/* ── Settle Udhar ── */
async function settleUdhar(udharId, amount, method) {
  const rec = state.data.udhar.find(u=>u.id===udharId);
  if (!rec) return;
  const history = rec.payment_history||[];
  history.push({ date: new Date().toISOString().slice(0,10), paid: amount, method });
  const newPaid    = Number(rec.amount_paid)+Number(amount);
  const newBalance = Math.max(0,Number(rec.total_amount)-newPaid);
  const { error } = await sb.from("udhar").update({
    amount_paid:newPaid, balance_due:newBalance, payment_history:history,
    status:newBalance<=0?"Settled":"Partial",
    settled_at:newBalance<=0?new Date().toISOString():null,
  }).eq("id",udharId);
  if (error) { alert("Settle error: "+error.message); return; }
  await load();
  state.modal = { type:"udharList" };
  render();
}

/* ── Checkout ── */
async function doCheckout() {
  const isUdhar  = posState.checkoutPayment === "Udhar (Credit)";
  const tenant   = currentTenant();
  const subtotal = posState.cart.reduce((s,i)=>s+i.soldPrice*i.qty,0);
  const discount = posState.cart.reduce((s,i)=>s+(i.originalPrice-i.soldPrice)*i.qty,0);
  const labour   = posState.cartLabour||0;
  const tax      = subtotal*(Number(CFG.tax_rate||0)/100);
  const advance  = posState.cartAdvance||0;
  const total    = subtotal+labour+tax-advance;

  if (isUdhar && (!posState.udharName?.trim()||!posState.udharPhone?.trim())) {
    state.modal = { type:"udharInfo" }; render(); return;
  }

  const { data:saleData, error:saleErr } = await sb.from("sales").insert({
    ticket_id:      posState.cartTicketId||null,
    customer_name:  posState.udharName||"",
    items_sold:     posState.cart.map(i=>({ name:i.name, qty:i.qty, original_price:i.originalPrice, sold_price:i.soldPrice, discount:i.discount, reason:i.reason||"" })),
    labour_cost:    labour,
    discount,
    tax,
    total_bill:     Math.max(0,total),
    payment_method: isUdhar?"Udhar":posState.checkoutPayment,
    employee_id:    SESSION.employee?.id||null,
    employee_name:  SESSION.employee?.name||"",
    cash_tendered:  posState.checkoutPayment==="Cash"?(posState.cashTendered||0):0,
    change_given:   posState.checkoutPayment==="Cash"?Math.max(0,(posState.cashTendered||0)-Math.max(0,total)):0,
  }).select().single();
  if (saleErr) { alert("Sale error: "+saleErr.message); return; }

  if (posState.cartTicketId) await updateTicket(posState.cartTicketId,{ status:"Delivered", settledAt:new Date().toISOString() });

  if (isUdhar) await sb.from("udhar").insert({
    sale_id:saleData.id, customer_name:posState.udharName, customer_phone:posState.udharPhone,
    total_amount:Math.max(0,total), amount_paid:0, balance_due:Math.max(0,total), payment_history:[], status:"Outstanding",
  });

  const sale = {
    receiptNo:`INV-${saleData.id}`, date:saleData.created_at,
    cashier:SESSION.employee?.name||"Counter", customer:posState.udharName||"Walk-in",
    items:posState.cart.map(i=>({...i})), subtotal, labour, tax, discount,
    total:Math.max(0,total), payment:isUdhar?"Udhar":posState.checkoutPayment,
    cashTendered:posState.checkoutPayment==="Cash"?(posState.cashTendered||0):0,
    changeGiven:posState.checkoutPayment==="Cash"?Math.max(0,(posState.cashTendered||0)-Math.max(0,total)):0,
  };

  posState.cart=[]; posState.cartTicketId=null; posState.cartLabour=0;
  posState.cartAdvance=0; posState.cashTendered=0;
  posState.udharName=""; posState.udharPhone=""; posState.checkoutPayment="Cash";
  state.modal = { type:"receipt", sale };
  await logBillEvent();
  await load();
}

/* ── EVENT DELEGATION ── */
document.addEventListener("click", async e => {
  const el = e.target.closest(
    "button,[data-route],[data-modal],[data-close],[data-comp],[data-remove-comp]," +
    "[data-tc-add],[data-tc-remove],[data-tc-decline],[data-tc-confirm]," +
    "[data-settle-id],[data-action],[data-quick-collect],[data-inv-pos-add]," +
    "[data-qitem-name],[data-pick-price],[data-view-ticket],[data-pp-key]," +
    "[data-te-remove],[data-remove-comp]"
  );
  if (!el) return;

  if (el.dataset.ppKey !== undefined) { handlePpKey(el.dataset.ppKey, verifyAdminLocal, render); return; }
  if (el.dataset.close !== undefined) { state.modal = null; render(); return; }
  if (el.dataset.action === "login-submit")  { submitLogin(); return; }
  if (el.dataset.action === "forgot-password") {
    const email = document.getElementById("login-email")?.value?.trim();
    if (!email) { alert("Enter your email first."); return; }
    const { data } = await sb.from("employees").select("id").eq("email",email.toLowerCase()).maybeSingle();
    const isOwner = email.toLowerCase() === (CFG.owner_email||"").toLowerCase();
    if (!data && !isOwner) { alert("No account found with that email.\nContact your administrator."); return; }
    alert(`Password reset requested for ${email}.\nContact your RetailOS administrator to reset your password.`);
    return;
  }
  if (el.dataset.action === "theme") {
    state.theme = state.theme==="dark"?"light":"dark";
    localStorage.setItem("retailos-theme", state.theme);
    applyBranding(); render(); return;
  }
  if (el.dataset.action === "install" && state.installPrompt) {
    state.installPrompt.prompt(); state.installPrompt=null; render(); return;
  }
  if (el.dataset.action === "logout") {
    if (!confirm("Log out?")) return;
    _clearSession(); SESSION={ employee:null, isAdmin:false }; render(); return;
  }
  if (el.dataset.action === "shift-stats") { state.modal={ type:"shiftStats" }; render(); return; }
  if (el.dataset.action === "print-shift") { printThermal(buildShiftStats()); return; }
  if (el.dataset.action === "print-receipt") { if(state.modal?.sale) printThermal(buildReceiptSlip(state.modal.sale)); return; }
  if (el.dataset.modal) { state.modal={ type:el.dataset.modal, id:el.dataset.id }; render(); return; }

  if (el.dataset.quickCollect) {
    const found = state.data.tickets.find(t=>String(t.id)===String(el.dataset.quickCollect));
    if (!found) return;
    posState.cartTicketId=found.id; posState.cartAdvance=Number(found.advance_payment||0);
    state.modal={ type:"ticketCheckout", id:String(found.id) }; render(); return;
  }

  if (el.dataset.action === "add-ticket-to-cart") {
    const raw = prompt("Enter Ticket Number (e.g. FP-2026-1234):"); if (!raw) return;
    const found = state.data.tickets.find(t=>t.ticket_number.toUpperCase()===raw.trim().toUpperCase());
    if (!found) { alert("Ticket not found."); return; }
    if (["Delivered","Declined"].includes(found.status)) { alert(`Ticket already ${found.status}.`); return; }
    posState.cartTicketId=found.id; posState.cartAdvance=Number(found.advance_payment||0);
    state.modal={ type:"ticketCheckout", id:String(found.id) }; render(); return;
  }

  if (el.dataset.action === "workshop-collect") {
    const found = state.data.tickets.find(t=>String(t.id)===String(el.dataset.ticketId));
    if (!found) return;
    posState.cartTicketId=found.id; posState.cartAdvance=Number(found.advance_payment||0);
    state.modal={ type:"ticketCheckout", id:String(found.id) };
    state.role="Cashier"; render(); return;
  }

  if (el.dataset.action === "tech-status") {
    const { error } = await sb.from("tickets").update({ status:el.dataset.status }).eq("id",el.dataset.ticketId);
    if (error) { alert(error.message); return; }
    const tk = state.data.tickets.find(t=>String(t.id)===String(el.dataset.ticketId));
    if (tk) tk.status=el.dataset.status; render(); return;
  }

  if (el.dataset.action === "open-ticket-editor") {
    const tk = state.data.tickets.find(t=>String(t.id)===String(el.dataset.ticketId));
    if (!tk) return;
    const pt = (tk.components_noted||[]).reduce((s,c)=>s+Number(c.price||0),0);
    state.teLabour = Math.max(0,Number(tk.estimated_quote||0)-pt);
    state.modal={ type:"ticket-editor", id:el.dataset.ticketId }; render(); return;
  }

  if (el.dataset.action === "te-add-comp") {
    const name=document.getElementById("te-new-comp")?.value?.trim();
    const cond=document.getElementById("te-new-cond")?.value||"New";
    if (!name) return;
    const tk=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (!tk) return;
    document.querySelectorAll("[data-te-price]").forEach((inp,i)=>{ if(tk.components_noted[i]) tk.components_noted[i].price=Number(inp.value)||0; });
    state.teLabour=Number(document.getElementById("te-labour")?.value||0);
    tk.components_noted=[...tk.components_noted,{name,condition:cond,price:0}]; render(); return;
  }
  if (el.dataset.teRemove !== undefined) {
    const tk=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (!tk) return;
    document.querySelectorAll("[data-te-price]").forEach((inp,i)=>{ if(tk.components_noted[i]) tk.components_noted[i].price=Number(inp.value)||0; });
    state.teLabour=Number(document.getElementById("te-labour")?.value||0);
    tk.components_noted.splice(Number(el.dataset.teRemove),1); render(); return;
  }
  if (el.dataset.action === "te-save") {
    const tk=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (!tk) return;
    document.querySelectorAll("[data-te-price]").forEach((inp,i)=>{ if(tk.components_noted[i]) tk.components_noted[i].price=Number(inp.value)||0; });
    const labour=Number(document.getElementById("te-labour")?.value||0);
    const partsTotal=tk.components_noted.reduce((s,c)=>s+Number(c.price||0),0);
    const { error }=await sb.from("tickets").update({ components_noted:tk.components_noted, estimated_quote:partsTotal+labour }).eq("id",tk.id);
    if (error) { alert("Save failed: "+error.message); return; }
    state.teLabour=null; state.modal=null; await load(); return;
  }

  if (el.dataset.action === "save-ticket-detail") {
    const newStatus=document.getElementById("td-status")?.value;
    const actualQuote=Number(document.getElementById("td-actual-quote")?.value||0);
    const note=document.getElementById("td-note")?.value||"";
    const upd={ status:newStatus, update_note:note };
    if (actualQuote>0) upd.actual_quote=actualQuote;
    const { error }=await sb.from("tickets").update(upd).eq("id",el.dataset.id);
    if (error) { alert("Update failed: "+error.message); return; }
    state.modal=null; await load(); return;
  }

  if (el.dataset.action === "add-custom-item") {
    const name=document.getElementById("custom-item-name")?.value?.trim();
    const price=parseFloat(document.getElementById("custom-item-price")?.value||"0");
    if (!name) { alert("Enter item name."); return; }
    if (price<=0) { alert("Enter valid price."); return; }
    posState.cart.push({ productId:`custom-${Date.now()}`,name,qty:1,originalPrice:price,soldPrice:price,discount:0,reason:"",isCustom:true });
    document.getElementById("custom-item-name").value="";
    document.getElementById("custom-item-price").value="";
    render(); return;
  }

  if (el.dataset.qty) { updateQty(el.dataset.qty,Number(el.dataset.delta)); return; }

  if (el.dataset.action === "checkout") {
    const hasDiscount=posState.cart.some(i=>i.discount>0);
    if (hasDiscount && CFG.discount_pin_required) {
      openPinPrompt("discount",()=>doCheckout(),render); return;
    }
    await doCheckout(); return;
  }

  if (el.dataset.invPosAdd) {
    const id=Number(el.dataset.invPosAdd), name=el.dataset.invPosName, price=Number(el.dataset.invPosPrice);
    const key=`inv-${id}`;
    const ex=posState.cart.find(i=>i.productId===key);
    if (ex) ex.qty+=1;
    else posState.cart.push({ productId:key,name,qty:1,originalPrice:price,soldPrice:price,discount:0,reason:"",isInventory:true,inventoryId:id });
    render(); return;
  }

  if (el.dataset.qitemName) {
    const prices=JSON.parse(el.dataset.qitemPrices||"[]"), name=el.dataset.qitemName;
    if (prices.length===1) {
      posState.cart.push({ productId:`qi-${name}-${Date.now()}`,name,qty:1,originalPrice:prices[0],soldPrice:prices[0],discount:0,reason:"" });
      render();
    } else { state.modal={ type:"qitem-pick",name,prices }; render(); }
    return;
  }
  if (el.dataset.pickPrice !== undefined) {
    const { name,prices }=state.modal;
    const price=prices[Number(el.dataset.pickPrice)];
    posState.cart.push({ productId:`qi-${name}-${Date.now()}`,name,qty:1,originalPrice:price,soldPrice:price,discount:0,reason:"" });
    state.modal=null; render(); return;
  }

  if (el.dataset.action === "open-udhar")   { state.modal={ type:"udharList" };  render(); return; }
  if (el.dataset.action === "open-return")  { state.modal={ type:"returnFlow" }; render(); return; }

  if (el.dataset.settleId) {
    const udharId=Number(el.dataset.settleId);
    const amount=Number(document.querySelector(`[data-settle-amount="${udharId}"]`)?.value);
    const method=document.querySelector(`[data-settle-method="${udharId}"]`)?.value||"Cash";
    if (!amount||amount<=0) { alert("Enter a valid amount."); return; }
    openPinPrompt("settle",async()=>settleUdhar(udharId,amount,method),render); return;
  }

  if (el.dataset.comp !== undefined) {
    const name=el.dataset.comp, sel=state.modal.selectedComponents||[];
    const idx=sel.findIndex(s=>s.name===name);
    if (idx>=0) sel.splice(idx,1); else sel.push({ name,tag:"Repaired",price:0 });
    state.modal.selectedComponents=sel;
    const form=document.querySelector("[data-form='repair']");
    if (form) state.modal._draft=Object.fromEntries(new FormData(form).entries());
    render(); return;
  }
  if (el.dataset.removeComp !== undefined) {
    const sel=state.modal.selectedComponents||[];
    sel.splice(Number(el.dataset.removeComp),1);
    state.modal.selectedComponents=sel;
    const form=document.querySelector("[data-form='repair']");
    if (form) state.modal._draft=Object.fromEntries(new FormData(form).entries());
    render(); return;
  }

  if (el.dataset.tcAdd !== undefined) {
    const name=prompt("Component name:"); if (!name) return;
    const ticket=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (ticket) {
      document.querySelectorAll("[data-tc-price]").forEach((inp,i)=>{ if(ticket.components_noted[i]) ticket.components_noted[i].price=Number(inp.value)||0; });
      const lel=document.getElementById("tc-labour"); if(lel) posState.cartLabour=Number(lel.value)||0;
      ticket.components_noted=[...ticket.components_noted,{name,condition:"New",price:0}];
    }
    render(); return;
  }
  if (el.dataset.tcRemove !== undefined) {
    const ticket=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (ticket) {
      document.querySelectorAll("[data-tc-price]").forEach((inp,i)=>{ if(ticket.components_noted[i]) ticket.components_noted[i].price=Number(inp.value)||0; });
      const lel=document.getElementById("tc-labour"); if(lel) posState.cartLabour=Number(lel.value)||0;
      ticket.components_noted.splice(Number(el.dataset.tcRemove),1);
    }
    render(); return;
  }
  if (el.dataset.tcDecline !== undefined) {
    const reason=prompt("Reason customer declined repair:"); if (reason===null) return;
    await updateTicket(state.modal.id,{ status:"Declined",declineReason:reason });
    state.modal=null; await load(); return;
  }
  if (el.dataset.tcConfirm !== undefined) {
    const ticket=state.data.tickets.find(t=>String(t.id)===String(state.modal?.id));
    if (!ticket) return;
    const comps=ticket.components_noted||[];
    document.querySelectorAll("[data-tc-price]").forEach((inp,i)=>{ if(comps[i]) comps[i].price=Number(inp.value)||0; });
    const labour=Number(document.getElementById("tc-labour")?.value||0);
    const advance=Number(ticket.advance_payment||0);
    const total=Math.max(0,comps.reduce((s,c)=>s+Number(c.price||0),0)+labour-advance);
    await updateTicket(ticket.id,{ components:comps });
    posState.cartLabour=labour; posState.cartAdvance=advance; posState.cartTicketId=ticket.id;
    posState.cart.push({ productId:`ticket-${ticket.id}`,name:`Repair: ${ticket.device_brand} ${ticket.device_model} (${ticket.ticket_number})`,qty:1,originalPrice:total,soldPrice:total,discount:0,reason:"",isTicket:true });
    state.modal=null; render(); return;
  }

  const viewTicketEl=el.closest("[data-view-ticket]");
  if (viewTicketEl && el.tagName!=="BUTTON" && !el.closest("button")) {
    state.modal={ type:"ticketDetail", id:String(viewTicketEl.dataset.viewTicket) }; render(); return;
  }
});

/* ── Input handler ── */
document.addEventListener("input", e => {
  const t=e.target;
  if (t.dataset.filter)     { state.filter=t.value; render(); }
  if (t.dataset.invSearch!==undefined)  { posState.invSearch=t.value; render(); }
  if (t.dataset.tePrice!==undefined||t.dataset.teLabour!==undefined) {
    const prices=[...document.querySelectorAll("[data-te-price]")].reduce((s,inp)=>s+(Number(inp.value)||0),0);
    const labour=Number(document.getElementById("te-labour")?.value||0);
    const totalEl=document.getElementById("te-total"); if(totalEl) totalEl.textContent=money(prices+labour);
  }
  if (t.dataset.cashTendered!==undefined) {
    posState.cashTendered=Number(t.value)||0;
    const subtotal=posState.cart.reduce((s,i)=>s+i.soldPrice*i.qty,0);
    const tax=subtotal*(Number(CFG.tax_rate||0)/100);
    const change=posState.cashTendered-(subtotal+tax);
    const existing=document.getElementById("change-display"); if(existing) existing.remove();
    if (posState.cashTendered>0) {
      const div=document.createElement("div"); div.id="change-display";
      div.style.cssText=`display:flex;justify-content:space-between;padding:9px 12px;border-radius:8px;font-weight:600;font-size:15px;margin-top:4px;background:${change>=0?"color-mix(in srgb,#22c55e 12%,var(--surface))":"color-mix(in srgb,#ef4444 12%,var(--surface))"}`;
      div.innerHTML=`<span>${change>=0?"Change Due":"Short by"}</span><span style="color:${change>=0?"#22c55e":"#ef4444"}">${money(Math.abs(change))}</span>`;
      t.parentNode.insertBefore(div,t.nextSibling);
    }
  }
});

/* ── Change handler ── */
document.addEventListener("change", async e => {
  const t=e.target;
  if (t.dataset.action==="payment") { posState.checkoutPayment=t.value; posState.cashTendered=0; render(); return; }
  if (t.dataset.udhar==="name")  { posState.udharName=t.value;  return; }
  if (t.dataset.udhar==="phone") { posState.udharPhone=t.value; return; }
  if (t.dataset.compTag!==undefined) {
    const sel=state.modal?.selectedComponents||[], idx=Number(t.dataset.compTag);
    if (sel[idx]) { sel[idx].tag=t.value; const form=document.querySelector("[data-form='repair']"); if(form) state.modal._draft=Object.fromEntries(new FormData(form).entries()); render(); }
  }
});

/* ── Submit handler ── */
document.addEventListener("submit", async e => {
  e.preventDefault();
  const form=e.target, data=Object.fromEntries(new FormData(form).entries()), type=form.dataset.form;

  if (type==="repair") {
    const sel=state.modal?.selectedComponents||[];
    const res=await createTicket({
      customerName:data.customerName, customerPhone:data.customerPhone,
      deviceBrand:data.deviceBrand, deviceModel:data.deviceModel, imei:data.imei,
      components:sel.map(s=>({name:s.name,condition:s.tag,price:0})),
      estimatedQuote:Number(data.estimatedQuote||0), advance:Number(data.advance||0),
      advanceMethod:data.advanceMethod||"", technicianNote:data.technicianNote||"",
    }, SESSION.employee?.name);
    if (!res.ok) { alert("Error saving ticket: "+res.error); return; }
    state.modal=null; printThermal(buildTicketSlip(res.data)); await load(); return;
  }

  if (type==="udharInfo") {
    posState.udharName=data.udharName; posState.udharPhone=data.udharPhone;
    state.modal=null; await doCheckout(); return;
  }

  if (type==="return-lookup") {
    const raw=data.receiptNo.trim().toUpperCase().replace("INV-","");
    const sale=(state.data.sales||[]).find(s=>String(s.id)===raw);
    state.modal=sale?{ type:"returnFlow", receiptNo:`INV-${sale.id}` }:{ type:"returnFlow", notFound:true, receiptNo:data.receiptNo };
    render(); return;
  }

  if (type==="return-confirm") {
    const saleId=Number(data.saleId), sale=(state.data.sales||[]).find(s=>s.id===saleId);
    const items=sale?.items_sold||[];
    const returned=items.filter((_,i)=>data[`ret_${i}`]!==undefined);
    const refund=returned.reduce((s,it)=>s+(it.sold_price||0)*it.qty,0);
    openPinPrompt("return",async()=>{
      const { error }=await sb.from("returns").insert({ original_sale_id:saleId, returned_items:returned, refund_amount:refund, processed_by:SESSION.employee?.id||null, notes:data.notes||"" });
      if (error) { alert("Return error: "+error.message); return; }
      printThermal(buildReturnSlip({ saleId, items:returned, refund, method:data.refundMethod }));
      state.modal=null; await load();
    },render); return;
  }

  if (type==="override") {
    const item=posState.cart.find(i=>i.productId===state.modal?.id);
    if (item) { item.soldPrice=Number(data.soldPrice); item.discount=Math.max(0,item.originalPrice-item.soldPrice); item.reason=data.reason; }
    state.modal=null; render(); return;
  }
});

/* ── Keyboard ── */
document.addEventListener("keydown", e => {
  if (!SESSION.employee && e.key==="Enter") { e.preventDefault(); submitLogin(); return; }
  if (!!document.getElementById("pp-display")) {
    if (e.key==="Enter"||e.key==="Return") { e.preventDefault(); handlePpKey("✓",verifyAdminLocal,render); return; }
    if (e.key==="Backspace") { e.preventDefault(); handlePpKey("⌫",verifyAdminLocal,render); return; }
    if (e.key==="Escape") { e.preventDefault(); state.modal=null; render(); return; }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); handlePpKey(e.key,verifyAdminLocal,render); return; }
  }
});

/* ── Admin PIN verify (for discount/return gates on POS) ── */
async function verifyAdminLocal(pin) {
  return String(pin)===String(CFG.admin_password)||String(pin)===String(CFG.override_pin)
    ? { ok:true } : { ok:false };
}

/* ── Boot ── */
window.addEventListener("online",  ()=>{ state.online=true;  render(); });
window.addEventListener("offline", ()=>{ state.online=false; render(); });
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); state.installPrompt=e; render(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

await load();

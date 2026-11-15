// Urutan & kelas warna filter jenis. Jenis yang tidak ada di daftar ini tetap tampil (warna netral).
const TYPE_ORDER = ["Cleanser", "Pelembab", "Serum", "Toner", "Sunscreen", "Peeling", "Masker", "Eye Care", "Face Mist"];
const slug = t => "j-" + String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const typeClass = t => (TYPE_ORDER.includes(t) ? slug(t) : "j-other");

let products = [];
let config = { shopeeUrl: "https://shopee.co.id/elformula.id", waNumber: "" };
const state = { type: "Semua", q: "", sort: "terlaris" };

const $ = s => document.querySelector(s);
const rupiah = n => "Rp" + Number(n).toLocaleString("id-ID");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Tombol WhatsApp: template pesan sesuai kategori ----------
function waMessage(p) {
  const harga = rupiah(p.hargaNum);
  if (p.tipe === "Satuan") {
    return `Halo, saya mau tanya soal ${p.nama} (${harga}). Apakah stoknya masih tersedia?`;
  }
  if (p.kategori === "Paket 2in1" || p.kategori === "Paket 2pcs") {
    return `Halo, saya tertarik dengan paket hemat ${p.nama} seharga ${harga}. Apakah bisa dipesan?`;
  }
  return `Halo, saya tertarik dengan paket lengkap ${p.nama} (${p.kategori}) seharga ${harga}. Boleh minta info stok dan cara pesannya?`;
}
function waLink(p) {
  const base = config.waNumber ? `https://wa.me/${config.waNumber}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(waMessage(p))}`;
}

// ---------- Katalog ----------
function partsHtml(p) {
  return p.parts.map(x => x.startsWith("+")
    ? `<span class="part more">${esc(x)}</span>`
    : `<span class="part ${typeClass(x)}">${esc(x)}${p.kategori === "Paket 2pcs" ? " x2" : ""}</span>`).join("");
}

function matchType(p) {
  if (state.type === "Semua") return true;
  if (state.type === "Paket") return p.tipe === "Paket";
  return p.parts.some(x => x.toLowerCase() === state.type.toLowerCase());
}

function visible() {
  const q = state.q.trim().toLowerCase();
  const list = products.filter(p => {
    if (!matchType(p)) return false;
    if (!q) return true;
    return `${p.nama} ${p.kategori} ${p.komponen} ${p.deskripsi} ${p.tags}`.toLowerCase().includes(q);
  });
  const disc = p => parseInt(p.diskon, 10) || 0;
  const sorters = {
    terlaris: (a, b) => b.terjualNum - a.terjualNum,
    murah: (a, b) => a.hargaNum - b.hargaNum,
    mahal: (a, b) => b.hargaNum - a.hargaNum,
    diskon: (a, b) => disc(b) - disc(a)
  };
  return list.sort(sorters[state.sort]);
}

function renderTypes() {
  const present = new Set();
  products.forEach(p => p.parts.forEach(x => { if (!x.startsWith("+")) present.add(x); }));
  const ordered = [...TYPE_ORDER.filter(t => present.has(t)), ...[...present].filter(t => !TYPE_ORDER.includes(t))];
  const count = t => products.filter(p => (t === "Semua" ? true : t === "Paket" ? p.tipe === "Paket" : p.parts.some(x => x.toLowerCase() === t.toLowerCase()))).length;
  const types = ["Semua", "Paket", ...ordered];
  $("#types").innerHTML = types.map(t => {
    const cls = t === "Semua" ? "" : t === "Paket" ? "j-other" : typeClass(t);
    return `<button class="type ${cls} ${state.type === t ? "is-on" : ""}" data-type="${esc(t)}"><span>${esc(t)}</span><small>${count(t)} produk</small></button>`;
  }).join("");
  $("#types").querySelectorAll(".type").forEach(btn => btn.addEventListener("click", () => {
    state.type = btn.dataset.type;
    renderTypes();
    render();
  }));
}

function mediaHtml(p) {
  const first = p.parts.find(x => !x.startsWith("+")) || "";
  const cls = p.tipe === "Paket" ? "j-other" : typeClass(first);
  const img = p.gambar
    ? `<img src="${esc(p.gambar)}" alt="${esc(p.nama)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<div class="media ${cls}"><div class="fallback">Foto produk di Shopee</div>${img}<span class="badge">${esc(p.kategori)}</span></div>`;
}

function render() {
  const list = visible();
  $("#count").textContent = `${list.length} dari ${products.length} produk`;
  if (!list.length) {
    $("#grid").innerHTML = `<p class="empty">Tidak ada produk yang cocok. Coba hapus kata kunci atau pilih "Semua".</p>`;
    return;
  }
  $("#grid").innerHTML = list.map(p => `
    <article class="card">
      ${mediaHtml(p)}
      ${p.tipe === "Paket" ? `<div class="parts" aria-label="Isi paket">${partsHtml(p)}</div>` : ""}
      <h3>${esc(p.nama)}</h3>
      <p class="desc">${esc(p.deskripsi)}</p>
      <div class="price-row">
        <span class="price">${rupiah(p.hargaNum)}</span>
        <span class="disc">Diskon ${esc(p.diskon)}</span>
      </div>
      <div class="stats"><span>Rating ${esc(p.rating)}</span><span>${esc(p.terjual)} terjual</span></div>
      <div class="actions">
        <a class="btn btn-solid" href="${waLink(p)}" target="_blank" rel="noopener">Tanya via WA</a>
        <a class="btn btn-ghost" href="${esc(p.link || config.shopeeUrl)}" target="_blank" rel="noopener">Lihat di Shopee</a>
      </div>
    </article>`).join("");
}

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    products = data.products || [];
    config = { ...config, ...(data.config || {}) };
    $("#shopLink").href = config.shopeeUrl;
    $("#shopLink2").href = config.shopeeUrl;
    $("#shopLink2").textContent = config.shopeeUrl.replace(/^https?:\/\//, "");
    renderTypes();
    render();
  } catch (err) {
    $("#grid").innerHTML = `<p class="empty">Gagal memuat produk. Muat ulang halaman, atau buka lapak langsung di Shopee.</p>`;
  }
}

$("#search").addEventListener("input", e => { state.q = e.target.value; render(); });
$("#sort").addEventListener("change", e => { state.sort = e.target.value; render(); });

// ---------- Chatbot ----------
const chatHistory = [];
const SUGGESTIONS = ["Paket di bawah 200 ribu", "Serum untuk dark spot", "Sunscreen apa saja?", "Produk termurah"];

function fmt(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
function addMsg(role, text, extraClass = "") {
  const el = document.createElement("div");
  el.className = `msg ${role} ${extraClass}`.trim();
  el.innerHTML = role === "bot" ? fmt(text) : esc(text);
  $("#chatLog").appendChild(el);
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  return el;
}

async function sendChat(text) {
  text = (text || "").trim();
  if (!text) return;
  addMsg("user", text);
  $("#chatInput").value = "";
  $("#chatChips").hidden = true;
  const typing = addMsg("bot", "Sedang mengetik…", "typing");
  $("#chatSend").disabled = true;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-6) })
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) { addMsg("bot", data.error || "Terjadi gangguan. Coba lagi ya."); return; }
    addMsg("bot", data.reply);
    chatHistory.push({ role: "user", content: text }, { role: "assistant", content: data.reply });
  } catch (err) {
    typing.remove();
    addMsg("bot", "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
  } finally {
    $("#chatSend").disabled = false;
    $("#chatInput").focus();
  }
}

function openChat(open) {
  $("#chatPanel").hidden = !open;
  $("#chatFab").hidden = open;
  $("#chatFab").setAttribute("aria-expanded", String(open));
  if (open) {
    if (!$("#chatLog").children.length) {
      addMsg("bot", "Halo! Saya bisa bantu cari paket skincare ELFORMULA berdasarkan jenis, kebutuhan, atau budget kamu. Mau tanya apa?");
      $("#chatChips").innerHTML = SUGGESTIONS.map(s => `<button class="chip">${esc(s)}</button>`).join("");
      $("#chatChips").querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => sendChat(c.textContent)));
    }
    $("#chatInput").focus();
  }
}
$("#chatFab").addEventListener("click", () => openChat(true));
$("#chatClose").addEventListener("click", () => openChat(false));
$("#chatSend").addEventListener("click", () => sendChat($("#chatInput").value));
$("#chatInput").addEventListener("keydown", e => { if (e.key === "Enter") sendChat($("#chatInput").value); });

loadProducts();

const fs = require("fs");
const path = require("path");
const { isGreeting } = require("./intents");

const STOPWORDS = new Set(("yang apa ada saja aja untuk dan atau dengan mau minta tolong berapa harga harganya " +
  "produk produknya kak dong nih ya di ke dari ini itu kah sih bisa boleh cari lagi tentang info jual dijual " +
  "beli kalau kalo gak nggak tidak yg dgn buat saya aku kamu anda tau tahu gimana bagaimana apakah ngga banget " +
  "paling bawah atas diatas dibawah ribu rb juta jt rupiah rp maksimal maks budget kurang sampai termurah " +
  "termahal terlaris murah mahal laris isi kulit wajah bundle").split(" "));

// Kata sehari-hari -> istilah di katalog
const SYNONYMS = [
  [/face ?wash|sabun (cuci )?muka|cuci muka|pembersih wajah/, "cleanser"],
  [/pelembab|moisturi[sz]er|krim wajah|moisture/, "pelembab"],
  [/tabir surya|sun ?block|\bspf\b/, "sunscreen"],
  [/eksfoliasi|exfoliat\w*|kulit mati/, "peeling"],
  [/jerawat|berjerawat|acne|komedo/, "acne"],
  [/berminyak|oily/, "oil"],
  [/noda|flek|bekas jerawat|kusam|mencerahkan|pencerah/, "dark spot"],
  [/mask\b|masker|clay/, "masker"],
  [/mata|kantung|panda|\beye\b/, "eye care"],
  [/mist|spray|semprot/, "face mist"],
  [/vit(amin)? ?c\b/, "vitamin"],
  [/kering|dry/, "kering"],
  [/sensitif|sensitive|iritasi/, "sensitif"]
];

function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some(x => x.trim() !== "")) rows.push(row);
  }
  return rows;
}

function parseTerjual(s) {
  const m = String(s || "").toUpperCase().match(/([\d.,]+)\s*(RB|K|JT)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(",", "."));
  if (isNaN(n)) return 0;
  if (m[2] === "RB" || m[2] === "K") n *= 1000;
  if (m[2] === "JT") n *= 1000000;
  return Math.round(n);
}

function rupiah(n) {
  return "Rp" + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

class RAGEngine {
  constructor(csvPath, options = {}) {
    this.csvPath = csvPath || path.join(__dirname, "../data/products.csv");
    this.topK = options.topK || Number(process.env.RAG_TOP_K || 8);
    this.products = [];
    this.loadData();
  }

  loadData() {
    try {
      const rows = parseCSV(fs.readFileSync(this.csvPath, "utf-8"));
      if (rows.length < 2) { this.products = []; return; }
      const headers = rows[0].map(h => h.trim().toLowerCase());
      this.products = rows.slice(1).map(cols => {
        const p = {};
        headers.forEach((h, i) => { p[h] = (cols[i] || "").trim(); });
        p.hargaNum = Number(p.harga) || 0;
        p.terjualNum = parseTerjual(p.terjual);
        p.parts = (p.komponen || "").split(";").map(s => s.trim()).filter(Boolean);
        return p;
      });
      console.log(`[RAG] ${this.products.length} produk dimuat dari CSV`);
    } catch (err) {
      console.error("[RAG] Gagal memuat CSV:", err.message);
      this.products = [];
    }
  }

  normalize(q) {
    return String(q || "").toLowerCase().trim().replace(/(\d)\s*in\s*(\d)/g, "$1in$2");
  }

  expand(q) {
    const extra = [];
    for (const [re, canon] of SYNONYMS) if (re.test(q)) extra.push(canon);
    return extra.length ? `${q} ${extra.join(" ")}` : q;
  }

  tokenize(q) {
    return this.expand(q)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  }

  isAllProducts(q) {
    return [
      /^(semua|semuanya)(\s+produk(nya)?)?$/,
      /^katalog(\s+(produk|lengkap))?$/,
      /^(daftar|list)\s+(produk|harga|paket)$/,
      /^koleksi(\s+lengkap)?$/,
      /(produk|paket)\s+apa\s+(aja|saja)/,
      /(apa|ada apa)\s+(aja|saja)\s+(yang\s+)?(dijual|produknya|paketnya)/,
      /jual\s+apa(\s+(aja|saja))?$/
    ].some(re => re.test(q));
  }

  parseBudget(q) {
    const toNum = (num, unit) => {
      let n = parseFloat(String(num).replace(/\./g, "").replace(",", "."));
      if (isNaN(n)) return null;
      if (/^(jt|juta)$/.test(unit || "")) n *= 1000000;
      else if (/^(rb|ribu|k)$/.test(unit || "")) n *= 1000;
      else if (n < 1000) n *= 1000;
      return n;
    };
    const out = {};
    const max = q.match(/(?:di ?bawah|kurang dari|maksimal|maks|max|budget|<)\s*(?:rp\.?)?\s*([\d.,]+)\s*(rb|ribu|k|jt|juta)?/);
    if (max) out.max = toNum(max[1], max[2]);
    const min = q.match(/(?:di ?atas|lebih dari|minimal|min|>)\s*(?:rp\.?)?\s*([\d.,]+)\s*(rb|ribu|k|jt|juta)?/);
    if (min) out.min = toNum(min[1], min[2]);
    return out;
  }

  parseSort(q) {
    if (/termurah|paling murah|harga terendah|\bmurah\b/.test(q)) return "hargaAsc";
    if (/termahal|paling mahal|harga tertinggi/.test(q)) return "hargaDesc";
    if (/terlaris|best ?seller|paling laris|paling laku|populer|paling banyak/.test(q)) return "terjual";
    return null;
  }

  sorted(list, key) {
    const arr = list.slice();
    if (key === "hargaAsc") arr.sort((a, b) => a.hargaNum - b.hargaNum);
    else if (key === "hargaDesc") arr.sort((a, b) => b.hargaNum - a.hargaNum);
    else arr.sort((a, b) => b.terjualNum - a.terjualNum);
    return arr;
  }

  score(p, tokens) {
    const f = {
      nama: (p.nama || "").toLowerCase(),
      komponen: (p.komponen || "").toLowerCase(),
      kategori: (p.kategori || "").toLowerCase(),
      tags: (p.tags || "").toLowerCase(),
      deskripsi: (p.deskripsi || "").toLowerCase()
    };
    let s = 0;
    for (const t of tokens) {
      if (f.nama.includes(t)) s += 8;
      if (f.komponen.includes(t)) s += 6;
      if (f.kategori.includes(t)) s += 5;
      if (f.tags.includes(t)) s += 4;
      if (f.deskripsi.includes(t)) s += 3;
    }
    return s;
  }

  // Mengembalikan { items, matched, note }
  retrieve(query, k = this.topK) {
    const q = this.normalize(query);
    if (!q || !this.products.length || isGreeting(q)) return { items: [], matched: false };
    if (this.isAllProducts(q)) return { items: this.sorted(this.products, "terjual"), matched: true, compact: true,
      note: "Daftar seluruh produk (ringkas, urut terlaris). Untuk detail satu produk, minta pelanggan menyebut nama produknya:" };

    let list = this.products.slice();
    let constrained = false;
    const b = this.parseBudget(q);
    if (b.max != null) { list = list.filter(p => p.hargaNum <= b.max); constrained = true; }
    if (b.min != null) { list = list.filter(p => p.hargaNum >= b.min); constrained = true; }
    if (constrained && list.length === 0) {
      return {
        items: this.sorted(this.products, "hargaAsc").slice(0, 3),
        matched: true,
        note: "Tidak ada produk yang sesuai batas harga tersebut. Produk dengan harga terendah saat ini:"
      };
    }

    // Filter format paket bila disebut eksplisit (mis. "3in1", "2pcs")
    const fmt = q.match(/\b([2-5]in1|2pcs)\b/);
    if (fmt) {
      const byFmt = list.filter(p => (p.kategori || "").toLowerCase().includes(fmt[1]));
      if (byFmt.length) { list = byFmt; constrained = true; }
    }

    const sortKey = this.parseSort(q);
    const tokens = this.tokenize(q);
    let items = null;
    if (tokens.length) {
      const scored = list
        .map(p => ({ p, s: this.score(p, tokens) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || b.p.terjualNum - a.p.terjualNum);
      if (scored.length) {
        const cutoff = scored[0].s * 0.4; // buang hasil yang jauh kurang relevan
        items = scored.filter(x => x.s >= cutoff).map(x => x.p);
      }
    }
    if (!items && (constrained || sortKey)) items = list;
    if (!items) {
      return { items: this.sorted(this.products, "terjual").slice(0, k), matched: false,
        note: "Katalog produk resmi (produk terlaris):" };
    }
    if (sortKey) items = this.sorted(items, sortKey);
    return { items: items.slice(0, k), matched: true, note: "" };
  }

  buildContext(result) {
    const items = (result && result.items) || [];
    if (!items.length) return "";
    const shop = process.env.SHOPEE_URL || "https://shopee.co.id/elformula.id";
    let out = (result.note || "Katalog produk resmi:") + "\n";
    for (const p of items) {
      out += `• ${p.nama} [${p.kategori}] - Harga: ${rupiah(p.hargaNum)} (diskon ${p.diskon}) | Rating ${p.rating} | Terjual ${p.terjual}\n`;
      if (!result.compact) {
        if (p.tipe === "Paket") out += `  Isi paket: ${p.komponen}\n`;
        out += `  Keterangan: ${p.deskripsi}\n`;
        if (p.link && p.link !== shop) out += `  Link: ${p.link}\n`;
      }
    }
    return out.trim();
  }
}

RAGEngine.rupiah = rupiah;
module.exports = RAGEngine;

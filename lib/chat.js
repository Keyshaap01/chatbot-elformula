// Otak chatbot yang dipakai bersama oleh website (api/chat.js) dan gateway WhatsApp.
// Alur berlapis: sapaan/terima kasih -> FAQ -> RAG + Groq LLM.
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const RAGEngine = require("./rag");
const { isGreeting, isGratitude } = require("./intents");

const DATA_DIR = path.join(__dirname, "..", "data");
const rag = new RAGEngine(path.join(DATA_DIR, "products.csv"));

let knowledge = { keywords: {}, responses: {} };
try {
  knowledge = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "knowledge.json"), "utf-8"));
} catch (err) {
  console.error("Gagal membaca knowledge.json:", err.message);
}

function cfg() {
  return {
    storeName: process.env.STORE_NAME || "ELFORMULA",
    shopeeUrl: process.env.SHOPEE_URL || "https://shopee.co.id/elformula.id",
    waNumber: (process.env.WA_NUMBER || "").replace(/\D/g, "")
  };
}

function fill(text) {
  const c = cfg();
  return text
    .replace(/\{\{SHOPEE_URL\}\}/g, c.shopeeUrl)
    .replace(/\{\{STORE_NAME\}\}/g, c.storeName)
    .replace(/\{\{WA_LINK\}\}/g, c.waNumber ? `https://wa.me/${c.waNumber}` : "chat WhatsApp ini");
}

let groqClient = null;
function getGroq() {
  const key = process.env.GROQ_API_KEY || "";
  if (!key.startsWith("gsk_") || key.includes("isi_api")) return null;
  if (!groqClient) groqClient = new Groq({ apiKey: key });
  return groqClient;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(h => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-6)
    .map(h => ({ role: h.role, content: h.content.slice(0, 800) }));
}

function formatOut(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\*\*(.*?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function matchFAQ(norm) {
  if (knowledge.responses && knowledge.responses[norm]) return knowledge.responses[norm];
  for (const [kw, target] of Object.entries(knowledge.keywords || {})) {
    if (norm.includes(kw.toLowerCase()) && knowledge.responses[target]) return knowledge.responses[target];
  }
  return null;
}

function buildSystemPrompt(ragContext) {
  const c = cfg();
  const contact = `*Lapak Shopee:* ${c.shopeeUrl}` + (c.waNumber ? `\n*WhatsApp:* https://wa.me/${c.waNumber}` : "");
  return `Anda adalah asisten penjualan resmi lapak "${c.storeName}" (elformula.id) di Shopee, yang menjual skincare dan paket bundle skincare. Jawab dalam Bahasa Indonesia yang ramah, natural, singkat, dan rapi.

ATURAN AKURASI (WAJIB):
1. Jawab HANYA berdasarkan "Konteks Katalog" di bawah. Jangan mengarang produk, harga, isi paket, kandungan, ukuran, stok, atau klaim manfaat yang tidak tertulis di konteks.
2. Manfaat produk adalah klaim dari keterangan di lapak; sampaikan sebagai "menurut keterangan produk". Harga, diskon, rating, dan jumlah terjual adalah data yang tertera di lapak Shopee dan bisa berubah. Sebutkan harga persis seperti di konteks.
3. Jangan mencampuradukkan isi antar paket. Untuk membandingkan paket, bandingkan dari kolom "Isi paket" dan harga.
4. Jangan membuat klaim medis atau menjanjikan hasil. Untuk masalah kulit serius, sarankan konsultasi ke dokter kulit.
5. Jika pelanggan menanyakan hal yang tidak ada di katalog (stok terkini, ongkir, BPOM, kandungan detail, cara pakai, produk lain), jawab sopan bahwa informasinya belum tersedia di sini, lalu arahkan ke kontak resmi:
${contact}
6. Jangan menyebut istilah teknis seperti "konteks", "file CSV", "database", atau "sistem".

GAYA JAWABAN:
- Langsung ke inti, 1-3 paragraf pendek. Jangan menguliahi.
- Gunakan SATU bintang untuk cetak tebal (*teks*), bukan dua bintang.
- Daftar produk ditulis per baris dengan bullet (•): nama, harga, dan isi paket singkat.
- Jangan ulangi sapaan "selamat datang" jika percakapan sudah berjalan.
- Selesaikan kalimat penutup sampai tuntas.

${ragContext ? ragContext : "Konteks Katalog: (kosong)"}`;
}

function offlineReply(ragContext) {
  if (ragContext) {
    return formatOut(`${ragContext}\n\nAda yang ingin ditanyakan lagi?`);
  }
  const c = cfg();
  return `Halo! Terima kasih sudah menghubungi *${c.storeName}*. Kami menjual skincare dan paket bundle. Coba tanyakan "paket apa saja" atau "paket di bawah 200 ribu". Lapak kami: ${c.shopeeUrl}`;
}

async function getReply({ message, history = [] }) {
  const msg = String(message || "").trim();
  const norm = msg.toLowerCase();
  const c = cfg();
  const hist = cleanHistory(history);

  if (isGreeting(norm)) {
    return { reply: `Halo! Selamat datang di *${c.storeName}*.\n\nAda yang bisa kami bantu seputar produk dan paket skincare kami hari ini?`, source: "template" };
  }
  if (isGratitude(norm)) {
    return { reply: `Sama-sama! Senang bisa membantu.\n\nJika ada pertanyaan lain, silakan chat lagi ya.`, source: "template" };
  }
  const faq = matchFAQ(norm);
  if (faq) return { reply: formatOut(fill(faq)), source: "faq" };

  // RAG: ambil produk relevan. Untuk pertanyaan lanjutan ("berapa harganya?") pakai konteks chat sebelumnya.
  let result = rag.retrieve(msg);
  if (!result.matched && hist.length) {
    const prev = hist.filter(h => h.role === "user").slice(-2).map(h => h.content).join(" ");
    const r2 = rag.retrieve(`${prev} ${msg}`);
    if (r2.matched) result = r2;
  }
  const ragContext = rag.buildContext(result);

  const groq = getGroq();
  if (!groq) return { reply: offlineReply(ragContext), source: "rag-only" };

  const messages = [{ role: "system", content: buildSystemPrompt(ragContext) }, ...hist, { role: "user", content: msg }];
  const models = [...new Set([
    process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant"
  ])];

  let lastErr = null;
  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        temperature: 0.3,
        max_tokens: Number(process.env.GROQ_MAX_TOKENS || 1500)
      });
      const text = formatOut(completion.choices?.[0]?.message?.content);
      if (text) return { reply: text, source: "ai", model };
    } catch (err) {
      lastErr = err;
      console.warn(`[Groq ${model}] gagal: ${err.message}`);
    }
  }
  console.error("Semua model Groq gagal:", lastErr && lastErr.message);
  return { reply: offlineReply(ragContext), source: "fallback" };
}

module.exports = { getReply, rag, cfg };

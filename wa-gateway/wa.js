// Gateway WhatsApp: memakai mesin RAG + data produk yang SAMA dengan website.
// Dijalankan lokal (butuh proses yang terus hidup), bukan di Vercel.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { getReply } = require("../lib/chat");

const MAX_HISTORY = 6;
const TTL_MS = 20 * 60 * 1000;
const sessions = new Map(); // nomor pengirim -> { messages, lastActive }

function getHistory(id) {
  const s = sessions.get(id);
  if (!s || Date.now() - s.lastActive > TTL_MS) { sessions.delete(id); return []; }
  return s.messages;
}
function saveTurn(id, user, bot) {
  let s = sessions.get(id);
  if (!s || Date.now() - s.lastActive > TTL_MS) s = { messages: [], lastActive: Date.now() };
  s.messages.push({ role: "user", content: user }, { role: "assistant", content: bot });
  s.messages = s.messages.slice(-MAX_HISTORY);
  s.lastActive = Date.now();
  sessions.set(id, s);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "elformula-bot", dataPath: path.join(__dirname, ".wwebjs_auth") }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run"]
  }
});

client.on("qr", qr => {
  console.log("\n=========== PINDAI QR CODE DENGAN WHATSAPP ===========");
  qrcode.generate(qr, { small: true });
  console.log("WhatsApp > Perangkat tertaut > Tautkan perangkat\n");
});
client.on("authenticated", () => console.log("Autentikasi WhatsApp berhasil."));
client.on("auth_failure", m => console.error("Autentikasi gagal:", m));
client.on("ready", () => console.log("Bot WhatsApp siap digunakan. Kirim pesan dari nomor lain untuk menguji."));
client.on("disconnected", r => console.log("WhatsApp terputus:", r));

client.on("message", async msg => {
  try {
    if (msg.fromMe || !msg.body) return;
    if (msg.isStatus || msg.from === "status@broadcast" || msg.from.endsWith("@g.us")) return; // abaikan status & grup
    const text = msg.body.trim().slice(0, 500);
    console.log(`[Masuk ${msg.from}] ${text}`);

    try { (await msg.getChat()).sendStateTyping(); } catch (_) {}

    const { reply, source } = await getReply({ message: text, history: getHistory(msg.from) });
    saveTurn(msg.from, text, reply);
    await msg.reply(reply);
    console.log(`[Balas via ${source}] ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
  } catch (err) {
    console.error("Error memproses pesan:", err);
    try { await msg.reply("Mohon maaf, sistem sedang mengalami gangguan. Silakan coba lagi sesaat lagi."); } catch (_) {}
  }
});

async function shutdown(sig) {
  console.log(`\nMenerima ${sig}, menutup koneksi...`);
  try { await client.destroy(); } catch (_) {}
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("Menyalakan bot WhatsApp (pertama kali bisa 30-60 detik)...");
client.initialize();

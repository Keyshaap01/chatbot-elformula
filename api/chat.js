// Vercel serverless function: POST /api/chat
const { getReply } = require("../lib/chat");

const hits = new Map(); // pembatas sederhana per IP (best-effort pada serverless)
const WINDOW_MS = 60 * 1000;
const MAX_HITS = 15;

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_HITS;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan metode POST." });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (limited(ip)) return res.status(429).json({ error: "Terlalu banyak pesan. Coba lagi sebentar lagi." });

  const { message, history } = req.body || {};
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Pesan kosong." });
  if (message.length > 500) return res.status(400).json({ error: "Pesan terlalu panjang (maks 500 karakter)." });

  try {
    const out = await getReply({ message, history });
    res.status(200).json(out);
  } catch (err) {
    console.error("Error /api/chat:", err);
    res.status(500).json({ error: "Terjadi gangguan. Coba lagi sebentar lagi." });
  }
};

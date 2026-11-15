// Deteksi maksud sederhana (tanpa AI) agar hemat kuota Groq.
const GREETINGS = [
  "halo", "hai", "hi", "hey", "hello", "hei", "p", "ping", "test",
  "pagi", "selamat pagi", "siang", "selamat siang", "sore", "selamat sore",
  "malam", "selamat malam", "assalamualaikum", "assalamu'alaikum",
  "assalamu alaikum", "permisi"
];
const PRODUCT_WORDS = ["produk", "harga", "katalog", "jual", "beli", "paket", "bundle", "cleanser",
  "peeling", "sunscreen", "pelembab", "moisture", "skincare", "facewash", "face wash"];

function isGreeting(text) {
  if (!text) return false;
  const q = text.toLowerCase().trim();
  if (GREETINGS.includes(q)) return true;
  if (/^(halo|hai|hi|hey|hello|hei|selamat\s+(pagi|siang|sore|malam)|assalamu\s*alaikum|permisi)\b/i.test(q)) {
    return !PRODUCT_WORDS.some(w => q.includes(w));
  }
  return false;
}

function isGratitude(text) {
  if (!text) return false;
  const q = text.toLowerCase().trim();
  return /^(terima\s*kasih|makasih|makasi|thanks|thank\s*you|thx|matur\s*nuwun|nuhun|syukron)\b/i.test(q);
}

module.exports = { isGreeting, isGratitude };

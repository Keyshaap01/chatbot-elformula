// Server lokal untuk pengembangan: menjalankan website + API yang sama dengan Vercel.
require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50kb" }));
app.all("/api/chat", require("./api/chat"));
app.all("/api/products", require("./api/products"));
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`Website berjalan di http://localhost:${PORT}`));

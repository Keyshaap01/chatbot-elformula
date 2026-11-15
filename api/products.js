// Vercel serverless function: GET /api/products
const { rag, cfg } = require("../lib/chat");

module.exports = (req, res) => {
  const c = cfg();
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
  res.status(200).json({
    products: rag.products,
    config: { storeName: c.storeName, shopeeUrl: c.shopeeUrl, waNumber: c.waNumber }
  });
};

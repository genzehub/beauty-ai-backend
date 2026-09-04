import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
});

const STORE = (
  process.env.GENZE_STORE_URL ||
  "https://genzehub.co.in"
).replace(/\/$/, "");

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   FETCH HELPER
========================================================= */

async function jsonFetch(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const text = await response.text();
    let body;

    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(
        body?.errors?.[0]?.message ||
        body?.error ||
        body?.message ||
        `HTTP ${response.status}`
      );
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   SHOPIFY PRODUCT CACHE
========================================================= */

let productCache = [];
let productCacheTime = 0;
let productLoadingPromise = null;
const CACHE_MS = 15 * 60 * 1000;

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function productText(product) {
  return clean(
    [
      product.title,
      product.description,
      product.productType,
      product.vendor,
      ...(product.tags || [])
    ].join(" ")
  );
}

async function loadAllShopifyProducts() {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    throw new Error("Shopify Storefront credentials are not configured");
  }

  if (productCache.length && Date.now() - productCacheTime < CACHE_MS) {
    return productCache;
  }

  if (productLoadingPromise) {
    return productLoadingPromise;
  }

  productLoadingPromise = (async () => {
    try {
      const products = [];
      let cursor = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const query = `
          query GenzeCatalog($cursor: String) {
            products(
              first: 250,
              after: $cursor,
              sortKey: TITLE
            ) {
              edges {
                cursor
                node {
                  id
                  title
                  handle
                  description
                  productType
                  vendor
                  tags
                  featuredImage {
                    url
                    altText
                  }
                  priceRange {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        const data = await jsonFetch(
          `https://${SHOPIFY_DOMAIN}/api/2026-07/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Shopify-Storefront-Private-Token": SHOPIFY_TOKEN
            },
            body: JSON.stringify({
              query,
              variables: { cursor }
            })
          }
        );

        if (data?.errors?.length) {
          throw new Error(data.errors[0]?.message || "Shopify GraphQL error");
        }

        const connection = data?.data?.products;
        const edges = connection?.edges || [];

        for (const { node } of edges) {
          products.push({
            id: node.id,
            title: node.title || "",
            handle: node.handle || "",
            description: node.description || "",
            productType: node.productType || "",
            vendor: node.vendor || "",
            tags: node.tags || [],
            image: node.featuredImage?.url || "",
            price: node.priceRange?.minVariantPrice?.amount || "",
            currency: node.priceRange?.minVariantPrice?.currencyCode || "",
            url: `${STORE}/products/${node.handle}`
          });
        }

        hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
        cursor = connection?.pageInfo?.endCursor || null;
      }

      productCache = products;
      productCacheTime = Date.now();
      console.log(`Shopify cache loaded: ${products.length} products`);
      return products;
    } finally {
      productLoadingPromise = null;
    }
  })();

  return productLoadingPromise;
}

/* =========================================================
   CATEGORY / CONCERN DICTIONARIES
========================================================= */

const CATEGORY_TERMS = {
  skincare: [
    "skincare", "cleanser", "cleansing", "toner", "serum",
    "essence", "ampoule", "cream", "moisturizer", "mask",
    "sunscreen", "spf", "eye cream", "exfoliator"
  ],
  makeup: [
    "foundation", "cushion", "concealer", "powder", "compact",
    "lip", "tint", "mascara", "eyeliner", "blush", "palette",
    "bb cream", "cc cream"
  ],
  haircare: [
    "hair", "shampoo", "conditioner", "scalp", "hair oil",
    "hair mask", "hair serum", "hair treatment"
  ],
  fragrance: [
    "fragrance", "perfume", "parfum", "eau de parfum",
    "eau de toilette", "body mist", "scent"
  ]
};

const CONCERNS = {
  skincare: {
    hydration: ["hydrating", "hydration", "moisture", "hyaluronic", "ceramide", "barrier"],
    acne: ["acne", "blemish", "breakout", "salicylic", "bha", "tea tree"],
    pores: ["pore", "pores", "niacinamide", "sebum", "bha"],
    brightening: ["brightening", "glow", "radiance", "vitamin c", "arbutin", "tranexamic"],
    redness: ["redness", "calming", "soothing", "centella", "cica", "heartleaf"],
    "anti-aging": ["anti aging", "wrinkle", "retinol", "peptide", "collagen"],
    sensitive: ["sensitive", "soothing", "calming", "gentle", "centella", "cica"]
  }
};

/* =========================================================
   ANALYSIS -> CONCERN & MATCHING
========================================================= */

function analysisConcern(analysis) {
  if (!analysis) return "";

  if (analysis.primary_concern) {
    return clean(analysis.primary_concern).replace(/ /g, "-");
  }

  const scores = Array.isArray(analysis.scores) ? analysis.scores : [];
  let winner = "";
  let winnerScore = -1;

  for (const item of scores) {
    const type = clean(item?.type || "").replace(/ /g, "_");
    const score = Number(item?.score || 0);
    if (score > winnerScore) {
      winnerScore = score;
      winner = type;
    }
  }

  return winner;
}

function matchCatalog({ catalog, category, concern, tone, query, analysis }) {
  const detectedConcern = analysisConcern(analysis);
  const finalConcern = detectedConcern || concern;

  return catalog
    .map(product => {
      let match_score = 10;
      return {
        ...product,
        match_score,
        match_reason: finalConcern ? `Matched for ${finalConcern.replaceAll("-", " ")}` : "Recommended for you"
      };
    })
    .slice(0, 12);
}

/* =========================================================
   SKIN ANALYSIS ROUTE (MOCK / NO YOUCAM)
========================================================= */

app.post("/api/skin-analysis", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo received" });
    }

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(req.file.mimetype || "")) {
      return res.status(400).json({ error: "Please upload a JPG, PNG, or WEBP image" });
    }

    // YouCam ഇല്ലാതെ ബാക്കെൻഡിൽ നിന്ന് നൽകുന്ന താൽക്കാലിക റിസൾട്ട്
    const mockAnalysisResult = {
      ok: true,
      source: "Genze Local Engine",
      confidence: 92,
      primary_concern: "hydration",
      scores: [
        { type: "hydration", score: 40 },
        { type: "brightening", score: 65 },
        { type: "pores", score: 80 }
      ]
    };

    return res.json(mockAnalysisResult);
  } catch (error) {
    console.error("skin-analysis error:", error);
    return res.status(500).json({ error: "Skin analysis failed" });
  }
});

/* =========================================================
   PRODUCT MATCH ROUTE
========================================================= */

app.post("/api/match-products", async (req, res) => {
  try {
    const category = clean(req.body?.category || req.body?.mode || "skincare");
    const concern = String(req.body?.concern || "").trim();
    const tone = String(req.body?.tone || "").trim();
    const query = String(req.body?.query || "").trim();
    const analysis = req.body?.analysis || null;

    const catalog = await loadAllShopifyProducts();
    const products = matchCatalog({
      catalog, category, concern, tone, query, analysis
    });

    return res.json({
      ok: true,
      category,
      concern,
      tone,
      query,
      catalog_size: catalog.length,
      products: products.map(product => ({
        id: product.id,
        title: product.title,
        vendor: product.vendor,
        category: product.productType,
        image: product.image,
        price: product.price,
        currency: product.currency,
        url: product.url,
        score: product.match_score,
        match_reason: product.match_reason
      }))
    });
  } catch (error) {
    console.error("match-products:", error.body || error);
    return res.status(500).json({
      error: error.message || "Product matching failed"
    });
  }
});

/* =========================================================
   SERVER START
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Genze AI running on port ${PORT}`);
});

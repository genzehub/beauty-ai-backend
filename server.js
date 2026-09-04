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
const PORT = process.env.PORT || 5000;

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

const SHOPIFY_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN || "";

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

const SELF_HOSTED_SKIN_AI_URL =
  process.env.SELF_HOSTED_SKIN_AI_URL || "";

const SELF_HOSTED_SKIN_AI_KEY =
  process.env.SELF_HOSTED_SKIN_AI_KEY || "";

const SELF_AI_MIN_CONFIDENCE = Number(
  process.env.SELF_AI_MIN_CONFIDENCE || 72
);

const YOUCAM_API =
  "https://yce-api-01.makeupar.com";

const YOUCAM_KEY =
  process.env.YOUCAM_API_KEY || "";

app.use(cors());

app.use(
  express.json({
    limit: "3mb"
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


/* =========================================================
   FETCH HELPER
========================================================= */

async function jsonFetch(
  url,
  options = {},
  timeoutMs = 20000
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

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
    throw new Error(
      "Shopify Storefront credentials are not configured"
    );
  }

  if (
    productCache.length &&
    Date.now() - productCacheTime < CACHE_MS
  ) {
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
          throw new Error(
            data.errors[0]?.message || "Shopify GraphQL error"
          );
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
  },
  makeup: {
    foundation: ["foundation", "cushion", "bb cream", "cc cream", "skin tint"],
    concealer: ["concealer"],
    powder: ["powder", "compact"],
    "lip-color": ["lip", "lipstick", "lip tint"]
  },
  haircare: {
    "hair-fall": ["hair fall", "hair loss", "anti hair loss", "thickening", "strengthening"],
    dandruff: ["dandruff", "anti dandruff", "anti-dandruff", "flaky scalp", "flake"],
    dry: ["dry hair", "dry scalp", "moisturizing hair", "hydrating hair", "moisture", "nourishing", "conditioning"],
    damaged: ["damaged hair", "hair repair", "repair treatment", "protein treatment", "keratin", "damage care"],
    oily: ["oily scalp", "oily hair", "excess sebum", "sebum control"]
  },
  fragrance: {
    floral: ["floral", "rose", "jasmine", "flower"],
    fresh: ["fresh", "citrus", "aquatic", "green"],
    vanilla: ["vanilla", "amber", "sweet", "warm", "musk", "woody", "oriental", "creamy", "powdery"],
    longlasting: ["eau de parfum", "edp", "parfum", "eau de toilette", "edt"]
  }
};

const TONE_TERMS = {
  fair: ["fair", "porcelain", "ivory"],
  light: ["light", "ivory", "light beige", "n01", "01"],
  medium: ["medium", "natural beige", "sand", "warm beige", "n02", "02"],
  tan: ["tan", "honey", "caramel", "golden"],
  deep: ["deep", "dark", "cocoa", "espresso", "mahogany"]
};


/* =========================================================
   ANALYSIS -> CONCERN
========================================================= */

function analysisConcern(analysis) {
  if (!analysis) return "";

  if (analysis.primary_concern) {
    return clean(analysis.primary_concern).replace(/ /g, "-");
  }

  const scores = Array.isArray(analysis.scores) ? analysis.scores : [];
  const mapping = {
    acne: "acne",
    pore: "pores",
    pores: "pores",
    redness: "redness",
    moisture: "hydration",
    dehydration: "hydration",
    radiance: "brightening",
    pigmentation: "brightening",
    age_spot: "brightening",
    dark_circle: "brightening",
    wrinkle: "anti-aging",
    wrinkles: "anti-aging",
    texture: "sensitive"
  };

  let winner = "";
  let winnerScore = -1;

  for (const item of scores) {
    const type = clean(item?.type || "").replace(/ /g, "_");
    const mapped = mapping[type];
    if (!mapped) continue;

    const score = Number(item?.score || 0);
    if (score > winnerScore) {
      winnerScore = score;
      winner = mapped;
    }
  }

  return winner;
}


/* =========================================================
   MATCHING ENGINE
========================================================= */

function categoryScore(product, category) {
  const text = productText(product);
  const productType = clean(product.productType);
  const terms = CATEGORY_TERMS[category] || [];

  let score = 0;
  for (const term of terms) {
    if (text.includes(clean(term))) {
      score += 5;
    }
  }

  if (category === "haircare" && (productType.includes("hair") || productType.includes("scalp"))) {
    score += 12;
  }
  if (category === "fragrance" && (productType.includes("fragrance") || productType.includes("perfume"))) {
    score += 12;
  }
  if (
    category === "makeup" &&
    (productType.includes("makeup") || productType.includes("powder") || productType.includes("foundation") || productType.includes("concealer") || productType.includes("lip"))
  ) {
    score += 10;
  }

  return score;
}

function concernScore(product, category, concern) {
  if (!concern) return 0;

  const rawKey = clean(concern).replace(/ /g, "-");
  const CONCERN_ALIASES = {
    "dry-hair": "dry", "damaged-hair": "damaged", "oily-scalp": "oily",
    "hair-fall": "hair-fall", "dandruff": "dandruff", "powder-compact": "powder",
    "powder": "powder", "foundation-cushion": "foundation", "concealer": "concealer",
    "lip-color": "lip-color", "warm-vanilla-fragrance": "vanilla", "vanilla": "vanilla",
    "floral": "floral", "fresh-clean": "fresh", "fresh": "fresh",
    "edp-edt-longevity": "longlasting", "long-lasting": "longlasting", "longlasting": "longlasting",
    "hydration": "hydration", "acne-breakouts": "acne", "acne": "acne",
    "pores-oil": "pores", "pores": "pores", "brightening": "brightening",
    "redness-calming": "redness", "redness": "redness", "anti-aging": "anti-aging",
    "sensitive-skin": "sensitive", "sensitive": "sensitive"
  };

  const key = CONCERN_ALIASES[rawKey] || rawKey;
  const text = productText(product);
  const strongText = clean([product.title, product.productType, ...(product.tags || [])].join(" "));

  const full = ` ${text} `;
  const strong = ` ${strongText} `;

  const has = term => full.includes(` ${clean(term)} `);
  const hasStrong = term => strong.includes(` ${clean(term)} `);
  const hasAny = terms => terms.some(term => has(term));
  const hasAnyStrong = terms => terms.some(term => hasStrong(term));

  if (category === "makeup" && key === "powder") {
    const blocked = ["foam", "cleanser", "cleansing", "face wash", "baking powder", "wash", "soap"];
    if (hasAny(blocked)) return 0;

    const realPowderTerms = ["makeup powder", "face powder", "loose powder", "setting powder", "pressed powder", "compact", "powder pact", "fix powder"];
    const productType = clean(product.productType);
    const realPowder = productType.includes("powder") || productType.includes("compact") || hasAnyStrong(realPowderTerms);

    return realPowder ? 28 : 0;
  }

  if (category === "haircare" && key === "hair-fall") {
    return ["hair fall", "hair loss", "anti hair loss", "thickening", "strengthening"].some(has) ? 24 : 0;
  }

  if (category === "haircare" && key === "dandruff") {
    if (["hair loss", "anti hair loss", "thickening", "strengthening"].some(has)) return 0;
    if (["dandruff", "anti dandruff", "anti-dandruff", "flaky scalp", "flake"].some(has)) return 30;

    const scalpShampoo = (hasStrong("scalp care") || hasStrong("scalp")) && hasStrong("shampoo");
    return scalpShampoo ? 14 : 0;
  }

  if (category === "haircare" && key === "dry") {
    if (["foot", "feet", "heel", "face cream", "body lotion"].some(has)) return 0;

    const productType = clean(product.productType);
    const hairEvidence = productType.includes("hair") || productType.includes("scalp") || ["hair", "shampoo", "conditioner", "scalp", "hair mask", "hair treatment"].some(hasStrong);

    if (!hairEvidence) return 0;

    if (["dry hair", "dry scalp", "hydrating hair", "moisturizing hair"].some(has)) return 30;
    if (["moisture", "moisturizing", "hydrating", "nourishing", "conditioning", "ceramide", "repair"].some(has)) return 14;

    return 0;
  }

  if (category === "haircare" && key === "oily") {
    if (["foot", "feet", "heel", "hair loss", "thickening"].some(has)) return 0;
    if (["oily scalp", "oily hair", "excess sebum", "sebum control"].some(has)) return 24;

    const scalpShampoo = (hasStrong("scalp care") || hasStrong("scalp")) && hasStrong("shampoo");
    return scalpShampoo ? 10 : 0;
  }

  if (category === "haircare" && key === "damaged") {
    const productType = clean(product.productType);
    const hairEvidence = productType.includes("hair") || productType.includes("scalp") || ["hair", "shampoo", "conditioner", "hair treatment", "hair mask"].some(hasStrong);

    if (!hairEvidence) return 0;

    return ["damaged hair", "damage care", "hair repair", "repair treatment", "protein treatment", "keratin"].some(has) ? 28 : 0;
  }

  if (category === "fragrance") {
    const blocked = ["hand cream", "body lotion", "body cream", "body wash", "shower gel", "perfume shower", "shampoo", "conditioner", "hair treatment", "treatment", "hair mask", "cleanser", "cleansing", "soap"];
    if (hasAnyStrong(blocked)) return 0;

    const productType = clean(product.productType);
    const fragranceSignals = ["perfume", "parfum", "eau de parfum", "eau de toilette", "edp", "edt", "body mist", "fragrance"];
    const realFragrance = productType.includes("fragrance") || productType.includes("perfume") || hasAnyStrong(fragranceSignals);

    if (!realFragrance) return 0;

    const terms = (CONCERNS[category] || {})[key] || [];
    let score = 0;

    for (const term of terms) {
      if (hasStrong(term)) score += 16;
      else if (has(term)) score += 5;
    }

    return score;
  }

  const terms = (CONCERNS[category] || {})[key] || [];
  let score = 0;

  for (const term of terms) {
    if (hasStrong(term)) score += 12;
    else if (has(term)) score += 4;
  }

  return score;
}

function toneScore(product, tone) {
  if (!tone) return 0;

  const text = productText(product);
  const terms = TONE_TERMS[clean(tone)] || [];
  let score = 0;

  for (const term of terms) {
    if (text.includes(clean(term))) score += 8;
  }

  return score;
}

function queryScore(product, query) {
  const q = clean(query);
  if (!q) return 0;

  const text = productText(product);
  const words = q.split(" ").filter(Boolean);
  let score = 0;

  for (const word of words) {
    if (text.includes(word)) score += 6;
  }

  return score;
}

function matchCatalog({ catalog, category, concern, tone, query, analysis }) {
  const detectedConcern = analysisConcern(analysis);
  const finalConcern = detectedConcern || concern;

  return catalog
    .map(product => {
      const cScore = categoryScore(product, category);
      const concernMatch = concernScore(product, category, finalConcern);
      const toneMatch = category === "makeup" ? toneScore(product, tone) : 0;
      const searchMatch = queryScore(product, query);
      const analysisBoost = analysis && finalConcern && concernMatch > 0 ? 8 : 0;

      return {
        ...product,
        match_score: cScore + concernMatch + toneMatch + searchMatch + analysisBoost,
        match_reason: finalConcern ? `Matched for ${finalConcern.replaceAll("-", " ")}` : ""
      };
    })
    .filter(product => {
      if (query) return queryScore(product, query) > 0;
      if (categoryScore(product, category) <= 0) return false;
      if (finalConcern) return concernScore(product, category, finalConcern) > 0;
      return true;
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 12);
}


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
    return res.status(error.status || 500).json({
      error: error.message || "Product matching failed"
    });
  }
});


/* =========================================================
   SELF-HOSTED SKIN AI
========================================================= */

function normalizeSelfHostedAnalysis(result) {
  const scores = Array.isArray(result?.scores) ? result.scores : [];
  const confidence = Number(
    result?.confidence ?? result?.model_confidence ?? 0
  );

  return {
    ok: true,
    source: "Genze Skin AI",
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    primary_concern: result?.primary_concern || "",
    scores: scores.map(item => ({
      type: String(item?.type || ""),
      score: item?.score ?? item?.value ?? null,
      confidence: item?.confidence ?? null
    }))
  };
}

async function runSelfHostedSkinAI(file) {
  if (!SELF_HOSTED_SKIN_AI_URL) {
    throw new Error("Self-hosted skin AI is not configured");
  }

  const form = new FormData();
  const blob = new Blob([file.buffer], {
    type: file.mimetype || "image/jpeg"
  });

  form.append("photo", blob, file.originalname || "capture.jpg");

  const headers = {};
  if (SELF_HOSTED_SKIN_AI_KEY) {
    headers.Authorization = `Bearer ${SELF_HOSTED_SKIN_AI_KEY}`;
  }

  const response = await fetch(SELF_HOSTED_SKIN_AI_URL, {
    method: "POST",
    headers,
    body: form
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error || `Self-hosted skin AI HTTP ${response.status}`
    );
  }

  return normalizeSelfHostedAnalysis(data);
}


/* =========================================================
   YOUCAM FALLBACK / INTEGRATION
========================================================= */

function youcamHeaders(extra = {}) {
  if (!YOUCAM_KEY) {
    throw new Error("YOUCAM_API_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${YOUCAM_KEY}`,
    ...extra
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createUploadSlot(file) {
  return jsonFetch(`${YOUCAM_API}/s2s/v2.0/file`, {
    method: "POST",
    headers: youcamHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      files: [
        {
          file_name: file.originalname || `capture-${Date.now()}.jpg`,
          file_size: file.size,
          content_type: file.mimetype || "image/jpeg"
        }
      ]
    })
  });
}

async function uploadToSignedUrl(slot, file) {
  const info = slot?.data?.files?.[0];
  const request = info?.requests?.[0];

  if (!info?.file_id || !request?.url) {
    throw new Error("YouCam upload URL missing");
  }

  const response = await fetch(request.url, {
    method: request.method || "PUT",
    headers: {
      ...(request.headers || {}),
      "Content-Type": file.mimetype || "image/jpeg"
    },
    body: file.buffer
  });

  if (!response.ok) {
    throw new Error(`YouCam upload failed: ${response.status}`);
  }

  return info.file_id;
}

const HD_ACTIONS = [
  "hd_wrinkle",
  "hd_pore",
  "hd_texture",
  "hd_acne",
  "hd_redness",
  "hd_oiliness",
  "hd_age_spot",
  "hd_radiance",
  "hd_moisture",
  "hd_dark_circle",
  "hd_eye_bag",
  "hd_skin_type"
];

app.post("/api/analyze-skin", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    if (SELF_HOSTED_SKIN_AI_URL) {
      try {
        const selfResult = await runSelfHostedSkinAI(req.file);
        if (selfResult.confidence >= SELF_AI_MIN_CONFIDENCE) {
          return res.json(selfResult);
        }
      } catch (e) {
        console.warn("Self-hosted Skin AI failed, falling back to YouCam:", e.message);
      }
    }

    const slot = await createUploadSlot(req.file);
    const fileId = await uploadToSignedUrl(slot, req.file);

    const taskData = await jsonFetch(`${YOUCAM_API}/s2s/v2.0/skin-analysis`, {
      method: "POST",
      headers: youcamHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        file_id: fileId,
        actions: HD_ACTIONS
      })
    });

    const taskId = taskData?.data?.task_id;
    if (!taskId) {
      throw new Error("YouCam analysis task creation failed");
    }

    let result = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const poll = await jsonFetch(`${YOUCAM_API}/s2s/v2.0/skin-analysis/${taskId}`, {
        headers: youcamHeaders()
      });

      if (poll?.data?.status === "SUCCESS") {
        result = poll.data;
        break;
      }
      if (poll?.data?.status === "FAILED") {
        throw new Error("YouCam skin analysis process failed");
      }
    }

    if (!result) {
      throw new Error("YouCam analysis timed out");
    }

    return res.json({
      ok: true,
      source: "YouCam AI",
      data: result
    });

  } catch (error) {
    console.error("analyze-skin error:", error.message);
    return res.status(500).json({ error: error.message || "Skin analysis failed" });
  }
});


/* =========================================================
   SERVER START (PORT BINDING FOR RENDER)
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Genze AI running on port ${PORT}`);
});

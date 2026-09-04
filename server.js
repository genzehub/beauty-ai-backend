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
  limits: { fileSize: 12 * 1024 * 1024 }
});

const STORE = (
  process.env.GENZE_STORE_URL || "https://genzehub.co.in"
).replace(/\/$/, "");

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";
const YOUCAM_API = "https://yce-api-01.makeupar.com";
const YOUCAM_KEY = process.env.YOUCAM_API_KEY || "";

app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   FETCH HELPER
========================================================= */

async function jsonFetch(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

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
    clearTimeout(id);
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
  return clean([
    product.title,
    product.description,
    product.productType,
    ...(product.tags || [])
  ].join(" "));
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
            data.errors[0]?.message ||
            "Shopify GraphQL error"
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
            price:
              node.priceRange?.minVariantPrice?.amount || "",
            currency:
              node.priceRange?.minVariantPrice?.currencyCode || "",
            url: `${STORE}/products/${node.handle}`
          });
        }

        hasNextPage = Boolean(
          connection?.pageInfo?.hasNextPage
        );

        cursor =
          connection?.pageInfo?.endCursor || null;
      }

      productCache = products;
      productCacheTime = Date.now();

      console.log(
        `Shopify cache loaded: ${products.length} products`
      );

      return products;
    } finally {
      productLoadingPromise = null;
    }
  })();

  return productLoadingPromise;
}

/* =========================================================
   CATEGORY & CONCERN DICTIONARIES
========================================================= */

const CATEGORY_TERMS = {
  skincare: [
    "skincare",
    "cleanser",
    "cleansing",
    "toner",
    "serum",
    "essence",
    "ampoule",
    "cream",
    "moisturizer",
    "mask",
    "sunscreen",
    "spf",
    "eye cream",
    "exfoliator"
  ],

  makeup: [
    "foundation",
    "cushion",
    "concealer",
    "powder",
    "compact",
    "lip",
    "tint",
    "mascara",
    "eyeliner",
    "blush",
    "palette",
    "bb cream",
    "cc cream"
  ],

  haircare: [
    "hair",
    "shampoo",
    "conditioner",
    "scalp",
    "hair oil",
    "hair mask",
    "hair serum",
    "hair treatment"
  ],

  fragrance: [
    "fragrance",
    "perfume",
    "parfum",
    "eau de parfum",
    "eau de toilette",
    "body mist",
    "scent"
  ]
};

const CONCERNS = {
  skincare: {
    hydration: [
      "hydrating",
      "hydration",
      "moisture",
      "hyaluronic",
      "ceramide",
      "barrier"
    ],

    acne: [
      "acne",
      "blemish",
      "breakout",
      "salicylic",
      "bha",
      "tea tree"
    ],

    pores: [
      "pore",
      "pores",
      "niacinamide",
      "sebum",
      "bha"
    ],

    brightening: [
      "brightening",
      "glow",
      "radiance",
      "vitamin c",
      "arbutin",
      "tranexamic"
    ],

    redness: [
      "redness",
      "calming",
      "soothing",
      "centella",
      "cica",
      "heartleaf"
    ],

    "anti-aging": [
      "anti aging",
      "wrinkle",
      "retinol",
      "peptide",
      "collagen"
    ],

    sensitive: [
      "sensitive",
      "soothing",
      "calming",
      "gentle",
      "centella",
      "cica"
    ]
  },

  makeup: {
    foundation: [
      "foundation",
      "cushion",
      "bb cream",
      "cc cream",
      "skin tint"
    ],

    concealer: [
      "concealer"
    ],

    powder: [
      "powder",
      "compact"
    ],

    "lip-color": [
      "lip",
      "lipstick",
      "lip tint"
    ]
  },

  haircare: {
    "hair-fall": [
      "hair fall",
      "hair loss",
      "anti hair loss",
      "thickening",
      "strengthening"
    ],

    dandruff: [
      "dandruff",
      "anti dandruff",
      "anti-dandruff",
      "flaky scalp"
    ],

    dry: [
      "dry hair",
      "dry scalp",
      "moisturizing hair",
      "hydrating hair"
    ],

    damaged: [
      "damaged hair",
      "hair repair",
      "repair treatment",
      "protein treatment",
      "keratin"
    ],

    oily: [
      "oily scalp",
      "oily hair",
      "excess sebum",
      "sebum control"
    ]
  },

  fragrance: {
    floral: [
      "floral",
      "rose",
      "jasmine",
      "flower"
    ],

    fresh: [
      "fresh",
      "citrus",
      "aquatic",
      "green"
    ],

    vanilla: [
  "vanilla",
  "amber",
  "sweet",
  "warm",
  "musk",
  "woody",
  "oriental",
  "creamy",
  "powdery"
],

    longlasting: [
      "eau de parfum",
      "edp",
      "parfum"
    ]
  }
};

const TONE_TERMS = {
  fair: [
    "fair",
    "porcelain",
    "ivory"
  ],

  light: [
    "light",
    "ivory",
    "light beige",
    "n01",
    "01"
  ],

  medium: [
    "medium",
    "natural beige",
    "sand",
    "warm beige",
    "n02",
    "02"
  ],

  tan: [
    "tan",
    "honey",
    "caramel",
    "golden"
  ],

  deep: [
    "deep",
    "dark",
    "cocoa",
    "espresso",
    "mahogany"
  ]
};

/* =========================================================
   MATCHING ENGINE
========================================================= */

function categoryScore(product, category) {
  const text = productText(product);
  const terms = CATEGORY_TERMS[category] || [];

  let score = 0;

  for (const term of terms) {
    if (text.includes(clean(term))) {
      score += 5;
    }
  }

  if (
    clean(product.productType)
      .includes(clean(category))
  ) {
    score += 10;
  }

  return score;
}

function concernScore(
  product,
  category,
  concern
) {
  if (!concern) {
    return 0;
  }

  const key =
    clean(concern)
      .replace(/ /g, "-");

  const text =
    productText(product);

  const strongText =
    clean([
      product.title,
      product.productType,
      ...(product.tags || [])
    ].join(" "));

  const full = ` ${text} `;
  const strong = ` ${strongText} `;

  const has = term =>
    full.includes(` ${clean(term)} `);

  const hasStrong = term =>
    strong.includes(` ${clean(term)} `);

  /* MAKEUP POWDER FALSE MATCH FIX */

  if (
    category === "makeup" &&
    key === "powder" &&
    [
      "foam",
      "cleanser",
      "cleansing",
      "face wash"
    ].some(has)
  ) {
    return 0;
  }

  /* HAIR FALL */

  if (
    category === "haircare" &&
    key === "hair-fall"
  ) {
    return [
      "hair fall",
      "hair loss",
      "anti hair loss",
      "thickening",
      "strengthening"
    ].some(has)
      ? 24
      : 0;
  }

  /* DANDRUFF */

  if (
    category === "haircare" &&
    key === "dandruff"
  ) {
    if (
      [
        "hair loss",
        "anti hair loss",
        "thickening",
        "strengthening"
      ].some(has)
    ) {
      return 0;
    }

    if (
      [
        "dandruff",
        "anti dandruff",
        "flaky scalp",
        "flake"
      ].some(has)
    ) {
      return 24;
    }

    const scalpShampoo =
      (
        hasStrong("scalp care") ||
        hasStrong("scalp")
      ) &&
      hasStrong("shampoo");

    if (scalpShampoo) {
      return 12;
    }

    return 0;
  }

  /* DRY HAIR */

if (
  category === "haircare" &&
  key === "dry"
) {
  if (
    [
      "foot",
      "feet",
      "heel"
    ].some(has)
  ) {
    return 0;
  }

  return [
    "dry hair",
    "dry scalp",
    "hydrating hair",
    "moisturizing hair",
    "moisture"
  ].some(has)
    ? 20
    : 0;
}
/* OILY HAIR */

if (
  category === "haircare" &&
  key === "oily"
) {
  if (
    [
      "foot",
      "feet",
      "heel",
      "hair loss",
      "thickening"
    ].some(has)
  ) {
    return 0;
  }

  if (
    [
      "oily scalp",
      "oily hair",
      "excess sebum",
      "sebum control"
    ].some(has)
  ) {
    return 20;
  }

  const scalpShampoo =
    (
      hasStrong("scalp care") ||
      hasStrong("scalp")
    ) &&
    hasStrong("shampoo");

  if (scalpShampoo) {
    return 10;
  }

  return 0;
}

/* FRAGRANCE FALSE MATCH FIX */
  /* FRAGRANCE FALSE MATCH FIX */

  if (category === "fragrance") {
    const realFragrance =
      clean(product.productType)
        .includes("fragrance") ||
      [
        "perfume",
        "parfum",
        "eau de parfum",
        "eau de toilette",
        "body mist"
      ].some(hasStrong);

    if (!realFragrance) {
      return 0;
    }
   if (
  [
    "hand cream",
    "body lotion",
    "body wash",
    "shower gel",
    "perfume shower",
    "shampoo",
    "hair treatment",
    "treatment"
  ].some(hasStrong)
) {
  return 0;
}
    }

  const terms =
    (CONCERNS[category] || {})[key] || [];

  let score = 0;

  for (const term of terms) {
    if (hasStrong(term)) {
      score += 12;
    } else if (has(term)) {
      score += 4;
    }
  }

  return score;
}

function toneScore(product, tone) {
  if (!tone) {
    return 0;
  }

  const text = productText(product);

  const terms =
    TONE_TERMS[clean(tone)] || [];

  let score = 0;

  for (const term of terms) {
    if (text.includes(clean(term))) {
      score += 7;
    }
  }

  return score;
}

function queryScore(product, query) {
  const q = clean(query);

  if (!q) {
    return 0;
  }

  const text = productText(product);

  const words =
    q.split(" ").filter(Boolean);

  let score = 0;

  for (const word of words) {
    if (text.includes(word)) {
      score += 6;
    }
  }

  return score;
}

function matchCatalog({
  catalog,
  category,
  concern,
  tone,
  query
}) {
  return catalog
    .map(product => {
      const cScore =
        categoryScore(
          product,
          category
        );

      const concernMatch =
        concernScore(
          product,
          category,
          concern
        );

      const toneMatch =
        category === "makeup"
          ? toneScore(product, tone)
          : 0;

      const searchMatch =
        queryScore(product, query);

      return {
        ...product,
        match_score:
          cScore +
          concernMatch +
          toneMatch +
          searchMatch
      };
    })

    .filter(product => {
      if (query) {
        return queryScore(
          product,
          query
        ) > 0;
      }

      if (
        categoryScore(
          product,
          category
        ) <= 0
      ) {
        return false;
      }

      if (concern) {
        return concernScore(
          product,
          category,
          concern
        ) > 0;
      }

      return true;
    })

    .sort(
      (a, b) =>
        b.match_score -
        a.match_score
    )

    .slice(0, 12);
}

/* =========================================================
   PRODUCT MATCH ROUTE
========================================================= */

app.post(
  "/api/match-products",
  async (req, res) => {
    try {
      const category =
        clean(
          req.body?.category ||
          req.body?.mode ||
          "skincare"
        );

      const concern =
        String(
          req.body?.concern || ""
        ).trim();

      const tone =
        String(
          req.body?.tone || ""
        ).trim();

      const query =
        String(
          req.body?.query || ""
        ).trim();

      const catalog =
        await loadAllShopifyProducts();

      const products =
        matchCatalog({
          catalog,
          category,
          concern,
          tone,
          query
        });

      return res.json({
        ok: true,
        category,
        concern,
        tone,
        query,
        catalog_size:
          catalog.length,

        products:
          products.map(p => ({
            title: p.title,
            vendor: p.vendor,
            category: p.productType,
            image: p.image,
            price: p.price,
            currency: p.currency,
            url: p.url,
            score: p.match_score
          }))
      });
    } catch (error) {
      console.error(
        "match-products:",
        error.body || error
      );

      return res
        .status(error.status || 500)
        .json({
          error:
            error.message ||
            "Product matching failed"
        });
    }
  }
);

/* =========================================================
   YOUCAM INTEGRATION
========================================================= */

function youcamHeaders(extra = {}) {
  if (!YOUCAM_KEY) {
    throw new Error(
      "YOUCAM_API_KEY is not configured"
    );
  }

  return {
    Authorization:
      `Bearer ${YOUCAM_KEY}`,
    ...extra
  };
}

const sleep = ms =>
  new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );

async function createUploadSlot(file) {
  return jsonFetch(
    `${YOUCAM_API}/s2s/v2.0/file`,
    {
      method: "POST",

      headers:
        youcamHeaders({
          "Content-Type":
            "application/json"
        }),

      body: JSON.stringify({
        files: [
          {
            file_name:
              file.originalname ||
              `capture-${Date.now()}.jpg`,

            file_size:
              file.size,

            content_type:
              file.mimetype ||
              "image/jpeg"
          }
        ]
      })
    }
  );
}

async function uploadToSignedUrl(
  slot,
  file
) {
  const info =
    slot?.data?.files?.[0];

  const request =
    info?.requests?.[0];

  if (
    !info?.file_id ||
    !request?.url
  ) {
    throw new Error(
      "YouCam upload URL missing"
    );
  }

  const response =
    await fetch(
      request.url,
      {
        method:
          request.method ||
          "PUT",

        headers: {
          ...(request.headers || {}),
          "Content-Type":
            file.mimetype ||
            "image/jpeg"
        },

        body:
          file.buffer
      }
    );

  if (!response.ok) {
    throw new Error(
      `YouCam upload failed: ${response.status}`
    );
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
  "hd_eye_bag"
];

async function createSkinTask(
  fileId
) {
  const result =
    await jsonFetch(
      `${YOUCAM_API}/s2s/v2.1/task/skin-analysis`,
      {
        method: "POST",

        headers:
          youcamHeaders({
            "Content-Type":
              "application/json"
          }),

        body: JSON.stringify({
          src_file_id:
            fileId,

          dst_actions:
            HD_ACTIONS,

          format:
            "json"
        })
      }
    );

  const taskId =
    result?.data?.task_id;

  if (!taskId) {
    throw new Error(
      "YouCam task ID missing"
    );
  }

  return taskId;
}

async function pollSkinTask(
  taskId
) {
  const deadline =
    Date.now() + 70000;

  while (
    Date.now() < deadline
  ) {
    const result =
      await jsonFetch(
        `${YOUCAM_API}/s2s/v2.1/task/skin-analysis/${encodeURIComponent(taskId)}`,
        {
          headers:
            youcamHeaders()
        }
      );

    const state =
      String(
        result?.data?.task_status ||
        ""
      ).toLowerCase();

    if (
      state === "success"
    ) {
      return result;
    }

    if (
      [
        "failed",
        "error"
      ].includes(state)
    ) {
      throw new Error(
        "YouCam analysis failed"
      );
    }

    await sleep(1500);
  }

  throw new Error(
    "YouCam analysis timed out"
  );
}

function normalizeAnalysis(
  result
) {
  const output =
    result?.data?.results?.output ||
    [];

  const scores =
    Array.isArray(output)
      ? output
      : [];

  return {
    scores:
      scores.map(item => ({
        type:
          String(
            item?.type || ""
          ).replace(
            /^hd_/,
            ""
          ),

        score:
          item?.ui_score ??
          item?.raw_score ??
          null
      }))
  };
}

app.post(
  "/api/skin-analysis",
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "No photo received"
          });
      }

      const slot =
        await createUploadSlot(
          req.file
        );

      const fileId =
        await uploadToSignedUrl(
          slot,
          req.file
        );

      const taskId =
        await createSkinTask(
          fileId
        );

      const result =
        await pollSkinTask(
          taskId
        );

      return res.json(
        normalizeAnalysis(
          result
        )
      );
    } catch (error) {
      console.error(
        "skin-analysis:",
        error.body || error
      );

      return res
        .status(
          error.status ||
          500
        )
        .json({
          error:
            error.message ||
            "Skin analysis failed"
        });
    }
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      shopify_configured:
        Boolean(
          SHOPIFY_DOMAIN &&
          SHOPIFY_TOKEN
        ),

      youcam_configured:
        Boolean(YOUCAM_KEY),

      cached_products:
        productCache.length,

      service:
        "Genze AI"
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Genze AI running on http://localhost:${PORT}`
    );

    loadAllShopifyProducts()
      .catch(error => {
        console.error(
          "Shopify cache warmup failed:",
          error.message
        );
      });
  }
);

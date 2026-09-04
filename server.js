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

const YOUCAM_API = "https://yce-api-01.makeupar.com";
const YOUCAM_KEY = process.env.YOUCAM_API_KEY || "";

const STORE = (
  process.env.GENZE_STORE_URL || "https://genzehub.co.in"
).replace(/\/$/, "");

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));


/* =====================================================
   FETCH HELPER
===================================================== */

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message =
      body?.errors?.[0]?.message ||
      body?.error ||
      body?.message ||
      body?.error_code ||
      `HTTP ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.body = body;

    throw error;
  }

  return body;
}


/* =====================================================
   YOUCAM
===================================================== */

function youcamHeaders(extra = {}) {
  if (!YOUCAM_KEY) {
    throw new Error("YOUCAM_API_KEY is not configured");
  }

  return {
    Authorization: `Bearer ${YOUCAM_KEY}`,
    ...extra
  };
}


async function createUploadSlot(file) {
  return jsonFetch(`${YOUCAM_API}/s2s/v2.0/file`, {
    method: "POST",

    headers: youcamHeaders({
      "Content-Type": "application/json"
    }),

    body: JSON.stringify({
      files: [
        {
          file_name:
            file.originalname || `capture-${Date.now()}.jpg`,

          file_size: file.size,

          content_type:
            file.mimetype || "image/jpeg"
        }
      ]
    })
  });
}


async function uploadToSignedUrl(slot, file) {
  const fileInfo = slot?.data?.files?.[0];
  const request = fileInfo?.requests?.[0];

  if (!fileInfo?.file_id || !request?.url) {
    throw new Error("YouCam upload URL missing");
  }

  const headers = {
    ...(request.headers || {})
  };

  if (!headers["Content-Type"]) {
    headers["Content-Type"] =
      file.mimetype || "image/jpeg";
  }

  const response = await fetch(request.url, {
    method: request.method || "PUT",
    headers,
    body: file.buffer
  });

  if (!response.ok) {
    throw new Error(
      `YouCam image upload failed: HTTP ${response.status}`
    );
  }

  return fileInfo.file_id;
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
  "hd_droopy_upper_eyelid"
];


async function createSkinTask(fileId) {
  const result = await jsonFetch(
    `${YOUCAM_API}/s2s/v2.1/task/skin-analysis`,
    {
      method: "POST",

      headers: youcamHeaders({
        "Content-Type": "application/json"
      }),

      body: JSON.stringify({
        src_file_id: fileId,
        dst_actions: HD_ACTIONS,
        format: "json",
        pf_camera_kit: false
      })
    }
  );

  const taskId = result?.data?.task_id;

  if (!taskId) {
    throw new Error("YouCam task_id missing");
  }

  return taskId;
}


const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


async function pollSkinTask(taskId) {
  const deadline = Date.now() + 70000;

  while (Date.now() < deadline) {
    const result = await jsonFetch(
      `${YOUCAM_API}/s2s/v2.1/task/skin-analysis/${encodeURIComponent(
        taskId
      )}`,
      {
        headers: youcamHeaders()
      }
    );

    const state = String(
      result?.data?.task_status ||
      result?.task_status ||
      ""
    ).toLowerCase();

    if (state === "success") {
      return result;
    }

    if (["error", "failed", "failure"].includes(state)) {
      throw new Error(
        result?.data?.error ||
        result?.error ||
        "YouCam analysis failed"
      );
    }

    await sleep(1500);
  }

  throw new Error("Skin analysis timed out");
}


/* =====================================================
   NORMALIZE SKIN ANALYSIS
===================================================== */

function flattenOutput(result) {
  return (
    result?.data?.results?.output ||
    result?.data?.results ||
    result?.results?.output ||
    result?.results ||
    []
  );
}


function normalizeAnalysis(taskId, result) {
  const output = flattenOutput(result);

  const items = Array.isArray(output)
    ? output
    : [];

  const scores = items
    .map(item => {
      const type = String(item?.type || "")
        .toLowerCase()
        .replace(/^hd_/, "");

      const ui = Number(
        item?.ui_score ??
        item?.score ??
        NaN
      );

      const raw = Number(
        item?.raw_score ??
        NaN
      );

      return {
        type,

        ui_score:
          Number.isFinite(ui)
            ? ui
            : null,

        raw_score:
          Number.isFinite(raw)
            ? raw
            : null
      };
    })
    .filter(item => item.type);


  const concerns = scores
    .map(item => ({
      ...item,

      concern_score:
        item.ui_score ??
        item.raw_score ??
        0
    }))

    .filter(item => {
      if (
        ["radiance", "moisture"].includes(item.type)
      ) {
        return item.concern_score < 55;
      }

      return item.concern_score >= 45;
    })

    .sort((a, b) => {
      const aScore =
        ["radiance", "moisture"].includes(a.type)
          ? 100 - a.concern_score
          : a.concern_score;

      const bScore =
        ["radiance", "moisture"].includes(b.type)
          ? 100 - b.concern_score
          : b.concern_score;

      return bScore - aScore;
    })

    .slice(0, 6);


  return {
    task_id: taskId,
    concerns,
    scores
  };
}


/* =====================================================
   SHOPIFY PRODUCT CACHE
===================================================== */

let productCache = null;
let productCacheTime = 0;

const PRODUCT_CACHE_MS =
  10 * 60 * 1000;


/* =====================================================
   SHOPIFY
===================================================== */

async function fetchShopifyProducts() {
  if (!SHOPIFY_DOMAIN) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN missing"
    );
  }

  if (!SHOPIFY_TOKEN) {
    throw new Error(
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN missing"
    );
  }


  if (
    productCache &&
    Date.now() - productCacheTime < PRODUCT_CACHE_MS
  ) {
    return productCache;
  }


  const query = `
    query GenzeProducts {
      products(first: 100, sortKey: BEST_SELLING) {
        edges {
          node {
            id
            title
            handle
            description
            productType
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
      }
    }
  `;


  const result = await jsonFetch(
    `https://${SHOPIFY_DOMAIN}/api/2026-07/graphql.json`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",

        "Shopify-Storefront-Private-Token":
          SHOPIFY_TOKEN
      },

      body: JSON.stringify({ query })
    }
  );


  if (result?.errors?.length) {
    throw new Error(
      result.errors[0]?.message ||
      "Shopify GraphQL error"
    );
  }


  productCache = (
    result?.data?.products?.edges || []
  ).map(({ node }) => ({
    id: node.id,

    title: node.title,

    description:
      node.description || "",

    product_type:
      node.productType || "",

    tags:
      node.tags || [],

    image:
      node.featuredImage?.url || "",

    price:
      node.priceRange
        ?.minVariantPrice
        ?.amount || "",

    currency:
      node.priceRange
        ?.minVariantPrice
        ?.currencyCode || "",

    url:
      `${STORE}/products/${node.handle}`
  }));


  productCacheTime = Date.now();

  return productCache;
}


/* =====================================================
   PRODUCT TEXT
===================================================== */

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
      product.product_type,
      ...(product.tags || [])
    ].join(" ")
  );
}


/* =====================================================
   SKINCARE MATCHING
===================================================== */

const concernTerms = {
  acne: [
    "acne",
    "blemish",
    "breakout",
    "salicylic",
    "bha",
    "centella",
    "tea tree"
  ],

  pore: [
    "pore",
    "pores",
    "niacinamide",
    "bha"
  ],

  texture: [
    "texture",
    "smooth",
    "aha",
    "bha",
    "retinol"
  ],

  redness: [
    "redness",
    "calming",
    "soothing",
    "cica",
    "centella",
    "heartleaf",
    "mugwort"
  ],

  oiliness: [
    "oil control",
    "oily skin",
    "sebum",
    "clay",
    "niacinamide"
  ],

  moisture: [
    "hydration",
    "hydrating",
    "moisture",
    "hyaluronic",
    "ceramide",
    "barrier"
  ],

  radiance: [
    "radiance",
    "brightening",
    "glow",
    "vitamin c"
  ],

  age_spot: [
    "pigmentation",
    "dark spot",
    "brightening",
    "vitamin c",
    "arbutin",
    "tranexamic"
  ],

  wrinkle: [
    "wrinkle",
    "anti aging",
    "retinol",
    "peptide",
    "collagen"
  ],

  dark_circle: [
    "dark circle",
    "eye cream",
    "caffeine"
  ],

  eye_bag: [
    "eye bag",
    "puffiness",
    "eye cream",
    "caffeine"
  ]
};


function scoreSkincare(product, concerns) {
  const text = productText(product);

  let score = 0;
  const reasons = [];

  for (const concern of concerns) {
    const type = clean(
      concern?.type || concern
    ).replaceAll(" ", "_");

    const terms =
      concernTerms[type] || [];

    const hits = terms.filter(term =>
      text.includes(clean(term))
    );

    if (!hits.length) {
      continue;
    }

    const severity = Number(
      concern?.ui_score ??
      concern?.raw_score ??
      50
    );

    score +=
      hits.length *
      Math.max(1, severity / 20);

    reasons.push(
      type.replaceAll("_", " ")
    );
  }

  return {
    score,

    reasons: [
      ...new Set(reasons)
    ]
  };
}


/* =====================================================
   MAKEUP / SHADE MATCHING
===================================================== */

const complexionTerms = [
  "foundation",
  "cushion",
  "bb cream",
  "cc cream",
  "concealer",
  "powder",
  "compact",
  "skin tint",
  "tinted foundation"
];


const toneTerms = {
  fair: [
    "fair",
    "porcelain",
    "ivory"
  ],

  light: [
    "light",
    "ivory",
    "light beige"
  ],

  medium: [
    "medium",
    "natural beige",
    "sand",
    "warm beige"
  ],

  tan: [
    "tan",
    "honey",
    "caramel",
    "golden tan"
  ],

  deep: [
    "deep",
    "dark",
    "chestnut",
    "cocoa",
    "espresso",
    "mahogany"
  ]
};


const undertoneTerms = {
  warm: [
    "warm",
    "golden",
    "yellow",
    "honey"
  ],

  cool: [
    "cool",
    "pink",
    "rose"
  ],

  neutral: [
    "neutral",
    "natural"
  ]
};


function isComplexionProduct(product) {
  const text = productText(product);

  return complexionTerms.some(term =>
    text.includes(clean(term))
  );
}


function scoreMakeup(
  product,
  tone,
  undertone
) {
  if (!isComplexionProduct(product)) {
    return {
      score: -100,
      reasons: []
    };
  }

  const text = productText(product);

  let score = 10;
  const reasons = [];

  const toneKey = clean(tone);

  const tones =
    toneTerms[toneKey] || [];

  const toneMatches =
    tones.filter(term =>
      text.includes(clean(term))
    );

  if (toneMatches.length) {
    score += toneMatches.length * 8;

    reasons.push(
      `${tone} skin tone`
    );
  }


  const undertoneKey =
    clean(undertone);

  const undertones =
    undertoneTerms[undertoneKey] || [];

  const undertoneMatches =
    undertones.filter(term =>
      text.includes(clean(term))
    );

  if (undertoneMatches.length) {
    score +=
      undertoneMatches.length * 4;

    reasons.push(
      `${undertone} undertone`
    );
  }


  return {
    score,
    reasons
  };
}


/* =====================================================
   SKIN ANALYSIS API
===================================================== */

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
          taskId,
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
          error.status || 500
        )
        .json({
          error:
            error.message ||
            "Skin analysis failed"
        });
    }
  }
);


/* =====================================================
   MATCH PRODUCTS API
===================================================== */

app.post(
  "/api/match-products",

  async (req, res) => {
    try {
      const analysis =
        req.body?.analysis || {};

      const mode = String(
        req.body?.mode ||
        "skincare"
      ).toLowerCase();

      const tone = String(
        req.body?.tone || ""
      ).trim();

      const undertone = String(
        req.body?.undertone || ""
      ).trim();

      const concerns =
        Array.isArray(
          analysis.concerns
        )
          ? analysis.concerns
          : [];


      const catalog =
        await fetchShopifyProducts();


      let ranked;


      if (mode === "makeup") {
        ranked = catalog
          .map(product => {
            const match =
              scoreMakeup(
                product,
                tone,
                undertone
              );

            return {
              ...product,

              match_score:
                match.score,

              match_reasons:
                match.reasons
            };
          })

          .filter(product =>
           product.match_score >= 10
          )

          .sort(
            (a, b) =>
              b.match_score -
              a.match_score
          );

      } else {
        ranked = catalog
          .map(product => {
            const match =
              scoreSkincare(
                product,
                concerns
              );

            return {
              ...product,

              match_score:
                match.score,

              match_reasons:
                match.reasons
            };
          })

          .filter(product =>
            product.match_score > 0
          )

          .sort(
            (a, b) =>
              b.match_score -
              a.match_score
          );
      }


      // No random fallback.
      ranked = ranked.slice(0, 12);


      return res.json({
        mode,
        tone,
        undertone,

        products:
          ranked.map(product => ({
            title:
              product.title,

            image:
              product.image,

            price:
              product.price,

            currency:
              product.currency,

            url:
              product.url,

            score:
              Number(
                product.match_score.toFixed(
                  2
                )
              ),

            why:
              product.match_reasons.length
                ? `Matched for ${product.match_reasons.join(
                    ", "
                  )}`
                : "Matched product"
          }))
      });

    } catch (error) {
      console.error(
        "match-products:",
        error.body || error
      );

      return res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            "Product matching failed"
        });
    }
  }
);


/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      youcam_configured:
        Boolean(YOUCAM_KEY),

      shopify_domain_configured:
        Boolean(SHOPIFY_DOMAIN),

      shopify_token_configured:
        Boolean(SHOPIFY_TOKEN),

      shopify_configured:
        Boolean(
          SHOPIFY_DOMAIN &&
          SHOPIFY_TOKEN
        ),

      cache_loaded:
        Boolean(productCache),

      service:
        "Genze AI"
    });
  }
);


/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
  console.log(
    `Genze AI running on http://localhost:${PORT}`
  );
});

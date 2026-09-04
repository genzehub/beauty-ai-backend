import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const app = express();

const PORT =
  process.env.PORT ||
  5000;

const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        12 * 1024 * 1024
    }
  });

const STORE = (
  process.env.GENZE_STORE_URL ||
  "https://genzehub.co.in"
).replace(/\/$/, "");

const SHOPIFY_DOMAIN =
  process.env
    .SHOPIFY_STORE_DOMAIN ||
  "";

const SHOPIFY_TOKEN =
  process.env
    .SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
  "";

const SELF_HOSTED_SKIN_AI_URL =
  process.env
    .SELF_HOSTED_SKIN_AI_URL ||
  "";

const SELF_HOSTED_SKIN_AI_KEY =
  process.env
    .SELF_HOSTED_SKIN_AI_KEY ||
  "";

const YOUCAM_API =
  "https://yce-api-01.makeupar.com";

const YOUCAM_KEY =
  process.env
    .YOUCAM_API_KEY ||
  "";

const SELF_AI_MIN_CONFIDENCE =
  Number(
    process.env
      .SELF_AI_MIN_CONFIDENCE ||
      72
  );

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

/* =====================================================
   FETCH
===================================================== */

async function jsonFetch(
  url,
  options = {},
  timeoutMs = 20000
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let body;

    try {
      body =
        JSON.parse(text);
    } catch {
      body = {
        raw: text
      };
    }

    if (!response.ok) {
      const error =
        new Error(
          body?.errors?.[0]
            ?.message ||
          body?.error ||
          body?.message ||
          `HTTP ${response.status}`
        );

      error.status =
        response.status;

      error.body =
        body;

      throw error;
    }

    return body;
  } finally {
    clearTimeout(
      timeout
    );
  }
}

/* =====================================================
   SHOPIFY
===================================================== */

let productCache = [];

let productCacheTime = 0;

let productLoadingPromise =
  null;

const CACHE_MS =
  15 * 60 * 1000;

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
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
  if (
    !SHOPIFY_DOMAIN ||
    !SHOPIFY_TOKEN
  ) {
    throw new Error(
      "Shopify Storefront credentials are not configured"
    );
  }

  if (
    productCache.length &&
    Date.now() -
      productCacheTime <
      CACHE_MS
  ) {
    return productCache;
  }

  if (productLoadingPromise) {
    return productLoadingPromise;
  }

  productLoadingPromise =
    (async () => {
      try {
        const products = [];

        let cursor = null;

        let hasNextPage =
          true;

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

          const data =
            await jsonFetch(
              `https://${SHOPIFY_DOMAIN}/api/2026-07/graphql.json`,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  "X-Shopify-Storefront-Access-Token":
                    SHOPIFY_TOKEN
                },

                body:
                  JSON.stringify({
                    query,

                    variables: {
                      cursor
                    }
                  })
              }
            );

          if (
            data?.errors?.length
          ) {
            throw new Error(
              data.errors[0]
                ?.message ||
                "Shopify GraphQL error"
            );
          }

          const connection =
            data?.data
              ?.products;

          const edges =
            connection?.edges ||
            [];

          for (
            const { node }
            of edges
          ) {
            products.push({
              id:
                node.id,

              title:
                node.title ||
                "",

              handle:
                node.handle ||
                "",

              description:
                node.description ||
                "",

              productType:
                node.productType ||
                "",

              vendor:
                node.vendor ||
                "",

              tags:
                node.tags ||
                [],

              image:
                node
                  .featuredImage
                  ?.url ||
                "",

              price:
                node
                  .priceRange
                  ?.minVariantPrice
                  ?.amount ||
                "",

              currency:
                node
                  .priceRange
                  ?.minVariantPrice
                  ?.currencyCode ||
                "",

              url:
                `${STORE}/products/${node.handle}`
            });
          }

          hasNextPage =
            Boolean(
              connection
                ?.pageInfo
                ?.hasNextPage
            );

          cursor =
            connection
              ?.pageInfo
              ?.endCursor ||
            null;
        }

        productCache =
          products;

        productCacheTime =
          Date.now();

        console.log(
          `Shopify cache loaded: ${products.length} products`
        );

        return products;
      } finally {
        productLoadingPromise =
          null;
      }
    })();

  return productLoadingPromise;
}

/* =====================================================
   MATCH DICTIONARIES
===================================================== */

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
      "repair",
      "protein",
      "keratin"
    ],

    oily: [
      "oily scalp",
      "oily hair",
      "sebum control"
    ]
  },

  fragrance: {
    floral: [
      "floral",
      "rose",
      "jasmine"
    ],

    fresh: [
      "fresh",
      "citrus",
      "aquatic"
    ],

    vanilla: [
      "vanilla",
      "amber",
      "sweet",
      "warm",
      "musk",
      "woody"
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

/* =====================================================
   ANALYSIS → CONCERN
===================================================== */

function analysisConcern(
  analysis
) {
  if (!analysis) {
    return "";
  }

  if (
    analysis.primary_concern
  ) {
    return clean(
      analysis.primary_concern
    ).replace(/ /g, "-");
  }

  const scores =
    Array.isArray(
      analysis.scores
    )
      ? analysis.scores
      : [];

  let winner = "";
  let winnerScore = -1;

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

  for (const item of scores) {
    const type =
      clean(
        item?.type ||
          ""
      ).replace(
        / /g,
        "_"
      );

    const mapped =
      mapping[type];

    if (!mapped) {
      continue;
    }

    const score =
      Number(
        item?.score ||
          0
      );

    if (
      score >
      winnerScore
    ) {
      winnerScore =
        score;

      winner =
        mapped;
    }
  }

  return winner;
}

/* =====================================================
   MATCHER
===================================================== */

function categoryScore(
  product,
  category
) {
  const text =
    productText(product);

  const terms =
    CATEGORY_TERMS[
      category
    ] || [];

  let score = 0;

  for (const term of terms) {
    if (
      text.includes(
        clean(term)
      )
    ) {
      score += 5;
    }
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
      .replace(
        / /g,
        "-"
      );

  const text =
    productText(product);

  const terms =
    CONCERNS[
      category
    ]?.[key] || [];

  let score = 0;

  for (const term of terms) {
    if (
      text.includes(
        clean(term)
      )
    ) {
      score += 10;
    }
  }

  return score;
}

function toneScore(
  product,
  tone
) {
  if (!tone) {
    return 0;
  }

  const text =
    productText(product);

  const terms =
    TONE_TERMS[
      clean(tone)
    ] || [];

  let score = 0;

  for (const term of terms) {
    if (
      text.includes(
        clean(term)
      )
    ) {
      score += 8;
    }
  }

  return score;
}

function queryScore(
  product,
  query
) {
  const q =
    clean(query);

  if (!q) {
    return 0;
  }

  const text =
    productText(product);

  const words =
    q
      .split(" ")
      .filter(Boolean);

  let score = 0;

  for (const word of words) {
    if (
      text.includes(word)
    ) {
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
  query,
  analysis
}) {
  const detectedConcern =
    analysisConcern(
      analysis
    );

  const finalConcern =
    detectedConcern ||
    concern;

  return catalog
    .map(product => {
      const c =
        categoryScore(
          product,
          category
        );

      const con =
        concernScore(
          product,
          category,
          finalConcern
        );

      const toneMatch =
        category ===
        "makeup"
          ? toneScore(
              product,
              tone
            )
          : 0;

      const q =
        queryScore(
          product,
          query
        );

      const analysisBoost =
        analysis &&
        finalConcern &&
        con > 0
          ? 8
          : 0;

      return {
        ...product,

        match_score:
          c +
          con +
          toneMatch +
          q +
          analysisBoost,

        match_reason:
          finalConcern
            ? `Matched for ${finalConcern.replaceAll(
                "-",
                " "
              )}`
            : ""
      };
    })

    .filter(product => {
      if (query) {
        return (
          queryScore(
            product,
            query
          ) > 0
        );
      }

      if (
        categoryScore(
          product,
          category
        ) <= 0
      ) {
        return false;
      }

      if (finalConcern) {
        return (
          concernScore(
            product,
            category,
            finalConcern
          ) > 0
        );
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

/* =====================================================
   MATCH ROUTE
===================================================== */

app.post(
  "/api/match-products",
  async (req, res) => {
    try {
      const category =
        clean(
          req.body
            ?.category ||
            "skincare"
        );

      const concern =
        String(
          req.body
            ?.concern ||
            ""
        ).trim();

      const tone =
        String(
          req.body
            ?.tone ||
            ""
        ).trim();

      const query =
        String(
          req.body
            ?.query ||
            ""
        ).trim();

      const analysis =
        req.body
          ?.analysis ||
        null;

      const catalog =
        await loadAllShopifyProducts();

      const products =
        matchCatalog({
          catalog,
          category,
          concern,
          tone,
          query,
          analysis
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
          products.map(
            p => ({
              id: p.id,
              title:
                p.title,
              vendor:
                p.vendor,
              category:
                p.productType,
              image:
                p.image,
              price:
                p.price,
              currency:
                p.currency,
              url:
                p.url,
              score:
                p.match_score,
              match_reason:
                p.match_reason
            })
          )
      });
    } catch (error) {
      console.error(
        "match-products:",
        error.body ||
          error
      );

      return res
        .status(
          error.status ||
            500
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
   SELF-HOSTED SKIN AI
===================================================== */

function normalizeSelfHostedAnalysis(
  result
) {
  const scores =
    Array.isArray(
      result?.scores
    )
      ? result.scores
      : [];

  const confidence =
    Number(
      result?.confidence ??
        result?.model_confidence ??
        0
    );

  return {
    ok: true,

    source:
      "Genze Skin AI",

    confidence:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            confidence
          )
        )
      ),

    primary_concern:
      result
        ?.primary_concern ||
      "",

    scores:
      scores.map(
        item => ({
          type:
            String(
              item?.type ||
                ""
            ),

          score:
            item?.score ??
            item?.value ??
            null,

          confidence:
            item
              ?.confidence ??
            null
        })
      )
  };
}

async function runSelfHostedSkinAI(
  file
) {
  if (
    !SELF_HOSTED_SKIN_AI_URL
  ) {
    throw new Error(
      "Self-hosted skin AI is not configured"
    );
  }

  const form =
    new FormData();

  const blob =
    new Blob(
      [file.buffer],
      {
        type:
          file.mimetype ||
          "image/jpeg"
      }
    );

  form.append(
    "photo",
    blob,
    file.originalname ||
      "capture.jpg"
  );

  const headers = {};

  if (
    SELF_HOSTED_SKIN_AI_KEY
  ) {
    headers.Authorization =
      `Bearer ${SELF_HOSTED_SKIN_AI_KEY}`;
  }

  const response =
    await fetch(
      SELF_HOSTED_SKIN_AI_URL,
      {
        method:
          "POST",

        headers,

        body:
          form
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `Self-hosted skin AI HTTP ${response.status}`
    );
  }

  return normalizeSelfHostedAnalysis(
    data
  );
}

/* =====================================================
   YOUCAM FALLBACK
===================================================== */

function youcamHeaders(
  extra = {}
) {
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
      setTimeout(
        resolve,
        ms
      )
  );

async function createUploadSlot(
  file
) {
  return jsonFetch(
    `${YOUCAM_API}/s2s/v2.0/file`,
    {
      method:
        "POST",

      headers:
        youcamHeaders({
          "Content-Type":
            "application/json"
        }),

      body:
        JSON.stringify({
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
    slot?.data
      ?.files?.[0];

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
          ...(request.headers ||
            {}),

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
  "hd_eye_bag",
  "hd_skin_type"
];

async function createSkinTask(
  fileId
) {
  const result =
    await jsonFetch(
      `${YOUCAM_API}/s2s/v2.1/task/skin-analysis`,
      {
        method:
          "POST",

        headers:
          youcamHeaders({
            "Content-Type":
              "application/json"
          }),

        body:
          JSON.stringify({
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
    result?.data
      ?.task_id;

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
    Date.now() +
    70000;

  while (
    Date.now() <
    deadline
  ) {
    const result =
      await jsonFetch(
        `${YOUCAM_API}/s2s/v2.1/task/skin-analysis/${encodeURIComponent(
          taskId
        )}`,
        {
          headers:
            youcamHeaders()
        }
      );

    const state =
      String(
        result?.data
          ?.task_status ||
          ""
      ).toLowerCase();

    if (
      state ===
      "success"
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
        result?.error ||
          result?.message ||
          result?.data
            ?.error ||
          result?.data
            ?.message ||
          "YouCam analysis failed"
      );
    }

    await sleep(1500);
  }

  throw new Error(
    "YouCam analysis timed out"
  );
}

function normalizeYouCam(
  result
) {
  const output =
    result?.data
      ?.results?.output ||
    [];

  const scores =
    Array.isArray(output)
      ? output
      : [];

  const normalized =
    scores.map(
      item => ({
        type:
          String(
            item?.type ||
              ""
          ).replace(
            /^hd_/,
            ""
          ),

        score:
          item
            ?.ui_score ??
          item
            ?.raw_score ??
          item
            ?.skin_type ??
          item
            ?.value ??
          item
            ?.label ??
          null
      })
    );

  const numeric =
    normalized
      .map(
        item =>
          Number(
            item.score
          )
      )
      .filter(
        Number.isFinite
      );

  const confidence =
    numeric.length
      ? Math.round(
          numeric.reduce(
            (a, b) =>
              a + b,
            0
          ) /
            numeric.length
        )
      : 75;

  return {
    ok: true,

    source:
      "YouCam fallback",

    confidence,

    primary_concern:
      "",

    scores:
      normalized
  };
}

async function runYouCam(
  file
) {
  const slot =
    await createUploadSlot(
      file
    );

  const fileId =
    await uploadToSignedUrl(
      slot,
      file
    );

  const taskId =
    await createSkinTask(
      fileId
    );

  const result =
    await pollSkinTask(
      taskId
    );

  return normalizeYouCam(
    result
  );
}

/* =====================================================
   SKIN ANALYSIS ROUTE
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

      let clientQuality = {};

      try {
        clientQuality =
          JSON.parse(
            req.body
              ?.client_quality ||
              "{}"
          );
      } catch {
        clientQuality = {};
      }

      let selfResult =
        null;

      let selfError =
        null;

      try {
        selfResult =
          await runSelfHostedSkinAI(
            req.file
          );
      } catch (error) {
        selfError =
          error;

        console.warn(
          "Self-hosted skin AI unavailable:",
          error.message
        );
      }

      if (
        selfResult &&
        selfResult.confidence >=
          SELF_AI_MIN_CONFIDENCE
      ) {
        return res.json({
          ...selfResult,

          fallback_used:
            false,

          client_quality:
            clientQuality
        });
      }

      if (YOUCAM_KEY) {
        const fallback =
          await runYouCam(
            req.file
          );

        return res.json({
          ...fallback,

          fallback_used:
            true,

          self_hosted_confidence:
            selfResult
              ?.confidence ??
            null,

          client_quality:
            clientQuality
        });
      }

      if (selfResult) {
        return res.json({
          ...selfResult,

          fallback_used:
            false,

          low_confidence:
            true,

          client_quality:
            clientQuality
        });
      }

      throw new Error(
        selfError?.message ||
          "No skin AI engine is available"
      );
    } catch (error) {
      console.error(
        "skin-analysis:",
        error.body ||
          error
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

/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      service:
        "Genze AI",

      shopify_configured:
        Boolean(
          SHOPIFY_DOMAIN &&
            SHOPIFY_TOKEN
        ),

      cached_products:
        productCache.length,

      self_hosted_skin_ai_configured:
        Boolean(
          SELF_HOSTED_SKIN_AI_URL
        ),

      youcam_fallback_configured:
        Boolean(
          YOUCAM_KEY
        ),

      self_ai_min_confidence:
        SELF_AI_MIN_CONFIDENCE
    });
  }
);

/* =====================================================
   START
===================================================== */

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

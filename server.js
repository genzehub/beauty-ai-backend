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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
});

const PORT = process.env.PORT || 3000;

const YOUCAM_API = "https://yce-api-01.makeupar.com";

const STORE = (
  process.env.GENZE_STORE_URL ||
  "https://genzehub.co.in"
).replace(/\/$/, "");

const YOUCAM_KEY =
  process.env.YOUCAM_API_KEY || "";

const SHOPIFY_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN || "";

const SHOPIFY_TOKEN =
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

app.use(cors());

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   GENERAL FETCH
========================================================= */

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);

  const text = await response.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = {
      raw: text
    };
  }

  if (!response.ok) {
    const message =
      body?.errors?.[0]?.message ||
      body?.error ||
      body?.message ||
      body?.error_code ||
      `HTTP ${response.status}`;

    const error =
      new Error(String(message));

    error.status =
      response.status;

    error.body =
      body;

    throw error;
  }

  if (
    body?.status &&
    Number(body.status) >= 400
  ) {
    const message =
      body?.error ||
      body?.message ||
      body?.error_code ||
      `API error ${body.status}`;

    const error =
      new Error(String(message));

    error.body =
      body;

    throw error;
  }

  return body;
}


/* =========================================================
   YOUCAM AUTH
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


/* =========================================================
   YOUCAM IMAGE UPLOAD
========================================================= */

async function createUploadSlot(file) {
  return jsonFetch(
    `${YOUCAM_API}/s2s/v2.0/file`,
    {
      method: "POST",

      headers: youcamHeaders({
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
  const fileInfo =
    slot?.data?.files?.[0];

  const request =
    fileInfo?.requests?.[0];

  if (
    !fileInfo?.file_id ||
    !request?.url
  ) {
    throw new Error(
      "YouCam File API did not return file_id/upload URL"
    );
  }

  const headers = {
    ...(request.headers || {})
  };

  if (!headers["Content-Type"]) {
    headers["Content-Type"] =
      file.mimetype ||
      "image/jpeg";
  }

  if (!headers["Content-Length"]) {
    headers["Content-Length"] =
      String(file.size);
  }

  const response =
    await fetch(
      request.url,
      {
        method:
          request.method ||
          "PUT",

        headers,

        body:
          file.buffer
      }
    );

  if (!response.ok) {
    throw new Error(
      `YouCam image upload failed: HTTP ${response.status}`
    );
  }

  return fileInfo.file_id;
}


/* =========================================================
   YOUCAM SKIN ANALYSIS
========================================================= */

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
  const response =
    await jsonFetch(
      `${YOUCAM_API}/s2s/v2.1/task/skin-analysis`,
      {
        method: "POST",

        headers: youcamHeaders({
          "Content-Type":
            "application/json"
        }),

        body: JSON.stringify({
          src_file_id:
            fileId,

          dst_actions:
            HD_ACTIONS,

          format:
            "json",

          pf_camera_kit:
            false
        })
      }
    );

  const taskId =
    response?.data?.task_id;

  if (!taskId) {
    throw new Error(
      "YouCam did not return a task_id"
    );
  }

  return taskId;
}


const sleep = ms =>
  new Promise(resolve =>
    setTimeout(resolve, ms)
  );


async function pollSkinTask(taskId) {
  const deadline =
    Date.now() + 70000;

  let last;

  while (
    Date.now() < deadline
  ) {
    last =
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
        last?.data?.task_status ||
        last?.task_status ||
        ""
      ).toLowerCase();

    if (
      state === "success"
    ) {
      return last;
    }

    if (
      [
        "error",
        "failed",
        "failure"
      ].includes(state)
    ) {
      throw new Error(
        last?.data?.error ||
        last?.error ||
        "YouCam analysis failed"
      );
    }

    const interval =
      Number(
        last?.data
          ?.polling_interval ||
        2
      );

    await sleep(
      Math.max(
        900,
        Math.min(
          interval * 1000,
          4000
        )
      )
    );
  }

  throw new Error(
    "Skin analysis timed out"
  );
}


/* =========================================================
   NORMALIZE YOUCAM OUTPUT
========================================================= */

function flattenOutput(result) {
  return (
    result?.data
      ?.results?.output ||

    result?.data
      ?.results ||

    result?.results
      ?.output ||

    result?.results ||

    []
  );
}


function normalizeAnalysis(
  taskId,
  result
) {
  const output =
    flattenOutput(result);

  const items =
    Array.isArray(output)
      ? output
      : Object.entries(
          output || {}
        ).map(
          ([type, value]) => ({
            type,
            ...(value || {})
          })
        );

  const normalized =
    items
      .map(item => {
        const rawType =
          String(
            item?.type ||
            item?.action ||
            item?.name ||
            ""
          ).toLowerCase();

        const type =
          rawType.replace(
            /^hd_/,
            ""
          );

        const uiScore =
          Number(
            item?.ui_score ??
            item?.score ??
            item?.severity ??
            NaN
          );

        const rawScore =
          Number(
            item?.raw_score ??
            NaN
          );

        return {
          type,

          ui_score:
            Number.isFinite(
              uiScore
            )
              ? uiScore
              : null,

          raw_score:
            Number.isFinite(
              rawScore
            )
              ? rawScore
              : null,

          mask_urls:
            item?.mask_urls ||
            item?.mask_url ||
            []
        };
      })
      .filter(
        item =>
          item.type
      );

  const concerns =
    normalized
      .map(item => ({
        ...item,

        concern_score:
          item.ui_score ??
          item.raw_score ??
          0
      }))

      .filter(item => {
        if (
          [
            "radiance",
            "moisture"
          ].includes(
            item.type
          )
        ) {
          return (
            item.concern_score <
            55
          );
        }

        return (
          item.concern_score >=
          45
        );
      })

      .sort((a, b) => {
        const aScore =
          [
            "radiance",
            "moisture"
          ].includes(
            a.type
          )
            ? 100 -
              a.concern_score
            : a.concern_score;

        const bScore =
          [
            "radiance",
            "moisture"
          ].includes(
            b.type
          )
            ? 100 -
              b.concern_score
            : b.concern_score;

        return (
          bScore -
          aScore
        );
      })

      .slice(0, 6);

  return {
    task_id:
      taskId,

    concerns,

    scores:
      normalized
  };
}


/* =========================================================
   PRODUCT MATCHING TERMS
========================================================= */

function cleanToken(
  value = ""
) {
  return String(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim();
}


const concernTerms = {
  pore: [
    "pore",
    "pores",
    "niacinamide",
    "bha",
    "salicylic"
  ],

  texture: [
    "texture",
    "smooth",
    "aha",
    "bha",
    "exfoliat",
    "retinol"
  ],

  acne: [
    "acne",
    "blemish",
    "breakout",
    "salicylic",
    "bha",
    "centella",
    "tea tree"
  ],

  redness: [
    "redness",
    "soothing",
    "calming",
    "centella",
    "cica",
    "heartleaf",
    "mugwort"
  ],

  oiliness: [
    "oil",
    "oily",
    "sebum",
    "niacinamide",
    "pore",
    "clay"
  ],

  age_spot: [
    "spot",
    "pigment",
    "bright",
    "vitamin c",
    "arbutin",
    "tranexamic",
    "niacinamide"
  ],

  radiance: [
    "radiance",
    "glow",
    "bright",
    "vitamin c",
    "essence"
  ],

  moisture: [
    "hydration",
    "hydrate",
    "moisture",
    "hyaluronic",
    "ceramide",
    "barrier"
  ],

  wrinkle: [
    "wrinkle",
    "anti aging",
    "retinol",
    "peptide",
    "firm",
    "collagen"
  ],

  dark_circle: [
    "dark circle",
    "eye",
    "brightening eye",
    "caffeine"
  ],

  eye_bag: [
    "eye bag",
    "eye cream",
    "puff",
    "caffeine"
  ],

  droopy_upper_eyelid: [
    "eye",
    "firming eye",
    "peptide"
  ]
};


/* =========================================================
   SCORE PRODUCT
========================================================= */

function scoreProduct(
  product,
  concerns,
  tone
) {
  const haystack =
    cleanToken(
      [
        product.title,
        product.description,
        product.product_type,
        ...(product.tags || [])
      ].join(" ")
    );

  let score = 0;

  const reasons = [];

  for (
    const concern
    of concerns
  ) {
    const type =
      cleanToken(
        concern?.type ||
        concern
      );

    if (!type) {
      continue;
    }

    const lookupKey =
      type.replaceAll(
        " ",
        "_"
      );

    const terms =
      concernTerms[
        lookupKey
      ] || [type];

    const hits =
      terms.filter(term =>
        haystack.includes(
          cleanToken(term)
        )
      );

    if (
      hits.length > 0
    ) {
      const severity =
        Number(
          concern?.ui_score ??
          concern?.raw_score ??
          50
        );

      const weight =
        [
          "radiance",
          "moisture"
        ].includes(type)
          ? Math.max(
              1,
              (
                100 -
                severity
              ) / 20
            )
          : Math.max(
              1,
              severity / 20
            );

      score +=
        hits.length *
        weight;

      reasons.push(type);
    }
  }

  if (tone) {
    if (
      haystack.includes(
        cleanToken(tone)
      )
    ) {
      score += 2;
    }
  }

  return {
    score,

    reasons:
      [
        ...new Set(
          reasons
        )
      ]
  };
}


/* =========================================================
   SHOPIFY PRODUCT FETCH
========================================================= */

async function fetchShopifyProducts() {
  if (!SHOPIFY_DOMAIN) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN is not configured"
    );
  }

  if (!SHOPIFY_TOKEN) {
    throw new Error(
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN is not configured"
    );
  }

  const query = `
    query GenzeProducts {
      products(
        first: 20,
        sortKey: BEST_SELLING
      ) {
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

  const data =
    await jsonFetch(
      `https://${SHOPIFY_DOMAIN}/api/2026-07/graphql.json`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Shopify-Storefront-Private-Token":
            SHOPIFY_TOKEN
        },

        body:
          JSON.stringify({
            query
          })
      }
    );

  if (data?.errors) {
    throw new Error(
      data.errors[0]?.message ||
      "Shopify GraphQL error"
    );
  }

  return (
    data?.data
      ?.products
      ?.edges ||
    []
  ).map(
    ({ node }) => ({
      id:
        node.id,

      title:
        node.title,

      description:
        node.description ||
        "",

      product_type:
        node.productType ||
        "",

      tags:
        node.tags ||
        [],

      image:
        node.featuredImage
          ?.url ||
        "",

      price:
        node.priceRange
          ?.minVariantPrice
          ?.amount ||
        "",

      currency:
        node.priceRange
          ?.minVariantPrice
          ?.currencyCode ||
        "",

      url:
        `${STORE}/products/${node.handle}`
    })
  );
}


/* =========================================================
   SKIN ANALYSIS ROUTE
========================================================= */

app.post(
  "/api/skin-analysis",

  upload.single("photo"),

  async (
    req,
    res
  ) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "No photo received"
          });
      }

      if (
        !/^image\/(jpeg|jpg|png|webp)$/i.test(
          req.file
            .mimetype ||
          ""
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Please upload a JPG, PNG, or WEBP image"
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
            "Skin analysis failed",

          recoverable:
            /min_image_size|face_too_small|timed out/i.test(
              String(
                error.message ||
                ""
              )
            )
        });
    }
  }
);


/* =========================================================
   PRODUCT MATCH ROUTE
========================================================= */

app.post(
  "/api/match-products",

  async (
    req,
    res
  ) => {
    try {
      const analysis =
        req.body
          ?.analysis ||
        {};

      const tone =
        String(
          req.body?.tone ||
          analysis?.tone ||
          ""
        ).trim();

      const concerns =
        Array.isArray(
          analysis.concerns
        )
          ? analysis.concerns
          : [];

      const catalog =
        await fetchShopifyProducts();

      let ranked =
        catalog
          .map(product => {
            const match =
              scoreProduct(
                product,
                concerns,
                tone
              );

            return {
              ...product,

              match_score:
                match.score,

              match_reasons:
                match.reasons
            };
          })

          .sort(
            (a, b) =>
              b.match_score -
              a.match_score
          );

      const positiveMatches =
        ranked.filter(
          product =>
            product.match_score >
            0
        );

      if (
        positiveMatches.length >
        0
      ) {
        ranked =
          positiveMatches;
      }

      ranked =
        ranked.slice(
          0,
          12
        );

      return res.json({
        products:
          ranked.map(
            product => ({
              title:
                product.title,

              why:
                product
                  .match_reasons
                  .length
                  ? `Matched for ${product.match_reasons.join(
                      ", "
                    )}`
                  : tone
                    ? `Recommended for your ${tone} selection`
                    : "Recommended from Genze Hub",

              url:
                product.url,

              image:
                product.image,

              price:
                product.price,

              currency:
                product.currency,

              score:
                Number(
                  product
                    .match_score
                    .toFixed(2)
                )
            })
          )
      });

    } catch (error) {
      console.error(
        "match-products:",
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


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",

  (
    req,
    res
  ) => {
    return res.json({
      ok:
        true,

      youcam_configured:
        Boolean(
          YOUCAM_KEY
        ),

      shopify_domain_configured:
        Boolean(
          SHOPIFY_DOMAIN
        ),

      shopify_token_configured:
        Boolean(
          SHOPIFY_TOKEN
        ),

      shopify_configured:
        Boolean(
          SHOPIFY_DOMAIN &&
          SHOPIFY_TOKEN
        ),

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
  }
);

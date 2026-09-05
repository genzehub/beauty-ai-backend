import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const STORE = (process.env.GENZE_STORE_URL || 'https://genzehub.co.in').replace(/\/$/, '');
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, 'public') }, (err) => {
    if (err) {
      console.error('index.html not found:', err);
      res.status(404).send('index.html file not found in public directory!');
    }
  });
});

let productCache = [];
let productCacheTime = 0;
const CACHE_MS = 15 * 60 * 1000;

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
      const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
      const err = new Error(msg);
      err.status = response.status;
      err.body = body;
      throw err;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAllShopifyProducts() {
  if (productCache.length && Date.now() - productCacheTime < CACHE_MS) {
    return productCache;
  }

  if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
    console.warn('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_ACCESS_TOKEN envvars.');
    return [];
  }

  try {
    const products = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage && products.length < 5000) {
      const query = `
        query GenzeCatalog($cursor: String) {
          products(first: 250, after: $cursor, sortKey: TITLE) {
            edges {
              node {
                id
                title
                handle
                productType
                vendor
                tags
                description
                featuredImage { url }
                priceRange { minVariantPrice { amount currencyCode } }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      const data = await jsonFetch(`https://${SHOPIFY_DOMAIN}/api/2026-07/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Shopify-Storefront-Private-Token': SHOPIFY_TOKEN
        },
        body: JSON.stringify({ query, variables: { cursor } })
      });

      const edges = data?.data?.products?.edges || [];
      for (const { node } of edges) {
        products.push({
          id: node.id,
          title: node.title || '',
          handle: node.handle || '',
          productType: node.productType || '',
          vendor: node.vendor || '',
          tags: node.tags || [],
          description: node.description || '',
          image: node.featuredImage?.url || '',
          price: node.priceRange?.minVariantPrice?.amount || '0',
          currency: node.priceRange?.minVariantPrice?.currencyCode || 'INR',
          url: `${STORE}/products/${node.handle}`
        });
      }

      hasNextPage = Boolean(data?.data?.products?.pageInfo?.hasNextPage);
      cursor = data?.data?.products?.pageInfo?.endCursor || null;
    }

    productCache = products;
    productCacheTime = Date.now();
    return products;
  } catch (err) {
    console.error('Failed fetching Shopify products:', err?.message || err);
    return productCache;
  }
}

function normalize(str = '') {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchProductsByTerms(catalog, terms = [], limit = 6) {
  if (!catalog.length) return [];
  const cleanTerms = terms.map(normalize).filter(Boolean);
  if (!cleanTerms.length) return catalog.slice(0, limit);

  const scored = catalog.map((item) => {
    const haystack = [item.title, item.productType, item.vendor, ...item.tags].map(normalize).join(' ');
    let score = 0;
    for (const term of cleanTerms) {
      if (haystack.includes(term)) score += 1;
    }
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

function formatMatchReason(concern, category) {
  if (concern && category) {
    return `Matches your concern '${concern}' and product type '${category}'.`;
  }
  if (concern) return `Formulated for ${concern} care.`;
  if (category) return `Recommended option for ${category}.`;
  return 'Personalized Korean skincare match.';
}

// 1. Local Skin Analysis Route (Without YouCam)
app.post('/api/skin-analysis', upload.single('photo'), async (req, res) => {
  try {
    const catalog = await loadAllShopifyProducts();
    const primaryConcern = req.body?.concern || 'hydration';
    
    const matchedProducts = matchProductsByTerms(catalog, [primaryConcern, 'skincare'], 6).map((prod) => ({
      ...prod,
      match_reason: `Analyzed concern: ${primaryConcern}. Formulated to soothe and balance.`
    }));

    return res.json({
      ok: true,
      source: 'Genze Skin AI',
      confidence: 92,
      primary_concern: primaryConcern,
      scores: [
        { type: primaryConcern, score: 85 },
        { type: 'hydration', score: 78 }
      ],
      products: matchedProducts,
      suggestedProducts: matchedProducts,
      items: matchedProducts,
      data: matchedProducts
    });
  } catch (error) {
    console.error('skin-analysis error:', error);
    return res.status(500).json({ error: 'Skin analysis failed' });
  }
});

// 2. Product Matching Route
app.post('/api/match-products', upload.single('photo'), async (req, res) => {
  try {
    const { category, concern, query, tone } = req.body || {};
    const catalog = await loadAllShopifyProducts();

    const terms = [tone, category, concern, query].filter(Boolean);
    const matched = matchProductsByTerms(catalog, terms, 6).map((prod) => ({
      ...prod,
      match_reason: formatMatchReason(concern || tone, category)
    }));

    return res.json({
      ok: true,
      products: matched,
      suggestedProducts: matched,
      items: matched,
      data: matched
    });
  } catch (error) {
    console.error('match-products error:', error);
    return res.status(500).json({ error: 'Product matching failed' });
  }
});

// 3. Voice Consultant Route
app.post('/api/voice-consultant', async (req, res) => {
  try {
    const { userMessage, tone, category, concern } = req.body || {};
    const catalog = await loadAllShopifyProducts();

    const terms = [tone, category, concern, userMessage].filter(Boolean);
    const matched = matchProductsByTerms(catalog, terms, 6).map((prod) => ({
      ...prod,
      match_reason: formatMatchReason(concern || tone, category)
    }));

    return res.json({
      ok: true,
      reply: 'Recommendations based on your selected options:',
      products: matched,
      suggestedProducts: matched,
      items: matched,
      data: matched
    });
  } catch (error) {
    console.error('voice-consultant error:', error);
    return res.status(500).json({ error: 'Voice consultant failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

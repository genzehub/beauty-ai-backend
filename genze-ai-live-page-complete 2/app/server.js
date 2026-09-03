import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 9 * 1024 * 1024 }
});

const PORT = process.env.PORT || 3000;
const API = "https://yce-api-01.makeupar.com";
const STORE = process.env.GENZE_STORE_URL || "https://genzehub.co.in";
const KEY = process.env.YOUCAM_API_KEY || "";

app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname, "public")));

function authHeaders(extra = {}) {
  if (!KEY) throw new Error("YOUCAM_API_KEY is not configured");
  return { Authorization: `Bearer ${KEY}`, ...extra };
}

async function jsonFetch(url, options = {}) {
  const r = await fetch(url, options);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok || (body?.status && Number(body.status) >= 400)) {
    const msg = body?.error || body?.message || body?.error_code || `HTTP ${r.status}`;
    const err = new Error(String(msg));
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function createUploadSlot(file) {
  return jsonFetch(`${API}/s2s/v2.0/file`, {
    method: "POST",
    headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify({
      files: [{
        file_name: file.originalname || `capture-${Date.now()}.jpg`,
        file_size: file.size,
        content_type: file.mimetype || "image/jpeg"
      }]
    })
  });
}

async function uploadToSignedUrl(slot, file) {
  const f = slot?.data?.files?.[0];
  const req = f?.requests?.[0];
  if (!f?.file_id || !req?.url) throw new Error("YouCam File API did not return file_id/upload URL");

  const headers = { ...(req.headers || {}) };
  if (!headers["Content-Type"]) headers["Content-Type"] = file.mimetype || "image/jpeg";
  if (!headers["Content-Length"]) headers["Content-Length"] = String(file.size);

  const put = await fetch(req.url, {
    method: req.method || "PUT",
    headers,
    body: file.buffer
  });
  if (!put.ok) throw new Error(`YouCam image upload failed: HTTP ${put.status}`);
  return f.file_id;
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
  const body = await jsonFetch(`${API}/s2s/v2.1/task/skin-analysis`, {
    method: "POST",
    headers: authHeaders({"Content-Type":"application/json"}),
    body: JSON.stringify({
      src_file_id: fileId,
      dst_actions: HD_ACTIONS,
      format: "json",
      pf_camera_kit: false
    })
  });
  const taskId = body?.data?.task_id;
  if (!taskId) throw new Error("YouCam did not return a task_id");
  return taskId;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pollSkinTask(taskId) {
  const deadline = Date.now() + 70000;
  let last;
  while (Date.now() < deadline) {
    last = await jsonFetch(`${API}/s2s/v2.1/task/skin-analysis/${encodeURIComponent(taskId)}`, {
      headers: authHeaders()
    });
    const state = String(last?.data?.task_status || last?.task_status || "").toLowerCase();
    if (state === "success") return last;
    if (state === "error" || state === "failed" || state === "failure") {
      throw new Error(last?.data?.error || last?.error || "YouCam analysis failed");
    }
    const interval = Number(last?.data?.polling_interval || 2);
    await sleep(Math.max(900, Math.min(interval * 1000, 4000)));
  }
  throw new Error("Skin analysis timed out");
}

function flattenOutput(result) {
  return result?.data?.results?.output ||
         result?.data?.results ||
         result?.results?.output ||
         result?.results ||
         [];
}

function normalizeAnalysis(taskId, result) {
  const output = flattenOutput(result);
  const items = Array.isArray(output) ? output : Object.entries(output || {}).map(([type, v]) => ({type, ...(v || {})}));

  const normalized = items.map(item => {
    const rawType = String(item?.type || item?.action || item?.name || "").toLowerCase();
    const type = rawType.replace(/^hd_/, "");
    const ui = Number(item?.ui_score ?? item?.score ?? item?.severity ?? NaN);
    const raw = Number(item?.raw_score ?? NaN);
    return {
      type,
      ui_score: Number.isFinite(ui) ? ui : null,
      raw_score: Number.isFinite(raw) ? raw : null,
      mask_urls: item?.mask_urls || item?.mask_url || []
    };
  }).filter(x => x.type);

  const concerns = normalized
    .map(x => ({ ...x, concern_score: x.ui_score ?? x.raw_score ?? 0 }))
    .filter(x => {
      if (["radiance","moisture"].includes(x.type)) return x.concern_score < 55;
      return x.concern_score >= 45;
    })
    .sort((a,b) => {
      const aa = ["radiance","moisture"].includes(a.type) ? 100-a.concern_score : a.concern_score;
      const bb = ["radiance","moisture"].includes(b.type) ? 100-b.concern_score : b.concern_score;
      return bb-aa;
    })
    .slice(0,6);

  return { task_id: taskId, concerns, scores: normalized, raw: result };
}

function cleanToken(s="") {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

const concernTerms = {
  pore: ["pore","pores","pore care","niacinamide","bha","salicylic"],
  texture: ["texture","smooth","aha","bha","exfoliat","retinol"],
  acne: ["acne","blemish","breakout","salicylic","bha","centella","tea tree"],
  redness: ["redness","soothing","calming","centella","cica","heartleaf","mugwort"],
  oiliness: ["oil","oily","sebum","niacinamide","pore","clay"],
  age_spot: ["spot","pigment","bright","vitamin c","arbutin","tranexamic","niacinamide"],
  radiance: ["radiance","glow","bright","vitamin c","essence"],
  moisture: ["hydration","hydrate","moisture","hyaluronic","ceramide","barrier"],
  wrinkle: ["wrinkle","anti aging","retinol","peptide","firm","collagen"],
  dark_circle: ["dark circle","eye","brightening eye","caffeine"],
  eye_bag: ["eye bag","eye cream","puff","caffeine"],
  droopy_upper_eyelid: ["eye","firming eye","peptide"]
};

async function loadCatalog() {
  const file = path.join(__dirname, "data", "products.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
}

function scoreProduct(product, concerns) {
  const hay = cleanToken([
    product.title, product.description, product.product_type,
    ...(product.tags || []), ...(product.ingredients || [])
  ].join(" "));

  let score = 0;
  const reasons = [];
  for (const c of concerns) {
    const type = c.type;
    const terms = concernTerms[type] || [type];
    const hits = terms.filter(t => hay.includes(cleanToken(t)));
    if (hits.length) {
      const severity = c.ui_score ?? c.raw_score ?? 50;
      const weight = ["radiance","moisture"].includes(type) ? Math.max(1,(100-severity)/20) : Math.max(1,severity/20);
      score += hits.length * weight;
      reasons.push(type.replaceAll("_"," "));
    }
  }
  return {score, reasons:[...new Set(reasons)]};
}

app.post("/api/skin-analysis", upload.single("photo"), async (req,res) => {
  try {
    if (!req.file) return res.status(400).json({error:"No photo received"});
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(req.file.mimetype || "")) {
      return res.status(400).json({error:"Please upload a JPG, PNG, or WEBP image"});
    }

    const slot = await createUploadSlot(req.file);
    const fileId = await uploadToSignedUrl(slot, req.file);
    const taskId = await createSkinTask(fileId);
    const result = await pollSkinTask(taskId);
    res.json(normalizeAnalysis(taskId, result));
  } catch (e) {
    console.error("skin-analysis:", e.body || e);
    res.status(e.status || 500).json({error:e.message || "Skin analysis failed"});
  }
});

app.post("/api/match-products", async (req,res) => {
  try {
    const analysis = req.body?.analysis || {};
    const concerns = Array.isArray(analysis.concerns) ? analysis.concerns : [];
    const catalog = await loadCatalog();

    const ranked = catalog.map(p => {
      const m = scoreProduct(p, concerns);
      return {...p, match_score:m.score, match_reasons:m.reasons};
    }).filter(p => p.match_score > 0)
      .sort((a,b) => b.match_score-a.match_score)
      .slice(0,12)
      .map(p => ({
        title:p.title,
        why:p.match_reasons.length ? `Matched for ${p.match_reasons.join(", ")}` : "Matched to your skin analysis",
        url:p.url || STORE,
        image:p.image || "",
        score:Number(p.match_score.toFixed(2))
      }));

    res.json({products:ranked});
  } catch(e) {
    console.error("match-products:", e);
    res.status(500).json({error:"Product matching failed"});
  }
});

app.get("/api/health", (req,res) => {
  res.json({
    ok:true,
    youcam_configured:Boolean(KEY),
    service:"Genze AI"
  });
});

app.listen(PORT, () => {
  console.log(`Genze AI running on http://localhost:${PORT}`);
});

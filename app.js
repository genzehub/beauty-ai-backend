// GENZE AI frontend
const CONFIG = {
  ANALYSIS_ENDPOINT: "/api/skin-analysis",
  PRODUCT_ENDPOINT: "/api/match-products"
};

const $ = id => document.getElementById(id);
const cameraShell = $("cameraShell");
const video = $("cameraVideo");
const canvas = $("captureCanvas");
const preview = $("photoPreview");
const statusBox = $("analysisStatus");
const results = $("results");
const concernChips = $("concernChips");
const productResults = $("productResults");
let stream = null;
let requestSequence = 0;

function setStatus(text, show = true) {
  statusBox.textContent = text;
  statusBox.classList.toggle("hidden", !show);
}

function resetAnalysis() {
  requestSequence++;
  results.classList.add("hidden");
  concernChips.innerHTML = "";
  productResults.innerHTML = "";
  preview.classList.add("hidden");
  preview.removeAttribute("src");
  setStatus("", false);
}

function requireConsent() {
  if (!$("consentCheckbox").checked) {
    alert("Please tick the consent box before taking or uploading a photo.");
    return false;
  }
  return true;
}

async function openCamera() {
  if (!requireConsent()) return;
  resetAnalysis();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    cameraShell.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Camera permission was blocked or unavailable. Please allow camera access, or use Upload Photo.");
  }
}

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraShell.classList.add("hidden");
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) {
    alert("Camera is still starting. Try again in a moment.");
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w < 640 || h < 480) {
    alert("Camera resolution is too low. Use Upload Photo or a higher-resolution camera.");
    return;
  }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  canvas.toBlob(blob => {
    if (!blob) return;
    closeCamera();
    showPreviewAndAnalyze(blob);
  }, "image/jpeg", 0.95);
}

async function showPreviewAndAnalyze(blob) {
  resetAnalysis();
  const seq = requestSequence;
  preview.src = URL.createObjectURL(blob);
  preview.classList.remove("hidden");
  setStatus("Analyzing your photo…");

  let analysis = { concerns: [] };

  try {
    analysis = await analyzeSkin(blob);
    if (seq !== requestSequence) return;
    setStatus("Analysis complete. Finding your matches…");
    renderAnalysis(analysis);
  } catch (err) {
    console.error(err);
    if (seq !== requestSequence) return;
    setStatus("Photo analysis needs a clearer/closer face. Showing Genze Hub recommendations instead…");
    renderAnalysis(analysis);
  }

  try {
    const products = await matchProducts(analysis);
    if (seq !== requestSequence) return;
    renderProducts(products);
    results.classList.remove("hidden");
    setStatus("Your matches are ready.");
  } catch (err) {
    console.error(err);
    setStatus("Products could not be loaded. Check the Shopify connection on the server.");
  }
}

async function analyzeSkin(blob) {
  const fd = new FormData();
  fd.append("photo", blob, "capture.jpg");
  const r = await fetch(CONFIG.ANALYSIS_ENDPOINT, { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Analysis API error: ${r.status}`);
  return data;
}

async function matchProducts(analysis = {}) {
  const tone = $("toneInput")?.value?.trim() || "";
  const r = await fetch(CONFIG.PRODUCT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysis, tone })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Product matching API error: ${r.status}`);
  return data;
}

function normalizeConcerns(analysis) {
  const items = Array.isArray(analysis?.concerns) ? analysis.concerns : [];
  return items.map(x => typeof x === "string" ? x : x?.type).filter(Boolean);
}

function renderAnalysis(analysis) {
  const concerns = normalizeConcerns(analysis);
  concernChips.innerHTML = concerns.length
    ? concerns.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join("")
    : `<span class="chip">Recommendations ready</span>`;
}

function renderProducts(products) {
  const list = Array.isArray(products) ? products : products?.products || [];
  productResults.innerHTML = list.length ? list.map(p => `
    <article class="product">
      ${p.image ? `<img src="${safeUrl(p.image)}" alt="${escapeHtml(p.title || "Product")}" loading="lazy">` : ""}
      <h4>${escapeHtml(p.title || "Recommended product")}</h4>
      ${p.price ? `<p><strong>${escapeHtml(p.currency || "")} ${escapeHtml(p.price)}</strong></p>` : ""}
      <p>${escapeHtml(p.why || "Matched to your analysis")}</p>
      <a href="${safeUrl(p.url || "https://genzehub.co.in")}" target="_blank" rel="noreferrer">View product ↗</a>
    </article>`).join("")
    : `<p>No products were returned from Shopify.</p>`;
}

function escapeHtml(v = "") {
  return String(v).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function safeUrl(v) {
  try {
    const u = new URL(v, location.origin);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
}

$("openCameraBtn")?.addEventListener("click", openCamera);
$("closeCameraBtn")?.addEventListener("click", closeCamera);
$("captureBtn")?.addEventListener("click", capturePhoto);
$("uploadInput")?.addEventListener("change", e => {
  if (!requireConsent()) { e.target.value = ""; return; }
  const file = e.target.files?.[0];
  if (file) showPreviewAndAnalyze(file);
});

document.querySelectorAll("[data-tone]").forEach(btn => {
  btn.addEventListener("click", () => {
    $("toneInput").value = btn.dataset.tone;
  });
});

$("toneSend")?.addEventListener("click", async () => {
  const tone = $("toneInput").value.trim();
  if (!tone) return;
  $("assistantPrompt").textContent = `Searching matches for ${tone}…`;
  setStatus(`Searching matches for ${tone}…`);
  try {
    const products = await matchProducts({ concerns: [] });
    renderProducts(products);
    results.classList.remove("hidden");
    setStatus(`Matches for ${tone} are ready.`);
    $("assistantPrompt").textContent = `I found Genze Hub recommendations for ${tone}.`;
  } catch (err) {
    console.error(err);
    setStatus("Products could not be loaded. Check the Shopify connection.");
  }
});

window.addEventListener("beforeunload", closeCamera);

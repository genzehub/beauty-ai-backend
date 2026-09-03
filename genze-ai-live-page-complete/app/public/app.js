/* Genze AI — screenshot-matched UI + live camera + skin analysis */
let videoStream = null;
let currentRequestId = 0;
let isAnalyzing = false;
let activeController = null;

const byId = id => document.getElementById(id);
const videoElement = byId("cameraFeed");
const canvasElement = byId("overlayCanvas");
const cameraShell = byId("cameraShell");
const startCameraBtn = byId("startCameraBtn");
const capturePhotoBtn = byId("capturePhotoBtn");
const closeCameraBtn = byId("closeCameraBtn");
const photoInput = byId("photoInput");
const consentCheckbox = byId("consentCheckbox");
const statusMessage = byId("statusMessage");
const resultsContainer = byId("resultsContainer");

document.addEventListener("DOMContentLoaded", () => {
  startCameraBtn?.addEventListener("click", toggleCamera);
  if (capturePhotoBtn) {
    capturePhotoBtn.disabled = true;
    capturePhotoBtn.addEventListener("click", captureAndAnalyze);
  }
  closeCameraBtn?.addEventListener("click", stopCamera);
  photoInput?.addEventListener("change", handleFileUpload);

  document.querySelectorAll("[data-tone]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tone]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      byId("toneInput").value = btn.dataset.tone;
      byId("assistantPrompt").textContent = `Great. I’ll use ${btn.dataset.tone.toLowerCase()} as your selected skin tone.`;
    });
  });

  byId("toneSend")?.addEventListener("click", submitTone);
  byId("toneInput")?.addEventListener("keydown", e => { if (e.key === "Enter") submitTone(); });
  byId("voiceBtn")?.addEventListener("click", enableVoice);
  byId("micBtn")?.addEventListener("click", startSpeechInput);
  byId("generateDesc")?.addEventListener("click", generateDescription);
  byId("routineBtn")?.addEventListener("click", buildRoutine);
});

function submitTone(){
  const tone = byId("toneInput")?.value.trim();
  if (!tone) return;
  byId("assistantPrompt").textContent = `Thanks. I’ll use ${tone.toLowerCase()} as your selected skin tone for recommendations.`;
}

function enableVoice(){
  const prompt = byId("assistantPrompt")?.textContent || "Welcome to Genze Hub.";
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(prompt));
    byId("voiceBtn").textContent = "Voice enabled";
  }
}

function startSpeechInput(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice input is not available in this browser. You can type your skin tone instead.");
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    const text = e.results?.[0]?.[0]?.transcript || "";
    byId("toneInput").value = text;
    submitTone();
  };
  rec.onerror = () => alert("Voice input could not start. Please type your skin tone.");
  rec.start();
}

function generateDescription(){
  const name = byId("productName")?.value.trim() || "This K-beauty product";
  const benefit = byId("productBenefit")?.value.trim() || "support healthier-looking skin";
  byId("descriptionOutput").innerHTML =
    `<span class="output-star">✦</span><span><strong>${escapeHtml(name)}</strong> is designed to ${escapeHtml(benefit)} with an easy-to-understand K-beauty routine focus. Use consistently as directed and pair with daily SPF when appropriate.</span>`;
}

function buildRoutine(){
  const type = byId("skinType")?.value || "Combination";
  const goal = byId("goal")?.value || "Hydration";
  const season = byId("season")?.value || "Everyday";
  const box = byId("routineOutput");
  box.innerHTML = `<strong>${escapeHtml(type)} · ${escapeHtml(goal)} · ${escapeHtml(season)}</strong><br>
    AM: Gentle cleanser → hydrating/targeted serum → moisturizer → SPF.<br>
    PM: Cleanser → treatment for ${escapeHtml(goal.toLowerCase())} → barrier-supporting moisturizer.`;
  box.classList.remove("hidden");
}

async function toggleCamera() {
  if (videoStream) { stopCamera(); return; }
  if (!requireConsent()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    updateStatus("Live camera is not supported in this browser. Please upload a photo.", "error");
    return;
  }

  try {
    clearPreviousResults();
    updateStatus("Requesting camera access...", "info");
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    videoElement.srcObject = videoStream;
    await videoElement.play();
    cameraShell.classList.remove("hidden");
    startCameraBtn.textContent = "Stop Camera";
    capturePhotoBtn.disabled = false;
    updateStatus("Camera ready. Center your full face and tap the round capture button.", "success");
  } catch (err) {
    console.error(err);
    videoStream = null;
    updateStatus("Could not access camera. Allow camera permission, or use Upload Photo.", "error");
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  if (videoElement) videoElement.srcObject = null;
  cameraShell?.classList.add("hidden");
  if (startCameraBtn) startCameraBtn.textContent = "Open Phone Camera";
  if (capturePhotoBtn) capturePhotoBtn.disabled = true;
}

function requireConsent() {
  if (consentCheckbox && !consentCheckbox.checked) {
    updateStatus("Please accept the consent terms before proceeding.", "error");
    return false;
  }
  return true;
}

async function captureAndAnalyze() {
  if (isAnalyzing) return;
  if (!requireConsent()) return;
  if (!videoElement?.videoWidth || videoElement.readyState < 2) {
    updateStatus("Camera feed is not ready. Please try again.", "error");
    return;
  }

  const canvas = canvasElement || document.createElement("canvas");
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext("2d", {alpha:false});
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  canvas.toBlob(async blob => {
    if (!blob) return updateStatus("Failed to capture image.", "error");
    stopCamera();
    await processSkinAnalysis(new File([blob], `capture-${Date.now()}.jpg`, {type:"image/jpeg"}));
  }, "image/jpeg", .92);
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!requireConsent()) { event.target.value = ""; return; }
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || "")) {
    updateStatus("Please upload a JPG, PNG, or WEBP photo.", "error");
    event.target.value = "";
    return;
  }
  if (file.size > 9 * 1024 * 1024) {
    updateStatus("Photo is too large. Please use an image under 9 MB.", "error");
    event.target.value = "";
    return;
  }
  stopCamera();
  await processSkinAnalysis(file);
  event.target.value = "";
}

async function processSkinAnalysis(file) {
  const requestId = ++currentRequestId;
  isAnalyzing = true;
  if (activeController) activeController.abort();
  activeController = new AbortController();

  clearPreviousResults();
  updateStatus("Analyzing skin metrics... Please wait.", "info");

  try {
    const fd = new FormData();
    fd.append("photo", file, file.name || "capture.jpg");

    const analysisRes = await fetch("/api/skin-analysis", {
      method:"POST", body:fd, signal:activeController.signal
    });
    const analysis = await readJson(analysisRes);
    if (!analysisRes.ok) throw new Error(analysis.error || "Skin analysis request failed.");
    if (requestId !== currentRequestId) return;

    const matchRes = await fetch("/api/match-products", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({analysis}),
      signal:activeController.signal
    });
    const matches = await readJson(matchRes);
    if (!matchRes.ok) throw new Error(matches.error || "Product matching request failed.");
    if (requestId !== currentRequestId) return;

    renderResults(analysis, matches.products || []);
    updateStatus("Analysis complete!", "success");
  } catch (err) {
    if (err?.name !== "AbortError" && requestId === currentRequestId) {
      console.error(err);
      updateStatus(err.message || "An error occurred during skin analysis.", "error");
    }
  } finally {
    if (requestId === currentRequestId) {
      isAnalyzing = false;
      activeController = null;
    }
  }
}

async function readJson(response){ try{return await response.json()}catch{return {}} }

function clearPreviousResults(){
  if (!resultsContainer) return;
  resultsContainer.innerHTML = "";
  resultsContainer.classList.add("hidden");
}

function renderResults(analysis, products){
  if (!resultsContainer) return;
  const concerns = Array.isArray(analysis?.concerns) ? analysis.concerns : [];

  const summary = document.createElement("div");
  summary.className = "analysis-summary";
  summary.innerHTML = "<h3>Skin Concerns Detected</h3>";
  const list = document.createElement("ul");

  if (concerns.length) {
    concerns.forEach(c => {
      const li = document.createElement("li");
      const type = String(c?.type || "skin concern").replace(/_/g," ");
      const score = c?.ui_score ?? c?.raw_score ?? "N/A";
      li.textContent = `${type}: Score ${score}`;
      list.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = "No strong skin concerns were returned by the analysis.";
    list.appendChild(li);
  }
  summary.appendChild(list);
  resultsContainer.appendChild(summary);

  if (Array.isArray(products) && products.length) {
    const wrap = document.createElement("div");
    wrap.className = "product-recommendations";
    wrap.innerHTML = "<h3>Recommended Products</h3>";
    const grid = document.createElement("div");
    grid.className = "product-grid";

    products.forEach(p => {
      const card = document.createElement("div");
      card.className = "product-card";
      if (p?.image) {
        const img = document.createElement("img");
        img.src = safeUrl(p.image);
        img.alt = String(p.title || "Genze Hub product");
        img.loading = "lazy";
        card.appendChild(img);
      }
      const h4 = document.createElement("h4");
      h4.textContent = String(p?.title || "Recommended product");
      const why = document.createElement("p");
      why.textContent = String(p?.why || "Matched to your current skin analysis.");
      const a = document.createElement("a");
      a.className = "buy-btn";
      a.href = safeUrl(p?.url || "https://genzehub.co.in");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View Product";
      card.append(h4,why,a);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    resultsContainer.appendChild(wrap);
  } else {
    const p = document.createElement("p");
    p.textContent = "No strong catalog matches were found for this scan.";
    resultsContainer.appendChild(p);
  }
  resultsContainer.classList.remove("hidden");
}

function safeUrl(value){
  try{
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:","https:"].includes(url.protocol) ? url.href : "#";
  }catch{return "#"}
}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function updateStatus(text,type){
  if (!statusMessage) return;
  statusMessage.textContent = text;
  statusMessage.className = `analysis-status status-bar ${type || ""}`.trim();
  statusMessage.classList.toggle("hidden", !text);
}
window.addEventListener("beforeunload", stopCamera);

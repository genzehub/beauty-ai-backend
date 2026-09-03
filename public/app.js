// GENZE AI frontend
// IMPORTANT: never put a YouCam secret/API key in this browser file.
// Point ANALYSIS_ENDPOINT to your own secure serverless/backend route.
const CONFIG = {
  ANALYSIS_ENDPOINT: "/api/skin-analysis",
  PRODUCT_ENDPOINT: "/api/match-products"
};

const $ = (id) => document.getElementById(id);
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

function setStatus(text, show=true){
  statusBox.textContent = text;
  statusBox.classList.toggle("hidden", !show);
}
function resetAnalysis(){
  requestSequence += 1; // invalidates older in-flight responses
  results.classList.add("hidden");
  concernChips.innerHTML = "";
  productResults.innerHTML = "";
  preview.classList.add("hidden");
  preview.removeAttribute("src");
  setStatus("", false);
}
function requireConsent(){
  if(!$("consentCheckbox").checked){
    alert("Please tick the consent box before taking or uploading a photo.");
    return false;
  }
  return true;
}
async function openCamera(){
  if(!requireConsent()) return;
  resetAnalysis();
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: {ideal: 1920},
        height: {ideal: 1080}
      },
      audio:false
    });
    video.srcObject = stream;
    cameraShell.classList.remove("hidden");
  }catch(err){
    console.error(err);
    alert("Camera permission was blocked or unavailable. Please allow camera access, or use Upload Photo.");
  }
}
function closeCamera(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  video.srcObject = null;
  cameraShell.classList.add("hidden");
}
function capturePhoto(){
  if(!video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.translate(w,0);
  ctx.scale(-1,1);
  ctx.drawImage(video,0,0,w,h);
  canvas.toBlob(blob=>{
    if(!blob) return;
    closeCamera();
    showPreviewAndAnalyze(blob);
  },"image/jpeg",0.92);
}
function fileToBlob(file){ return file; }

async function showPreviewAndAnalyze(blob){
  resetAnalysis();
  const seq = requestSequence;
  preview.src = URL.createObjectURL(blob);
  preview.classList.remove("hidden");
  setStatus("Analyzing your photo…");
  try{
    const analysis = await analyzeSkin(blob);
    if(seq !== requestSequence) return;
    setStatus("Analysis complete.");
    renderAnalysis(analysis);
    const products = await matchProducts(analysis);
    if(seq !== requestSequence) return;
    renderProducts(products);
    results.classList.remove("hidden");
  }catch(err){
    console.error(err);
    setStatus("Analysis could not be completed. Check the secure API endpoint and try again.");
  }
}

async function analyzeSkin(blob){
  const fd = new FormData();
  fd.append("photo", blob, "capture.jpg");
  const r = await fetch(CONFIG.ANALYSIS_ENDPOINT,{method:"POST",body:fd});
  if(!r.ok) throw new Error("Analysis API error: "+r.status);
  return await r.json();
}

async function matchProducts(analysis){
  const r = await fetch(CONFIG.PRODUCT_ENDPOINT,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({analysis})
  });
  if(!r.ok) throw new Error("Product matching API error: "+r.status);
  return await r.json();
}
function normalizeConcerns(analysis){
  const items = Array.isArray(analysis?.concerns) ? analysis.concerns : [];
  return items.map(x => typeof x === "string" ? x : x?.type).filter(Boolean);
}
function renderAnalysis(analysis){
  const concerns = normalizeConcerns(analysis);
  concernChips.innerHTML = concerns.length
    ? concerns.map(c=>`<span class="chip">${escapeHtml(c)}</span>`).join("")
    : `<span class="chip">Analysis received</span>`;
}
function renderProducts(products){
  const list = Array.isArray(products) ? products : products?.products || [];
  productResults.innerHTML = list.length ? list.map(p=>`
    <article class="product">
      <h4>${escapeHtml(p.title || p.name || "Recommended product")}</h4>
      <p>${escapeHtml(p.why || p.reason || "Matched to your analysis")}</p>
      <a href="${safeUrl(p.url || "https://genzehub.co.in")}" target="_blank" rel="noreferrer">View product ↗</a>
    </article>`).join("") : `<p>No strong matches found. Try another clear, front-facing photo.</p>`;
}
function escapeHtml(v=""){
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function safeUrl(v){ try{ const u=new URL(v,location.origin); return ["http:","https:"].includes(u.protocol)?u.href:"#"; }catch{return "#";} }

$("openCameraBtn").addEventListener("click", openCamera);
$("closeCameraBtn").addEventListener("click", closeCamera);
$("captureBtn").addEventListener("click", capturePhoto);
$("uploadInput").addEventListener("change", e=>{
  if(!requireConsent()){ e.target.value=""; return; }
  const file=e.target.files?.[0];
  if(file) showPreviewAndAnalyze(fileToBlob(file));
});

document.querySelectorAll("[data-tone]").forEach(btn=>{
  btn.addEventListener("click",()=>{ $("toneInput").value=btn.dataset.tone; });
});
$("toneSend").addEventListener("click",()=>{
  const tone=$("toneInput").value.trim();
  if(tone) $("assistantPrompt").textContent=`Thanks. I’ll use ${tone} as your selected skin tone for recommendations.`;
});
$("voiceBtn").addEventListener("click",()=>alert("Voice UI is ready. Connect your preferred speech service or browser speech API."));
$("micBtn").addEventListener("click",()=>alert("Voice input placeholder."));

$("generateDesc").addEventListener("click",()=>{
  const n=$("productName").value.trim()||"This K-beauty product";
  const b=$("productBenefit").value.trim()||"support healthier-looking skin";
  $("descriptionOutput").textContent=`${n} is designed to ${b}. Add it to a simple Korean beauty routine for targeted care with an easy, customer-friendly experience.`;
});
$("routineBtn").addEventListener("click",()=>{
  const t=$("skinType").value,g=$("goal").value,s=$("season").value;
  $("routineOutput").classList.remove("hidden");
  $("routineOutput").innerHTML=`<strong>AM:</strong> Gentle cleanser → targeted toner/serum → moisturizer → SPF.<br><br><strong>PM:</strong> Cleanser → treatment for ${escapeHtml(g.toLowerCase())} → moisturizer.<br><br>Built for ${escapeHtml(t.toLowerCase())} skin · ${escapeHtml(s.toLowerCase())}.`;
});

window.addEventListener("beforeunload", closeCamera);

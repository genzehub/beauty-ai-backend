const $ = id => document.getElementById(id);

const state = {
  tone: "",
  category: "skincare",
  concern: "",
  products: [],
  lastAnalysis: null,
  livenessPassed: false
};

/* =====================================================
   OPTIONS
===================================================== */

const CONCERN_OPTIONS = {
  skincare: [
    ["Hydration", "hydration"],
    ["Acne & breakouts", "acne"],
    ["Pores & oil", "pores"],
    ["Brightening", "brightening"],
    ["Redness & calming", "redness"],
    ["Anti-aging", "anti-aging"],
    ["Sensitive skin", "sensitive"]
  ],

  makeup: [
    ["Foundation / Cushion", "foundation"],
    ["Concealer", "concealer"],
    ["Powder / Compact", "powder"],
    ["Lip color", "lip-color"]
  ],

  haircare: [
    ["Hair fall", "hair-fall"],
    ["Dandruff", "dandruff"],
    ["Dry hair", "dry"],
    ["Damaged hair", "damaged"],
    ["Oily scalp", "oily"]
  ],

  fragrance: [
    ["Fresh floral fragrance", "floral"],
    ["Fresh citrus / aquatic", "fresh"],
    ["Warm vanilla fragrance", "vanilla"],
    ["EDP / EDT longevity", "longlasting"]
  ]
};

/* =====================================================
   HELPERS
===================================================== */

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[c]
  );
}

function safeUrl(value) {
  try {
    const url = new URL(value, location.origin);

    if (["http:", "https:"].includes(url.protocol)) {
      return url.href;
    }

    return "#";
  } catch {
    return "#";
  }
}

function setCameraStatus(text, type = "") {
  const box = $("cameraStatus");
  if (!box) return;

  box.classList.remove("hidden");
  box.textContent = text;
  box.dataset.type = type;
}

function requireConsent() {
  const checkbox = $("consentCheckbox");
  if (checkbox && !checkbox.checked) {
    alert("Please tick the consent box first.");
    return false;
  }
  return true;
}

/* =====================================================
   CHAT
===================================================== */

function assistantMessage(text) {
  const chat = $("chat");
  if (!chat) return;

  const wrapper = document.createElement("div");
  wrapper.className = "assistant-message";
  wrapper.innerHTML = `
    <span class="avatar">G</span>
    <div class="bubble assistant">
      ${escapeHtml(text)}
    </div>
  `;

  chat.appendChild(wrapper);
  wrapper.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function userMessage(text) {
  const chat = $("chat");
  if (!chat) return;

  const wrapper = document.createElement("div");
  wrapper.className = "user-message";
  wrapper.innerHTML = `
    <div class="bubble user">
      ${escapeHtml(text)}
    </div>
  `;

  chat.appendChild(wrapper);
}

/* =====================================================
   STATUS
===================================================== */

function updateStatus() {
  const parts = [];

  if (state.tone) {
    parts.push(`Skin tone: ${state.tone}`);
  }

  if (state.category) {
    parts.push(
      state.category.charAt(0).toUpperCase() +
        state.category.slice(1)
    );
  }

  if (state.concern) {
    parts.push(
      state.concern.replaceAll("-", " ")
    );
  }

  const consultantStatus = $("consultantStatus");
  if (consultantStatus) {
    consultantStatus.textContent =
      parts.join(" · ") ||
      "Choose your skin tone to begin";
  }
}

/* =====================================================
   CATEGORY / CONCERN
===================================================== */

function renderConcernOptions() {
  const select = $("concernSelect");
  const quick = $("quickConcerns");

  if (!select || !quick) return;

  const options = CONCERN_OPTIONS[state.category] || [];

  select.innerHTML = `
    <option value="">
      See all beauty concerns
    </option>
  `;

  quick.innerHTML = "";

  for (const [label, value] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.concern = value;
    button.textContent = label;

    button.addEventListener("click", () => {
      selectConcern(value, label);
    });

    quick.appendChild(button);
  }
}

function selectCategory(category) {
  state.category = category;
  state.concern = "";

  document
    .querySelectorAll("[data-category]")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.category === category
      );
    });

  renderConcernOptions();
  updateStatus();

  assistantMessage(
    `Choose your main ${category} concern and I’ll find suitable Genze Hub products.`
  );
}

async function selectConcern(concern, label) {
  state.concern = concern;

  const select = $("concernSelect");
  if (select) select.value = concern;

  userMessage(label);
  updateStatus();

  assistantMessage(
    `Searching Genze Hub for ${label.toLowerCase()} products.`
  );

  await loadProducts();
}

/* =====================================================
   TONE
===================================================== */

async function selectTone(tone) {
  state.tone = tone;

  document
    .querySelectorAll("[data-tone]")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.tone === tone
      );
    });

  userMessage(tone);
  updateStatus();

  assistantMessage(
    `I’ve saved ${tone.toLowerCase()} as your skin tone.`
  );

  await loadProducts();
}

/* =====================================================
   PRODUCT API
===================================================== */

async function requestProducts(query = "", analysis = null) {
  const response = await fetch("/api/match-products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tone: state.tone,
      category: state.category,
      concern: state.concern,
      query,
      analysis
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error || "Products could not be loaded"
    );
  }

  return data;
}

async function loadProducts(query = "", analysis = null) {
  const box = $("consultantProducts");
  if (!box) return;

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="loading">
      Finding the best Genze Hub products...
    </div>
  `;

  try {
    const data = await requestProducts(query, analysis);

    state.products = data.products || [];
    renderProducts(state.products);

    if (state.products.length) {
      assistantMessage(
        `I found ${state.products.length} matching Genze Hub products.`
      );
    } else {
      assistantMessage(
        "I couldn’t find a strong exact match. Try another concern."
      );
    }
  } catch (error) {
    console.error(error);
    box.innerHTML = `
      <div class="loading">
        Products could not be loaded.
      </div>
    `;
  }
}

function renderProducts(products) {
  const box = $("consultantProducts");
  if (!box) return;

  if (!products.length) {
    box.innerHTML = `
      <div class="loading">
        No matching products found.
      </div>
    `;
    return;
  }

  box.innerHTML = products
    .slice(0, 6)
    .map(
      product => `
      <article class="product-card">
        <div class="product-image">
          ${
            product.image
              ? `
              <img
                src="${safeUrl(product.image)}"
                alt="${escapeHtml(product.title)}"
                loading="lazy"
              >
            `
              : ""
          }
        </div>

        <div class="product-copy">
          <div class="product-meta">
            ${escapeHtml(product.vendor || "Genze Hub")}
            ${
              product.category
                ? ` · ${escapeHtml(product.category)}`
                : ""
            }
          </div>

          <h3>${escapeHtml(product.title)}</h3>

          ${
            product.price
              ? `
              <div class="product-price">
                ${escapeHtml(product.currency)}
                ${escapeHtml(product.price)}
              </div>
            `
              : ""
          }

          ${
            product.match_reason
              ? `
              <div class="product-match-reason">
                ${escapeHtml(product.match_reason)}
              </div>
            `
              : ""
          }

          <a
            href="${safeUrl(product.url)}"
            target="_blank"
            rel="noreferrer"
          >
            View product →
          </a>
        </div>
      </article>
    `
    )
    .join("");
}

/* =====================================================
   SEARCH
===================================================== */

async function submitSearch() {
  const input = $("searchInput");
  if (!input) return;

  const query = input.value.trim();
  if (!query) return;

  userMessage(query);
  assistantMessage(`Searching Genze Hub for “${query}”.`);

  await loadProducts(query);
}

/* =====================================================
   MEDIAPIPE
===================================================== */

let faceLandmarkerImage = null;
let faceLandmarkerVideo = null;
let mediaPipeReady = false;

async function initMediaPipe() {
  try {
    if (typeof FilesetResolver === "undefined" || typeof FaceLandmarker === "undefined") {
      console.warn("MediaPipe libraries missing from scope.");
      return;
    }

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    const modelPath =
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

    faceLandmarkerImage = await FaceLandmarker.createFromOptions(
      vision,
      {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: "IMAGE",
        numFaces: 1
      }
    );

    faceLandmarkerVideo = await FaceLandmarker.createFromOptions(
      vision,
      {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: "VIDEO",
        numFaces: 1
      }
    );

    mediaPipeReady = true;
    console.log("Genze MediaPipe ready");
  } catch (error) {
    console.error("MediaPipe initialization failed:", error);
    mediaPipeReady = false;
  }
}

/* =====================================================
   FACE QUALITY
===================================================== */

function calculateFaceBox(landmarks) {
  const xs = landmarks.map(p => p.x);
  const ys = landmarks.map(p => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

function getFaceQualityFromLandmarks(landmarks) {
  if (!landmarks) {
    return {
      ok: false,
      confidence: 0,
      reason: "No face detected. Keep your full face inside the oval."
    };
  }

  const box = calculateFaceBox(landmarks);
  let confidence = 100;

  if (box.width < 0.22 || box.height < 0.28) {
    return {
      ok: false,
      confidence: 35,
      reason: "Move closer to the camera."
    };
  }

  if (box.width > 0.76 || box.height > 0.84) {
    return {
      ok: false,
      confidence: 40,
      reason: "Move slightly away from the camera."
    };
  }

  const offX = Math.abs(box.centerX - 0.5);
  const offY = Math.abs(box.centerY - 0.5);

  if (offX > 0.16 || offY > 0.18) {
    return {
      ok: false,
      confidence: 45,
      reason: "Center your face inside the oval."
    };
  }

  confidence -= offX * 100;
  confidence -= offY * 80;
  confidence = Math.max(0, Math.min(100, confidence));

  return {
    ok: true,
    confidence: Math.round(confidence),
    reason: "Face position looks good."
  };
}

async function checkImageFaceQuality(imageSource) {
  if (!mediaPipeReady || !faceLandmarkerImage) {
    return {
      ok: false,
      confidence: 0,
      reason: "Face scanner is still loading."
    };
  }

  const result = faceLandmarkerImage.detect(imageSource);
  const landmarks = result?.faceLandmarks?.[0];

  return getFaceQualityFromLandmarks(landmarks);
}

/* =====================================================
   IMAGE QUALITY
===================================================== */

function calculateImageQuality(canvas) {
  const width = Math.min(canvas.width, 320);
  const height = Math.max(
    1,
    Math.round(canvas.height * (width / canvas.width))
  );

  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;

  const sctx = sample.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, width, height);

  const data = sctx.getImageData(0, 0, width, height).data;

  let total = 0;
  let totalSq = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 16) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    total += gray;
    totalSq += gray * gray;
    count++;
  }

  const mean = total / count;
  const variance = totalSq / count - mean * mean;

  if (mean < 45) {
    return {
      ok: false,
      confidence: 35,
      reason: "Lighting is too dark. Move to brighter light."
    };
  }

  if (mean > 225) {
    return {
      ok: false,
      confidence: 40,
      reason: "Lighting is too bright. Avoid direct glare."
    };
  }

  if (variance < 180) {
    return {
      ok: false,
      confidence: 45,
      reason: "Image looks too soft or blurred. Hold the camera steady."
    };
  }

  return {
    ok: true,
    confidence: 90,
    brightness: Math.round(mean),
    contrast: Math.round(variance)
  };
}

/* =====================================================
   LIVENESS
===================================================== */

let livenessRunning = false;
let stream = null;

function getHeadPosition(landmarks) {
  if (!landmarks) return null;

  const box = calculateFaceBox(landmarks);
  const nose = landmarks[1] || landmarks[4] || landmarks[Math.floor(landmarks.length / 2)];

  return {
    centerX: box.centerX,
    noseOffset: nose ? (nose.x - box.centerX) / Math.max(box.width, 0.001) : 0
  };
}

async function runLivenessCheck() {
  if (livenessRunning || !mediaPipeReady || !faceLandmarkerVideo) {
    return false;
  }

  const video = $("cameraVideo");
  if (!video || video.readyState < 2) {
    return false;
  }

  livenessRunning = true;
  state.livenessPassed = false;

  setCameraStatus(
    "Liveness check: keep your face centered, then slowly turn your head slightly left or right.",
    "checking"
  );

  const start = performance.now();
  const samples = [];

  while (performance.now() - start < 5500) {
    try {
      const now = performance.now();
      const result = faceLandmarkerVideo.detectForVideo(video, now);
      const landmarks = result?.faceLandmarks?.[0];

      if (landmarks) {
        const quality = getFaceQualityFromLandmarks(landmarks);
        const head = getHeadPosition(landmarks);

        samples.push({ time: now, quality, head });
      }
    } catch (error) {
      console.error("Liveness frame:", error);
    }

    await new Promise(resolve => setTimeout(resolve, 180));
  }

  livenessRunning = false;
  const good = samples.filter(item => item.quality?.ok);

  if (good.length < 6) {
    setCameraStatus(
      "Liveness failed. Keep your full face visible and try again.",
      "error"
    );
    return false;
  }

  setCameraStatus(
    "Liveness passed. You can capture your photo now.",
    "success"
  );

  state.livenessPassed = true;
  return true;
}

async function openCamera() {
  if (!requireConsent()) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    const video = $("cameraVideo");
    if (!video) return;

    video.srcObject = stream;
    await video.play();

    const shell = $("cameraShell");
    if (shell) shell.classList.remove("hidden");

    state.livenessPassed = false;

    setCameraStatus(
      "Camera ready. Starting liveness check...",
      "checking"
    );

    setTimeout(runLivenessCheck, 700);
  } catch (error) {
    console.error(error);
    alert("Camera permission is unavailable. You can upload a photo instead.");
  }
}

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  const shell = $("cameraShell");
  if (shell) shell.classList.add("hidden");
}

/* =====================================================
   CAPTURE PROCESSOR
===================================================== */

async function processCapturedCanvas(canvas) {
  const imageQuality = calculateImageQuality(canvas);

  if (!imageQuality.ok) {
    setCameraStatus(imageQuality.reason, "error");
    return;
  }

  const faceQuality = await checkImageFaceQuality(canvas);

  if (!faceQuality.ok) {
    setCameraStatus(faceQuality.reason, "error");
    return;
  }

  if (!state.livenessPassed) {
    setCameraStatus(
      "Liveness has not passed yet. Open the camera and complete the movement check.",
      "error"
    );
    return;
  }

  setCameraStatus(
    `Face quality passed (${faceQuality.confidence}%). Preparing analysis...`,
    "success"
  );

  canvas.toBlob(
    async blob => {
      if (!blob) return;

      const previewUrl = URL.createObjectURL(blob);
      const preview = $("photoPreview");
      if (preview) {
        preview.src = previewUrl;
        preview.classList.remove("hidden");
      }

      closeCamera();

      await analyzePhoto(blob, {
        face_quality: faceQuality.confidence,
        image_quality: imageQuality.confidence,
        liveness: true
      });
    },
    "image/jpeg",
    0.94
  );
}

/* =====================================================
   SKIN ANALYSIS
===================================================== */

async function analyzePhoto(blob, clientQuality = {}) {
  const form = new FormData();
  form.append("photo", blob, "capture.jpg");
  form.append("client_quality", JSON.stringify(clientQuality));

  setCameraStatus("Analyzing your skin...", "checking");

  try {
    const response = await fetch("/api/skin-analysis", {
      method: "POST",
      body: form
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || "Skin analysis failed");
    }

    state.lastAnalysis = data;
    renderSkinAnalysis(data);

    const source = data.source || "Genze Skin AI";
    const confidence = Number(data.confidence || 0);

    setCameraStatus(
      `${source} complete · confidence ${confidence}%`,
      "success"
    );

    state.category = "skincare";

    if (data.primary_concern) {
      state.concern = data.primary_concern;
    }

    await loadProducts("", data);
  } catch (error) {
    console.error(error);
    setCameraStatus(error.message, "error");
  }
}

function renderSkinAnalysis(data) {
  const resultsBox = $("cameraResults");
  if (!resultsBox) return;

  const scores = Array.isArray(data.scores) ? data.scores : [];
  resultsBox.classList.remove("hidden");

  const header = `
    <div class="skin-result-summary">
      <strong>${escapeHtml(data.source || "Genze Skin AI")}</strong>
      <span>Confidence: ${escapeHtml(data.confidence ?? "-")}%</span>
    </div>
  `;

  const results = scores
    .slice(0, 10)
    .map(
      item => `
      <div class="skin-result">
        <strong>
          ${escapeHtml(String(item.type || "").replaceAll("_", " "))}
        </strong>
        <span>${escapeHtml(item.score ?? "-")}</span>
      </div>
    `
    )
    .join("");

  resultsBox.innerHTML = header + results;
}

/* =====================================================
   EVENT LISTENERS INITIALIZATION
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-tone]").forEach(button => {
    button.addEventListener("click", () => {
      selectTone(button.dataset.tone);
    });
  });

  document.querySelectorAll("[data-category]").forEach(button => {
    button.addEventListener("click", () => {
      selectCategory(button.dataset.category);
    });
  });

  const concernSelect = $("concernSelect");
  if (concernSelect) {
    concernSelect.addEventListener("change", event => {
      const value = event.target.value;
      if (!value) return;

      const option = event.target.selectedOptions?.[0];
      selectConcern(value, option?.textContent || value);
    });
  }

  const searchBtn = $("searchBtn");
  if (searchBtn) searchBtn.addEventListener("click", submitSearch);

  const searchInput = $("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") submitSearch();
    });
  }

  const voiceBtn = $("voiceBtn");
  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      if (!("speechSynthesis" in window)) {
        alert("Voice output is not supported in this browser.");
        return;
      }
      const text = "Welcome to Genze Hub. Choose your skin tone, beauty category, and main concern.";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    });
  }

  const micBtn = $("micBtn");
  if (micBtn) {
    micBtn.addEventListener("click", () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert("Voice input is not supported in this browser.");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;

      recognition.onresult = event => {
        const transcript = event.results[0][0].transcript;
        const input = $("searchInput");
        if (input) input.value = transcript;
        submitSearch();
      };

      recognition.start();
    });
  }

  const openCameraBtn = $("openCameraBtn");
  if (openCameraBtn) openCameraBtn.addEventListener("click", openCamera);

  const closeCameraBtn = $("closeCameraBtn");
  if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);

  const captureBtn = $("captureBtn");
  if (captureBtn) {
    captureBtn.addEventListener("click", async () => {
      const video = $("cameraVideo");
      if (!video) return;

      if (!state.livenessPassed) {
        setCameraStatus("Complete the liveness movement first.", "error");
        return;
      }

      const canvas = $("captureCanvas");
      if (!canvas) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d");
      context.save();
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      context.restore();

      await processCapturedCanvas(canvas);
    });
  }

  const uploadInput = $("uploadInput");
  if (uploadInput) {
    uploadInput.addEventListener("change", async event => {
      if (!requireConsent()) {
        event.target.value = "";
        return;
      }

      const file = event.target.files?.[0];
      if (!file) return;

      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = async () => {
        const canvas = $("captureCanvas");
        if (!canvas) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const imageQuality = calculateImageQuality(canvas);

        if (!imageQuality.ok) {
          setCameraStatus(imageQuality.reason, "error");
          URL.revokeObjectURL(url);
          return;
        }

        const faceQuality = await checkImageFaceQuality(img);

        if (!faceQuality.ok) {
          setCameraStatus(faceQuality.reason, "error");
          URL.revokeObjectURL(url);
          return;
        }

        const preview = $("photoPreview");
        if (preview) {
          preview.src = url;
          preview.classList.remove("hidden");
        }

        await analyzePhoto(file, {
          face_quality: faceQuality.confidence,
          image_quality: imageQuality.confidence,
          liveness: false,
          uploaded_photo: true
        });
      };

      img.onerror = () => {
        setCameraStatus("Photo could not be opened.", "error");
      };

      img.src = url;
    });
  }

  /* Initialization calls */
  renderConcernOptions();
  updateStatus();
  initMediaPipe();
});

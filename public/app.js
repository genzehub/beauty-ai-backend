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
let lastAnalysis = { concerns: [] };


/* =========================
   HELPERS
========================= */

function setStatus(text, show = true) {
  if (!statusBox) return;

  statusBox.textContent = text;
  statusBox.classList.toggle("hidden", !show);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
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

function selectedTone() {
  return $("toneInput")?.value?.trim() || "";
}

function selectedUndertone() {
  return $("undertoneInput")?.value?.trim() || "";
}


/* =========================
   RESET
========================= */

function resetAnalysis() {
  requestSequence++;

  lastAnalysis = {
    concerns: []
  };

  results?.classList.add("hidden");

  if (concernChips) {
    concernChips.innerHTML = "";
  }

  if (productResults) {
    productResults.innerHTML = "";
  }

  preview?.classList.add("hidden");
  preview?.removeAttribute("src");

  setStatus("", false);
}


/* =========================
   CONSENT
========================= */

function requireConsent() {
  const checkbox = $("consentCheckbox");

  if (checkbox && !checkbox.checked) {
    alert(
      "Please tick the consent box before taking or uploading a photo."
    );

    return false;
  }

  return true;
}


/* =========================
   CAMERA
========================= */

async function openCamera() {
  if (!requireConsent()) {
    return;
  }

  resetAnalysis();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",

        width: {
          ideal: 1920,
          min: 1280
        },

        height: {
          ideal: 1080,
          min: 720
        }
      },

      audio: false
    });

    video.srcObject = stream;

    await video.play();

    cameraShell?.classList.remove("hidden");

  } catch (error) {
    console.error(error);

    alert(
      "Camera permission was blocked or unavailable. Please allow camera access or use Upload Photo."
    );
  }
}

function closeCamera() {
  if (stream) {
    stream
      .getTracks()
      .forEach(track => track.stop());

    stream = null;
  }

  if (video) {
    video.srcObject = null;
  }

  cameraShell?.classList.add("hidden");
}


/* =========================
   CAPTURE PHOTO
========================= */

function capturePhoto() {
  if (!video?.videoWidth || !video?.videoHeight) {
    alert("Camera is still starting.");

    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (width < 640 || height < 480) {
    alert(
      "Camera resolution is too low. Use a clearer photo."
    );

    return;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.save();

  ctx.translate(width, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(
    video,
    0,
    0,
    width,
    height
  );

  ctx.restore();

  canvas.toBlob(
    blob => {
      if (!blob) {
        return;
      }

      closeCamera();

      showPreviewAndAnalyze(blob);
    },

    "image/jpeg",
    0.95
  );
}


/* =========================
   ANALYZE PHOTO
========================= */

async function showPreviewAndAnalyze(blob) {
  resetAnalysis();

  const sequence = requestSequence;

  if (preview) {
    preview.src = URL.createObjectURL(blob);
    preview.classList.remove("hidden");
  }

  setStatus("Analyzing your photo...");

  let analysis = {
    concerns: []
  };

  try {
    analysis = await analyzeSkin(blob);

    if (sequence !== requestSequence) {
      return;
    }

    lastAnalysis = analysis;

    renderAnalysis(analysis);

    setStatus(
      "Analysis complete. Finding skincare matches..."
    );

  } catch (error) {
    console.error(error);

    if (sequence !== requestSequence) {
      return;
    }

    setStatus(
      "Skin analysis needs a clearer, closer face."
    );

    renderAnalysis({
      concerns: []
    });
  }

  try {
    const products = await matchProducts({
      analysis,
      mode: "skincare"
    });

    if (sequence !== requestSequence) {
      return;
    }

    renderProducts(products);

    results?.classList.remove("hidden");

    setStatus(
      "Your skincare matches are ready."
    );

  } catch (error) {
    console.error(error);

    setStatus(
      "Products could not be loaded."
    );
  }
}


/* =========================
   ANALYSIS API
========================= */

async function analyzeSkin(blob) {
  const form = new FormData();

  form.append(
    "photo",
    blob,
    "capture.jpg"
  );

  const response = await fetch(
    CONFIG.ANALYSIS_ENDPOINT,
    {
      method: "POST",
      body: form
    }
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `Analysis API error: ${response.status}`
    );
  }

  return data;
}


/* =========================
   PRODUCT MATCH API
========================= */

async function matchProducts({
  analysis = {},
  mode = "skincare"
} = {}) {
  const response = await fetch(
    CONFIG.PRODUCT_ENDPOINT,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        analysis,
        mode,
        tone: selectedTone(),
        undertone: selectedUndertone()
      })
    }
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `Product matching API error: ${response.status}`
    );
  }

  return data;
}


/* =========================
   DISPLAY ANALYSIS
========================= */

function renderAnalysis(analysis) {
  if (!concernChips) {
    return;
  }

  const tone = selectedTone();
  const undertone = selectedUndertone();

  const concerns = Array.isArray(
    analysis?.concerns
  )
    ? analysis.concerns
    : [];

  let html = "";

  if (tone) {
    html += `
      <span class="chip">
        Tone: ${escapeHtml(tone)}
      </span>
    `;
  }

  if (undertone) {
    html += `
      <span class="chip">
        Undertone: ${escapeHtml(undertone)}
      </span>
    `;
  }

  concerns.forEach(concern => {
    const name =
      typeof concern === "string"
        ? concern
        : concern?.type;

    if (!name) {
      return;
    }

    html += `
      <span class="chip">
        ${escapeHtml(
          name.replaceAll("_", " ")
        )}
      </span>
    `;
  });

  if (!html) {
    html = `
      <span class="chip">
        Analysis ready
      </span>
    `;
  }

  concernChips.innerHTML = html;
}


/* =========================
   DISPLAY PRODUCTS
========================= */

function renderProducts(response) {
  if (!productResults) {
    return;
  }

  const list = Array.isArray(response)
    ? response
    : response?.products || [];

  if (!list.length) {
    productResults.innerHTML = `
      <p>
        No strong matching products found.
      </p>
    `;

    return;
  }

  productResults.innerHTML = list
    .map(
      product => `
        <article class="product">

          ${
            product.image
              ? `
                <img
                  src="${safeUrl(product.image)}"
                  alt="${escapeHtml(
                    product.title || "Product"
                  )}"
                  loading="lazy"
                >
              `
              : ""
          }

          <h4>
            ${escapeHtml(
              product.title ||
              "Recommended product"
            )}
          </h4>

          ${
            product.price
              ? `
                <p>
                  <strong>
                    ${escapeHtml(
                      product.currency || ""
                    )}
                    ${escapeHtml(
                      product.price
                    )}
                  </strong>
                </p>
              `
              : ""
          }

          <p>
            ${escapeHtml(
              product.why ||
              "Matched product"
            )}
          </p>

          <a
            href="${safeUrl(
              product.url ||
              "https://genzehub.co.in"
            )}"
            target="_blank"
            rel="noreferrer"
          >
            View Product →
          </a>

        </article>
      `
    )
    .join("");
}


/* =========================
   CAMERA EVENTS
========================= */

$("openCameraBtn")
  ?.addEventListener(
    "click",
    openCamera
  );

$("closeCameraBtn")
  ?.addEventListener(
    "click",
    closeCamera
  );

$("captureBtn")
  ?.addEventListener(
    "click",
    capturePhoto
  );

$("uploadInput")
  ?.addEventListener(
    "change",
    event => {
      if (!requireConsent()) {
        event.target.value = "";

        return;
      }

      const file =
        event.target.files?.[0];

      if (file) {
        showPreviewAndAnalyze(file);
      }
    }
  );


/* =========================
   TONE BUTTONS
========================= */

document
  .querySelectorAll("[data-tone]")
  .forEach(button => {
    button.addEventListener(
      "click",
      () => {
        if ($("toneInput")) {
          $("toneInput").value =
            button.dataset.tone || "";
        }
      }
    );
  });


/* =========================
   UNDERTONE BUTTONS
========================= */

document
  .querySelectorAll("[data-undertone]")
  .forEach(button => {
    button.addEventListener(
      "click",
      () => {
        if ($("undertoneInput")) {
          $("undertoneInput").value =
            button.dataset.undertone || "";
        }
      }
    );
  });


/* =========================
   TONE SEND = MAKEUP MATCH
========================= */

$("toneSend")
  ?.addEventListener(
    "click",

    async () => {
      const tone = selectedTone();

      if (!tone) {
        setStatus(
          "Please choose your skin tone."
        );

        return;
      }

      if ($("assistantPrompt")) {
        $("assistantPrompt").textContent =
          `Searching complexion matches for ${tone}...`;
      }

      setStatus(
        `Searching matches for ${tone}...`
      );

      try {
        const products =
          await matchProducts({
            analysis: lastAnalysis,
            mode: "makeup"
          });

        renderAnalysis(lastAnalysis);

        renderProducts(products);

        results?.classList.remove("hidden");

        setStatus(
          `Matches for ${tone} are ready.`
        );

        if ($("assistantPrompt")) {
          $("assistantPrompt").textContent =
            `I found complexion products matched for ${tone}.`;
        }

      } catch (error) {
        console.error(error);

        setStatus(
          "Matching products could not be loaded."
        );
      }
    }
  );


window.addEventListener(
  "beforeunload",
  closeCamera
);

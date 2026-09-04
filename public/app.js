const $ =
  id =>
    document.getElementById(id);


const state = {
  tone: "",
  category: "skincare",
  concern: "",
  products: []
};


/* =====================================================
   CONCERNS
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
   HTML SAFETY
===================================================== */

function escapeHtml(value = "") {
  return String(value)
    .replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
    );
}


function safeUrl(value) {
  try {
    const url =
      new URL(
        value,
        location.origin
      );

    if (
      ["http:", "https:"]
        .includes(url.protocol)
    ) {
      return url.href;
    }

    return "#";
  } catch {
    return "#";
  }
}


/* =====================================================
   CHAT
===================================================== */

function assistantMessage(text) {
  const chat = $("chat");

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "assistant-message";

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

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "user-message";

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
    parts.push(
      `Skin tone: ${state.tone}`
    );
  }

  if (state.category) {
    parts.push(
      state.category
        .charAt(0)
        .toUpperCase() +
      state.category.slice(1)
    );
  }

  if (state.concern) {
    parts.push(
      state.concern
        .replaceAll("-", " ")
    );
  }

  $("consultantStatus")
    .textContent =
      parts.join(" · ") ||
      "Choose your skin tone to begin";
}


/* =====================================================
   CATEGORY UI
===================================================== */

function renderConcernOptions() {
  const select =
    $("concernSelect");

  const quick =
    $("quickConcerns");

  const options =
    CONCERN_OPTIONS[
      state.category
    ] || [];

  select.innerHTML = `
    <option value="">
      See all beauty concerns
    </option>
  `;

  quick.innerHTML = "";

  for (
    const [label, value]
    of options
  ) {

    const option =
      document.createElement(
        "option"
      );

    option.value =
      value;

    option.textContent =
      label;

    select.appendChild(
      option
    );


    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.dataset.concern =
      value;

    button.textContent =
      label;

    button.addEventListener(
      "click",
      () => {
        selectConcern(
          value,
          label
        );
      }
    );

    quick.appendChild(
      button
    );
  }
}


function selectCategory(category) {
  state.category =
    category;

  state.concern = "";

  document
    .querySelectorAll(
      "[data-category]"
    )
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.category ===
        category
      );
    });

  renderConcernOptions();
  updateStatus();

  assistantMessage(
    `Okay. Choose your main ${category} concern and I’ll find suitable Genze Hub products.`
  );
}


/* =====================================================
   CONCERN
===================================================== */

async function selectConcern(
  concern,
  label
) {
  state.concern =
    concern;

  $("concernSelect").value =
    concern;

  userMessage(label);

  updateStatus();

  assistantMessage(
    `Searching Genze Hub for ${label.toLowerCase()} products that fit your choices.`
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
    `Thank you. I’ve saved ${tone.toLowerCase()} as your skin tone. I’m finding matching products for you now.`
  );

  await loadProducts();
}


/* =====================================================
   API
===================================================== */

async function requestProducts(
  query = ""
) {
  const response =
    await fetch(
      "/api/match-products",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            tone:
              state.tone,

            category:
              state.category,

            concern:
              state.concern,

            query
          })
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
      "Products could not be loaded"
    );
  }

  return data;
}


/* =====================================================
   PRODUCTS
===================================================== */

async function loadProducts(
  query = ""
) {
  const box =
    $("consultantProducts");

  box.classList.remove(
    "hidden"
  );

  box.innerHTML = `
    <div class="loading">
      Finding the best Genze Hub products...
    </div>
  `;


  try {

    const data =
      await requestProducts(
        query
      );

    state.products =
      data.products || [];

    renderProducts(
      state.products
    );


    if (
      state.products.length
    ) {
      assistantMessage(
        `I found ${state.products.length} matching Genze Hub choices below.`
      );
    } else {
      assistantMessage(
        "I couldn’t find a strong exact match. Try another concern or search term."
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
  const box =
    $("consultantProducts");

  if (!products.length) {
    box.innerHTML = `
      <div class="loading">
        No matching products found.
      </div>
    `;

    return;
  }


  box.innerHTML =
    products
      .slice(0, 6)
      .map(product => `

        <article class="product-card">

          <div class="product-image">

            ${
              product.image
                ? `
                  <img
                    src="${safeUrl(
                      product.image
                    )}"
                    alt="${escapeHtml(
                      product.title
                    )}"
                    loading="lazy"
                  >
                `
                : ""
            }

          </div>


          <div class="product-copy">

            <div class="product-meta">
              ${escapeHtml(
                product.vendor ||
                "Genze Hub"
              )}

              ${
                product.category
                  ? ` · ${escapeHtml(
                      product.category
                    )}`
                  : ""
              }
            </div>


            <h3>
              ${escapeHtml(
                product.title
              )}
            </h3>


            ${
              product.price
                ? `
                  <div class="product-price">
                    ${escapeHtml(
                      product.currency
                    )}
                    ${escapeHtml(
                      product.price
                    )}
                  </div>
                `
                : ""
            }


            <a
              href="${safeUrl(
                product.url
              )}"
              target="_blank"
              rel="noreferrer"
            >
              View product →
            </a>

          </div>

        </article>

      `)
      .join("");
}


/* =====================================================
   TONE BUTTONS
===================================================== */

document
  .querySelectorAll(
    "[data-tone]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {
        selectTone(
          button.dataset.tone
        );
      }
    );

  });


/* =====================================================
   CATEGORY BUTTONS
===================================================== */

document
  .querySelectorAll(
    "[data-category]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {
        selectCategory(
          button.dataset.category
        );
      }
    );

  });


/* =====================================================
   CONCERN SELECT
===================================================== */

$("concernSelect")
  .addEventListener(
    "change",
    event => {

      const value =
        event.target.value;

      if (!value) {
        return;
      }

      const option =
        event.target
          .selectedOptions?.[0];

      selectConcern(
        value,
        option?.textContent ||
        value
      );
    }
  );


/* =====================================================
   SEARCH
===================================================== */

async function submitSearch() {
  const query =
    $("searchInput")
      .value
      .trim();

  if (!query) {
    return;
  }

  userMessage(query);

  assistantMessage(
    `Searching Genze Hub for “${query}”.`
  );

  await loadProducts(query);
}


$("searchBtn")
  .addEventListener(
    "click",
    submitSearch
  );


$("searchInput")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {
        submitSearch();
      }
    }
  );


/* =====================================================
   VOICE OUTPUT
===================================================== */

$("voiceBtn")
  .addEventListener(
    "click",
    () => {

      if (
        !("speechSynthesis" in window)
      ) {
        alert(
          "Voice output is not supported in this browser."
        );

        return;
      }

      const text =
        "Welcome to Genze Hub. Choose your skin tone, beauty category, and main concern.";

      window
        .speechSynthesis
        .cancel();

      window
        .speechSynthesis
        .speak(
          new SpeechSynthesisUtterance(
            text
          )
        );
    }
  );


/* =====================================================
   VOICE INPUT
===================================================== */

$("micBtn")
  .addEventListener(
    "click",
    () => {

      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert(
          "Voice input is not supported in this browser."
        );

        return;
      }

      const recognition =
        new SpeechRecognition();

      recognition.lang =
        "en-US";

      recognition.interimResults =
        false;

      recognition.onresult =
        event => {

          const transcript =
            event.results[0][0]
              .transcript;

          $("searchInput").value =
            transcript;

          submitSearch();
        };

      recognition.start();
    }
  );


/* =====================================================
   CAMERA
===================================================== */

let stream = null;


function requireConsent() {
  if (
    !$("consentCheckbox").checked
  ) {
    alert(
      "Please tick the consent box first."
    );

    return false;
  }

  return true;
}


async function openCamera() {
  if (!requireConsent()) {
    return;
  }

  try {

    stream =
      await navigator
        .mediaDevices
        .getUserMedia({
          video: {
            facingMode:
              "user",

            width: {
              ideal: 1920
            },

            height: {
              ideal: 1080
            }
          },

          audio:
            false
        });


    $("cameraVideo")
      .srcObject =
      stream;

    await $("cameraVideo")
      .play();

    $("cameraShell")
      .classList
      .remove(
        "hidden"
      );

  } catch (error) {

    console.error(error);

    alert(
      "Camera permission is unavailable. You can upload a photo instead."
    );
  }
}


function closeCamera() {
  if (stream) {

    stream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    stream = null;
  }

  $("cameraShell")
    .classList
    .add(
      "hidden"
    );
}


async function analyzePhoto(blob) {
  const form =
    new FormData();

  form.append(
    "photo",
    blob,
    "capture.jpg"
  );

  $("cameraStatus")
    .classList
    .remove(
      "hidden"
    );

  $("cameraStatus")
    .textContent =
    "Analyzing your skin...";


  try {

    const response =
      await fetch(
        "/api/skin-analysis",
        {
          method:
            "POST",

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
        "Skin analysis failed"
      );
    }


    $("cameraStatus")
      .textContent =
      "Skin analysis complete.";


    const scores =
      data.scores || [];


    $("cameraResults")
      .classList
      .remove(
        "hidden"
      );


    $("cameraResults")
      .innerHTML =
      scores
        .slice(0, 8)
        .map(item => `
          <div class="skin-result">
            <strong>
              ${escapeHtml(
                item.type
                  .replaceAll(
                    "_",
                    " "
                  )
              )}
            </strong>

            <span>
              ${escapeHtml(
                item.score ?? "-"
              )}
            </span>
          </div>
        `)
        .join("");


  } catch (error) {

    console.error(error);

    $("cameraStatus")
      .textContent =
      error.message;
  }
}


$("openCameraBtn")
  .addEventListener(
    "click",
    openCamera
  );


$("closeCameraBtn")
  .addEventListener(
    "click",
    closeCamera
  );


$("captureBtn")
  .addEventListener(
    "click",
    () => {

      const video =
        $("cameraVideo");

      const canvas =
        $("captureCanvas");

      canvas.width =
        video.videoWidth;

      canvas.height =
        video.videoHeight;


      const context =
        canvas.getContext("2d");


      context.translate(
        canvas.width,
        0
      );

      context.scale(
        -1,
        1
      );

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );


      canvas.toBlob(
        blob => {

          closeCamera();

          if (!blob) {
            return;
          }

          $("photoPreview").src =
            URL.createObjectURL(
              blob
            );

          $("photoPreview")
            .classList
            .remove(
              "hidden"
            );

          analyzePhoto(blob);
        },

        "image/jpeg",
        0.94
      );
    }
  );


$("uploadInput")
  .addEventListener(
    "change",
    event => {

      if (!requireConsent()) {
        event.target.value = "";
        return;
      }

      const file =
        event.target
          .files?.[0];

      if (!file) {
        return;
      }


      $("photoPreview").src =
        URL.createObjectURL(
          file
        );

      $("photoPreview")
        .classList
        .remove(
          "hidden"
        );

      analyzePhoto(file);
    }
  );


/* =====================================================
   INITIAL
===================================================== */

renderConcernOptions();
updateStatus();

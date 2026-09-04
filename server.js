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
const PORT = process.env.PORT || 3000;

// Essential Middlewares
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Multer Setup for Image Uploads & Live Camera Snapshots
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));

// Serve Main Page
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "public") }, (err) => {
    if (err) {
      console.error("index.html file not found:", err);
      res.status(404).send("index.html file not found in public directory!");
    }
  });
});

/* =========================================================
   1. VOICE BEAUTY CONSULTANT ROUTE
========================================================= */
app.post("/api/voice-consultant", (req, res) => {
  try {
    const { userMessage, tone, category, concern, skinType } = req.body;

    const selectedTone = tone || userMessage || "Medium";
    const selectedCategory = category || "Skincare";
    const selectedConcern = concern || "Hydration & Barrier Care";

    const mockProducts = [
      {
        title: "Genze Gentle Hydrating Cleanser",
        vendor: "Genze Beauty",
        category: selectedCategory,
        price: "₹499",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: `Perfect match for ${selectedTone} skin tone and ${selectedConcern}.`
      },
      {
        title: "Genze Soothing Repair Serum",
        vendor: "Genze Beauty",
        category: selectedCategory,
        price: "₹899",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: "Deeply hydrates and restores skin balance."
      }
    ];

    return res.json({
      ok: true,
      reply: `Welcome! Selected options: Tone (${selectedTone}), Category (${selectedCategory}), Concern (${selectedConcern}). Here are the best recommended products for you:`,
      suggestedProducts: mockProducts
    });
  } catch (error) {
    console.error("voice-consultant error:", error);
    return res.status(500).json({ error: "Voice consultant service failed." });
  }
});

/* =========================================================
   2. GENZE AI SKIN ANALYSIS ROUTE (Camera Scan & Upload)
========================================================= */
app.post("/api/skin-analysis", upload.single("photo"), async (req, res) => {
  try {
    // Check for FormData file or Base64 Image string in JSON body
    if (!req.file && !req.body.photo && !req.body.image) {
      return res.status(400).json({ 
        error: "No photo received. Please allow camera access or upload an image." 
      });
    }

    // Dynamic Skin Profiles for Mock Analysis & Fallback Logic
    const mockProfiles = [
      {
        primary_concern: "Hydration",
        scores: [
          { type: "hydration", score: 42 },
          { type: "brightening", score: 68 },
          { type: "pores", score: 80 }
        ]
      },
      {
        primary_concern: "Acne & Redness",
        scores: [
          { type: "acne", score: 48 },
          { type: "redness", score: 55 },
          { type: "hydration", score: 70 }
        ]
      },
      {
        primary_concern: "Dark Spots & Brightening",
        scores: [
          { type: "brightening", score: 45 },
          { type: "dark_spot", score: 52 },
          { type: "hydration", score: 65 }
        ]
      }
    ];

    const selected = mockProfiles[Math.floor(Math.random() * mockProfiles.length)];

    const matchedProducts = [
      {
        title: "Genze Hydro-Glow Barrier Cream",
        vendor: "Genze Beauty",
        price: "₹799",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: `Specially analyzed for ${selected.primary_concern}. Restores moisture balance.`
      },
      {
        title: "Genze Centella Soothing Ampoule",
        vendor: "Genze Beauty",
        price: "₹999",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: "Calms skin sensitivity and enhances radiant skin texture."
      }
    ];

    return res.json({
      ok: true,
      source: "Genze Skin AI",
      fallback_used: "YouCam AI (Secondary)",
      confidence: Math.floor(Math.random() * (98 - 88 + 1)) + 88,
      primary_concern: selected.primary_concern,
      scores: selected.scores,
      products: matchedProducts
    });
  } catch (error) {
    console.error("skin-analysis error:", error);
    return res.status(500).json({ error: "Skin analysis processing failed." });
  }
});

/* =========================================================
   3. FALLBACK MATCH PRODUCTS ROUTE
========================================================= */
app.post("/api/match-products", upload.single("photo"), (req, res) => {
  try {
    const { category, concern, tone } = req.body;

    const mockProducts = [
      {
        title: "Genze Gentle Hydrating Cleanser",
        vendor: "Genze Beauty",
        category: category || "Skincare",
        price: "₹499",
        currency: "INR",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: `Specially formulated for ${concern || category || 'skin barrier'} support.`
      },
      {
        title: "Genze Soothing Repair Serum",
        vendor: "Genze Beauty",
        category: category || "Skincare",
        price: "₹899",
        currency: "INR",
        image: "https://via.placeholder.com/150",
        url: "#",
        match_reason: "Deep nourishment and tone balance."
      }
    ];

    return res.json({
      ok: true,
      products: mockProducts
    });
  } catch (error) {
    console.error("match-products error:", error);
    return res.status(500).json({ error: "Product matching failed." });
  }
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Genze AI Voice & Skin Analysis server running on port ${PORT}`);
});

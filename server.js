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

// Multer Setup for Image Uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: "3mb" }));

// Static Files & Root Route Setup
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   SKIN ANALYSIS ROUTE (DYNAMIC MOCK / GENZE ENGINE)
========================================================= */

app.post("/api/skin-analysis", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo received" });
    }

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(req.file.mimetype || "")) {
      return res.status(400).json({ error: "Please upload a JPG, PNG, or WEBP image" });
    }

    // Dynamic Mock Profiles for Frontend Testing
    const mockProfiles = [
      {
        primary_concern: "hydration",
        scores: [
          { type: "hydration", score: 38 },
          { type: "brightening", score: 65 },
          { type: "pores", score: 82 }
        ]
      },
      {
        primary_concern: "acne",
        scores: [
          { type: "acne", score: 45 },
          { type: "redness", score: 58 },
          { type: "hydration", score: 72 }
        ]
      },
      {
        primary_concern: "brightening",
        scores: [
          { type: "brightening", score: 40 },
          { type: "dark_spot", score: 50 },
          { type: "hydration", score: 68 }
        ]
      }
    ];

    const selected = mockProfiles[Math.floor(Math.random() * mockProfiles.length)];

    const mockAnalysisResult = {
      ok: true,
      source: "Genze Local Engine",
      confidence: Math.floor(Math.random() * (98 - 85 + 1)) + 85,
      primary_concern: selected.primary_concern,
      scores: selected.scores
    };

    return res.json(mockAnalysisResult);
  } catch (error) {
    console.error("skin-analysis error:", error);
    return res.status(500).json({ error: "Skin analysis failed" });
  }
});

/* =========================================================
   PRODUCT MATCHING ROUTE
========================================================= */

app.post("/api/match-products", (req, res) => {
  const { category, concern, query } = req.body;

  // Sample Products Mock Data
  const mockProducts = [
    {
      title: "Genze Gentle Hydrating Cleanser",
      vendor: "Genze Beauty",
      category: "Skincare",
      price: "₹499",
      currency: "",
      image: "https://via.placeholder.com/150",
      url: "#",
      match_reason: `Specially formulated for ${concern || category || 'skincare'} care.`
    },
    {
      title: "Genze Soothing Repair Serum",
      vendor: "Genze Beauty",
      category: "Skincare",
      price: "₹899",
      currency: "",
      image: "https://via.placeholder.com/150",
      url: "#",
      match_reason: "Deep nourishment and tone balance."
    }
  ];

  return res.json({
    ok: true,
    products: mockProducts
  });
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Genze AI running on port ${PORT}`);
});

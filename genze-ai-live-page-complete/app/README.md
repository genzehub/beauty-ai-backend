# Genze AI Full App

This is the rebuilt deployable Genze AI project.

## What is wired
- Mobile front camera
- Face positioning overlay and capture
- Consent before analysis
- Old customer result reset before every new scan
- Request sequence protection so an older response cannot overwrite a newer scan
- Server-side YouCam API key
- Perfect Corp / YouCam File API upload
- New Skin Analysis v2.1 task for every photo
- Polling by that exact task_id until success/error
- HD-only skin-analysis actions (no HD/SD mixing)
- Server-side product ranking from the current customer's analysis
- No hard-coded previous-customer recommendations

## Setup
1. Install Node.js 18+
2. Copy `.env.example` to `.env`
3. Put your YouCam API key in `.env`
4. Run:
   npm install
   npm start
5. Open http://localhost:3000

## Product catalog
Replace `data/products.json` with your real Genze Hub catalog.

Each product can contain:
- title
- description
- product_type
- tags (array)
- ingredients (array)
- url
- image

The current file contains only example products so the matching engine can be tested safely.

## Security
Never put the YouCam key in `public/app.js`, HTML, Shopify Liquid, or any browser-visible file.

## YouCam flow
The server:
1. Calls `/s2s/v2.0/file`
2. Uploads the received photo to the signed URL
3. Calls `/s2s/v2.1/task/skin-analysis` using `src_file_id`
4. Polls `/s2s/v2.1/task/skin-analysis/{task_id}`
5. Normalizes the successful output
6. Sends only that scan's result to the matching engine

## Deployment
This can be deployed to a Node-compatible host such as Render, Railway, Fly.io, or a server/VPS.
Set `YOUCAM_API_KEY` as a secret environment variable on the host.

## Important
The real 5,006-product catalog is not inside this conversation, so this ZIP cannot contain those products yet.
Replace `data/products.json` with the actual export/catalog when available.

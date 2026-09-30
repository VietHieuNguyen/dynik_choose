# DYNIK Product Finder

A mobile-first, vanilla HTML/CSS/JavaScript product recommendation site for **DYNIK**. The site is fully static and ready to deploy on Vercel without a build step.

Vietnamese copy throughout. Vanilla stack only — no bundler, no framework, no backend.

---

## 1. What this is

A 4-step fragrance quiz that recommends a DYNIK product. The five entry categories are:

1. D?u g?i s?ch gàu
2. L?n kh? mùi
3. N??c hoa
4. S?a t?m mát l?nh
5. T?m g?i 5in1

For perfume the quiz picks a fragrance first, then asks the user to choose between existing sizes (9 ml and 50 ml). All buy buttons deep-link to the `purchase_url` shipped in the data file (TikTok).

---

## 2. Project structure

```
dynik-site/
??? index.html                    # entry HTML
??? css/
?   ??? styles.css                # design tokens + layout
??? js/
?   ??? app.js                    # screen controller (categories ? quiz ? result)
?   ??? scoring.js                # weighted-affinity ranking engine
?   ??? assets.js                 # image / label resolvers
??? data/
?   ??? dynik_quiz_products_vi_5_categories.json   # schema 2.0.0, source of truth
?   ??? asset-manifest.json       # asset registry, mirrors what's present + what's missing
??? assets/
?   ??? logo.svg                  # wordmark fallback
?   ??? packshot/
?       ??? shampoo.svg
?       ??? deodorant.svg
?       ??? perfume.svg
?       ??? body_wash.svg
?       ??? wash_5in1.svg
??? README.md
```

`assets/products/` is reserved for verified SCC product images. The site ships with text fallbacks for the result screen because `image_url` is `null` for every SKU in the supplied JSON.

---

## 3. Run locally

The site loads `data/dynik_quiz_products_vi_5_categories.json` over HTTP, so it cannot be opened with a `file://` URL — Chrome blocks `fetch` on the file scheme. Pick any of these one-liners from the project root:

```powershell
# Option A — Node (no install)
node serve.js
# ? http://127.0.0.1:4173/

# Option B — Python 3
python -m http.server 4173

# Option C — Vercel CLI (mirrors production)
npx vercel dev
```

The bundled `serve.js` is a tiny static server; delete it before deploying (or include it — it has no runtime impact).

---

## 4. Deploy to Vercel

This project has **no mandatory build step**. Two options:

### Option A — drag-and-drop
1. Run `vercel deploy` once locally to authenticate, then drag the `dynik-site` folder onto https://vercel.com/new.
2. Vercel will detect a static site and serve it directly.

### Option B — Git-based
1. Push the folder to a git host (GitHub, GitLab, Bitbucket).
2. Import the repo in Vercel.
3. Framework preset: **Other**. Build command: *leave empty*. Output directory: `.`.

The site is a single page with relative asset paths and is JSON-driven, so it works on any static host (Netlify, Cloudflare Pages, GitHub Pages).

---

## 5. Replacing assets

### Category mockups (entry screen)

The supplied `Packshot/` archive contains five empty subfolders. Drop a JPEG or PNG into `assets/packshot/` (any filename) and update `data/asset-manifest.json`:

```json
"shampoo": {
  "source_files": ["assets/packshot/your-shampoo-image.jpg"],
  "status": "verified"
}
```

Then extend `js/assets.js ? PACKSHOT_SVG` to point at your file. Until you do, the entry screen renders an inline SVG silhouette derived from the verified packaging forms shown in `Trang 2.jpg`, `Trang 3.jpg`, and `Trang 4.jpg`.

### Result images

Each SKU in the JSON can carry an `image_url`. Add a verified URL to the JSON, or drop the file locally and update `js/assets.js ? productImage` to resolve from a local path. The brief warns (`data_quality_notes.IMAGES_PENDING`) that `image_url` is currently `null` for every SKU — do **not** fabricate URLs.

If a SKU's image is missing at runtime, the result card displays an intentional text fallback (`<product name>` plus a low-opacity SVG silhouette) rather than the previous SKU's image.

---

## 6. Updating product data

Replace `data/dynik_quiz_products_vi_5_categories.json` with a new file at the same path. Keep these invariants intact:

- `schema_version: "2.0.0"` (the runtime refuses other versions)
- 5 categories, 22 SKUs
- Exactly 4 options per question
- `body_wash` has 3 questions; the others have 4
- For perfume: `ranking_unit: "profile_id"` and `variant_selection` covers all six profiles

The frontend removes any quiz answers cached from the older seven-category schema, so users always start a fresh run after a data update.

---

## 7. Verification checklist

The shipped code passes these checks (re-run anytime):

| Check | How |
|---|---|
| All 22 SKUs preserved | `node test-behaviour.js` ? "Total products: 22" |
| All 5 categories preserved | same script ? "Total categories: 5" |
| Each question has 4 options | same script ? "All categories: each question has 4 options" |
| All quiz flows work | Open `index.html` in a browser via the static server and run each category |
| Perfume 9ml vs 50ml ? identical score | `node test-behaviour.js` ? "equal=true" |
| Scoring matches the integration examples in the JSON | `node test-scoring.js` ? "48 passed, 0 failed" |
| Back / change-answer / restart / switch-category works | Manual: all 5 category flows |

---

## 8. Accessibility

- Quiz answers use A–D button cards with `aria-pressed`; only one is active at a time. Tab, Enter, Space, arrow keys and 1–4 are supported.
- All source files are UTF-8. Preserve this encoding when editing; do not re-encode through ANSI/Latin-1.
- All interactive elements are real `<button>` / `<a>` elements with minimum 44 px touch targets.
- Focus moves to the question heading on each screen change and to the result heading on the result screen.
- The site honours `prefers-reduced-motion: reduce`.
- Every buy button is a real `<a>` with `target="_blank"` and `rel="noopener noreferrer"`.

---

## 9. Unresolved assets (honest status)

- **Result-screen images for all 22 SKUs.** `image_url` is `null` in the JSON and no verified SCC images were downloaded for this build. The runtime shows a text fallback in the image slot.
- **Per-category mockup images.** The supplied `Packshot/` subfolders are empty. The site falls back to inline SVGs derived from the verified packaging forms in `Trang 2-4.jpg`. Drop files into `assets/packshot/` and update `data/asset-manifest.json` to upgrade.
- **TikTok destinations.** Every `purchase_url` was copied verbatim from the supplied sheet. The JSON's `purchase_link_status` is `copied_from_sheet_destination_not_verified`. Treat all buy clicks as unverified until each URL is opened manually and matched to the correct product.
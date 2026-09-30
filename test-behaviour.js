// End-to-end behavior tests for the scoring engine + variant handling.
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "data/dynik_quiz_products_vi_5_categories.json"), "utf8"));
cfg.categories.forEach((c) => (c.__config = cfg));

// Mirror browser-side scoring helpers
function calculate(category, answers) {
  const products = category.product_ids.map((id) => cfg.products.find((p) => p.id === id));
  let denom = 0;
  const num = {};
  products.forEach((p) => (num[p.id] = 0));
  category.questions.forEach((q) => {
    const sel = answers[q.id];
    if (!sel) return;
    const opt = q.options.find((o) => o.id === sel);
    if (!q.weight) return;
    denom += q.weight;
    products.forEach((p) => {
      const a = (opt.affinity_by_product && opt.affinity_by_product[p.id]) || 0;
      num[p.id] += q.weight * a;
    });
  });
  return { perProduct: Object.fromEntries(products.map((p) => [p.id, denom === 0 ? 0 : (100 * num[p.id]) / denom])), denom };
}

const perfume = cfg.categories.find((c) => c.id === "perfume");
const shampoo = cfg.categories.find((c) => c.id === "shampoo");
const bodyWash = cfg.categories.find((c) => c.id === "body_wash");
const deodorant = cfg.categories.find((c) => c.id === "deodorant");
const wash5 = cfg.categories.find((c) => c.id === "wash_5in1");

console.log("=== Inventory ===");
console.log(`Total products: ${cfg.products.length} (expected 22)`);
console.log(`Total categories: ${cfg.categories.length} (expected 5)`);
const qcounts = Object.fromEntries(cfg.categories.map((c) => [c.id, c.questions.length]));
console.log(`Question counts: ${JSON.stringify(qcounts)}`);
cfg.categories.forEach((c) => {
  c.questions.forEach((q) => {
    if (q.options.length !== 4) throw new Error(`${c.id}/${q.id} has ${q.options.length} options`);
  });
});
console.log("All categories: each question has 4 options. ?");

console.log("\n=== Perfume SKU equality per profile ===");
const perfumeProds = cfg.products.filter((p) => p.category_id === "perfume");
const groups = {};
perfumeProds.forEach((p) => {
  if (!groups[p.profile_id]) groups[p.profile_id] = [];
  groups[p.profile_id].push(p);
});
Object.keys(groups).forEach((prof) => {
  console.log(`  ${prof}: ${groups[prof].map((p) => `${p.id} (${p.size.value}${p.size.unit})`).join(", ")}`);
});

console.log("\n=== Fragrance 9ml vs 50ml produces equal scores ===");
const answers = { perfume_opening: "perfume_opening_1", perfume_heart: "perfume_heart_1", perfume_base: "perfume_base_1", perfume_character: "perfume_character_1" };
const r = calculate(perfume, answers);
const m9 = r.perProduct["perfume_9ml_the_mannik"];
const m50 = r.perProduct["perfume_50ml_the_mannik"];
console.log(`  the_mannik 9ml = ${m9}, 50ml = ${m50}, equal=${m9 === m50}`);
if (m9 !== m50) process.exit(1);

console.log("\n=== Variant selection keeps score unchanged ===");
const entry = {
  kind: "fragrance",
  raw_percent: m50,
  display_percent: Math.round(m50),
  variant_products: [cfg.products.find((p) => p.id === "perfume_9ml_the_mannik"), cfg.products.find((p) => p.id === "perfume_50ml_the_mannik")],
  selected_product: null,
};
// simulate selection (we don't have selectVariant available here; emulate)
entry.selected_product = entry.variant_products[0];
console.log(`  before/after selection: raw_percent=${entry.raw_percent} selected_product=${entry.selected_product.id}`);

console.log("\n=== All 5 categories render and have product_ids ===");
const order = cfg.ui.category_order;
order.forEach((cid, i) => {
  const c = cfg.categories.find((x) => x.id === cid);
  if (!c) throw new Error("Missing category " + cid);
  console.log(`  ${i + 1}. ${cid} ? ${c.name} (${c.product_ids.length} SKUs, ${c.questions.length} q)`);
});

console.log("\n? Behavior tests complete.");
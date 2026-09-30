// Verify scoring matches the integration examples in the JSON.
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "data/dynik_quiz_products_vi_5_categories.json"), "utf8"));

// Attach config to categories for the engine
cfg.categories.forEach((c) => (c.__config = cfg));

// Recreate the engine functions in JS for verification
const EPS = 1e-6;
function calculateRawPercents(category, answers) {
  const products = category.product_ids.map((id) => cfg.products.find((p) => p.id === id));
  let denominator = 0;
  const numeratorByProduct = {};
  products.forEach((p) => (numeratorByProduct[p.id] = 0));
  category.questions.forEach((q) => {
    const sel = answers[q.id];
    if (!sel) {
      if (q.required) throw new Error("missing " + q.id);
      return;
    }
    const opt = q.options.find((o) => o.id === sel);
    if (!opt) throw new Error("invalid " + q.id + "->" + sel);
    if (!q.weight || q.weight === 0) return;
    denominator += q.weight;
    products.forEach((p) => {
      const a = (opt.affinity_by_product && opt.affinity_by_product[p.id]) || 0;
      numeratorByProduct[p.id] += q.weight * a;
    });
  });
  const perProduct = {};
  products.forEach((p) => (perProduct[p.id] = denominator === 0 ? 0 : (100 * numeratorByProduct[p.id]) / denominator));
  return { perProduct, denominator };
}

function rank(categoryId, answers) {
  const category = cfg.categories.find((c) => c.id === categoryId);
  const { perProduct } = calculateRawPercents(category, answers);
  const items = Object.keys(perProduct).map((id) => ({ id, raw_percent: perProduct[id] }));
  items.sort((a, b) => b.raw_percent - a.raw_percent || (a.id < b.id ? -1 : 1));
  return { category, items, perProduct };
}

function rankProfile(categoryId, answers) {
  const category = cfg.categories.find((c) => c.id === categoryId);
  const { perProduct } = calculateRawPercents(category, answers);
  const byProfile = {};
  Object.keys(perProduct).forEach((id) => {
    const p = cfg.products.find((x) => x.id === id);
    const prof = p.profile_id;
    if (!byProfile[prof]) byProfile[prof] = { ids: [], scores: [] };
    byProfile[prof].ids.push(id);
    byProfile[prof].scores.push(perProduct[id]);
  });
  Object.keys(byProfile).forEach((prof) => {
    const g = byProfile[prof];
    const min = Math.min.apply(null, g.scores);
    const max = Math.max.apply(null, g.scores);
    g.equal = max - min <= EPS;
    g.score = max;
  });
  const items = Object.keys(byProfile).map((prof) => ({ id: prof, raw_percent: byProfile[prof].score }));
  items.sort((a, b) => b.raw_percent - a.raw_percent || (a.id < b.id ? -1 : 1));
  return { items, perProduct, byProfile };
}

const examples = cfg.integration.examples;
let pass = 0, fail = 0;
for (const ex of examples) {
  if (ex.expected_raw_percent) {
    const { category, items, perProduct } = rank(ex.category_id, ex.answers);
    for (const pid of Object.keys(ex.expected_raw_percent)) {
      const expected = ex.expected_raw_percent[pid];
      const actual = perProduct[pid];
      const ok = Math.abs(actual - expected) < EPS;
      if (ok) pass++; else fail++;
      console.log(`[${ok ? "PASS" : "FAIL"}] ${ex.category_id} ${pid}: expected ${expected}, actual ${actual}`);
    }
  }
  if (ex.expected_raw_percent_by_profile) {
    const { items, byProfile } = rankProfile(ex.category_id, ex.answers);
    for (const prof of Object.keys(ex.expected_raw_percent_by_profile)) {
      const expected = ex.expected_raw_percent_by_profile[prof];
      const actual = byProfile[prof] ? byProfile[prof].score : null;
      const ok = actual !== null && Math.abs(actual - expected) < EPS;
      if (ok) pass++; else fail++;
      console.log(`[${ok ? "PASS" : "FAIL"}] ${ex.category_id} profile ${prof}: expected ${expected}, actual ${actual} (equal=${byProfile[prof] && byProfile[prof].equal})`);
    }
    if (ex.expected_top_profile_id) {
      const top = items[0].id;
      const ok = top === ex.expected_top_profile_id;
      if (ok) pass++; else fail++;
      console.log(`[${ok ? "PASS" : "FAIL"}] ${ex.category_id} top profile: expected ${ex.expected_top_profile_id}, actual ${top}`);
    }
  }
}
console.log(`\nResult: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);

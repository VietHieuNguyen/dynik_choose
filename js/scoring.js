/**
 * DYNIK scoring engine
 *
 * Reads the schema version 2.0.0 JSON and produces a recommendation object
 * with: ranking_unit, profile_id, recommendations[], bands, low_match notice.
 *
 * Reference: dynik_quiz_products_vi_5_categories.json ? scoring,
 * scoring.grouping_before_ranking, scoring.tie_policy, scoring.near_tie_policy,
 * scoring.bands, scoring.low_match_policy, scoring.reason_generation,
 * scoring.completion_steps, variant_selection.
 *
 * Hard rules implemented:
 *   - Only consider products in the selected category.
 *   - Zero-weight questions personalize but do not affect scores.
 *   - Rank by raw_percent (unrounded) before rounding for display.
 *   - For perfume: rank by profile_id after verifying equal SKU scores.
 *   - Apply tie_policy (show_all_joint_top) and near_tie_policy
 *     (best + one alternative within 5 points) on the grouped ranking unit.
 *   - Score range 0–100, never inflated.
 *   - Reasons generated only from selected_option.reason_if_matched when
 *     affinity >= 0.75, sorted by question.weight desc then question.id asc,
 *     capped at 2 items, prefixed with "Bạn đã chọn: ".
 *   - For perfume, all SKUs in a profile share reasons; size change keeps
 *     reasons and score unchanged.
 */

(function (global) {
  "use strict";

  const EPS = 1e-6;
  const NEAR_TIE_PP = 5; // percentage points
  const REASON_MIN_AFFINITY = 0.75;

  /* ----------------------------------------------------------
   * Validation
   * ---------------------------------------------------------- */
  function validateConfig(cfg) {
    if (!cfg || typeof cfg !== "object") throw new Error("Cấu hình trống");
    if (cfg.schema_version !== "2.0.0" && cfg.schema_version !== "2.0.1") {
      throw new Error("Sai schema_version. Cần 2.0.0 hoặc 2.0.1, nhận " + cfg.schema_version);
    }
    if (!Array.isArray(cfg.categories) || !Array.isArray(cfg.products)) {
      throw new Error("Thiếu categories hoặc products");
    }
  }

  function findCategory(cfg, categoryId) {
    const c = cfg.categories.find((x) => x.id === categoryId);
    if (!c) throw new Error("Không tìm thấy nhóm: " + categoryId);
    return c;
  }

  function findProduct(cfg, productId) {
    const p = cfg.products.find((x) => x.id === productId);
    if (!p) throw new Error("Không tìm thấy sản phẩm: " + productId);
    return p;
  }

  /* ----------------------------------------------------------
   * Score calculation
   * Returns { perProduct: { id -> raw_percent }, denominator }
   * ---------------------------------------------------------- */
  function calculateRawPercents(category, answers) {
    const products = category.product_ids.map((id) => findProduct(category.__config || global.__dynikCfg, id));
    // re-bind: findProduct uses cfg from global if not on category; safer:
    const cfg = category.__config;
    const productMap = {};
    products.forEach((p) => (productMap[p.id] = p));

    let denominator = 0; // sum(question.weight for non-zero questions answered)
    const numeratorByProduct = {};
    products.forEach((p) => (numeratorByProduct[p.id] = 0));

    category.questions.forEach((q) => {
      const selectedId = answers[q.id];
      if (selectedId === undefined || selectedId === null) {
        if (q.required) {
          throw new Error("Chưa trả lời câu: " + q.id);
        }
        return;
      }
      const opt = q.options.find((o) => o.id === selectedId);
      if (!opt) {
        throw new Error("Không hợp lệ: " + q.id + " ? " + selectedId);
      }
      if (!q.weight || q.weight === 0) {
        // personalize-only, no effect on score
        return;
      }
      denominator += q.weight;
      products.forEach((p) => {
        const affinity = (opt.affinity_by_product && opt.affinity_by_product[p.id]) || 0;
        numeratorByProduct[p.id] += q.weight * affinity;
      });
    });

    const perProduct = {};
    products.forEach((p) => {
      perProduct[p.id] = denominator === 0 ? 0 : (100 * numeratorByProduct[p.id]) / denominator;
    });

    return { perProduct, denominator, productMap, cfg };
  }

  /* ----------------------------------------------------------
   * Build reason list from selected answers
   * ---------------------------------------------------------- */
  function buildReasons(category, answers) {
    const reasons = [];
    category.questions.forEach((q) => {
      const sel = answers[q.id];
      if (!sel) return;
      const opt = q.options.find((o) => o.id === sel);
      if (!opt || !opt.reason_if_matched) return;
      // use the highest affinity the option has across this category's products
      let maxAffinity = 0;
      Object.values(opt.affinity_by_product || {}).forEach((v) => {
        if (typeof v === "number" && v > maxAffinity) maxAffinity = v;
      });
      if (maxAffinity >= REASON_MIN_AFFINITY) {
        reasons.push({ text: opt.reason_if_matched, weight: q.weight || 0, qid: q.id });
      }
    });
    reasons.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.qid < b.qid) return -1;
      if (a.qid > b.qid) return 1;
      return 0;
    });
    return reasons.slice(0, 2);
  }

  function buildBenefit(category, answers) {
    // weight=0 questions personalize without affecting score
    const benefits = [];
    category.questions.forEach((q) => {
      if (q.weight && q.weight !== 0) return;
      const sel = answers[q.id];
      if (!sel) return;
      const opt = q.options.find((o) => o.id === sel);
      if (opt && opt.personalized_benefit) {
        benefits.push(opt.personalized_benefit);
      }
    });
    return benefits;
  }

  /* ----------------------------------------------------------
   * Bands
   * ---------------------------------------------------------- */
  function bandOf(rawPercent, cfg) {
    const bands = (cfg.scoring && cfg.scoring.bands) || [];
    for (const b of bands) {
      if (b.min_inclusive !== undefined && rawPercent < b.min_inclusive) continue;
      if (b.max_inclusive !== undefined && rawPercent > b.max_inclusive) continue;
      if (b.max_exclusive !== undefined && rawPercent >= b.max_exclusive) continue;
      return b;
    }
    return bands[bands.length - 1] || null;
  }

  /* ----------------------------------------------------------
   * Ranking units
   * ---------------------------------------------------------- */
  function rankProducts(category, answers, cfg) {
    const { perProduct, denominator, productMap } = calculateRawPercents(category, answers);
    const items = Object.keys(perProduct).map((id) => ({
      id,
      raw_percent: perProduct[id],
      display_percent: Math.round(perProduct[id]),
    }));
    items.sort((a, b) => {
      if (b.raw_percent !== a.raw_percent) return b.raw_percent - a.raw_percent;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return { items, denominator, productMap };
  }

  function rankByProfile(category, answers, cfg) {
    // Compute per-SKU raw_percent, group by profile_id, verify equality per group,
    // use group score, rank groups by that score.
    const { perProduct, denominator, productMap } = calculateRawPercents(category, answers);
    const byProfile = {};
    Object.keys(perProduct).forEach((id) => {
      const p = productMap[id];
      const prof = p.profile_id;
      if (!byProfile[prof]) byProfile[prof] = { ids: [], scores: [] };
      byProfile[prof].ids.push(id);
      byProfile[prof].scores.push(perProduct[id]);
    });
    // verify SKU equality within each group (within tie_epsilon)
    Object.keys(byProfile).forEach((prof) => {
      const group = byProfile[prof];
      const min = Math.min.apply(null, group.scores);
      const max = Math.max.apply(null, group.scores);
      if (max - min > EPS) {
        // not a hard error; surface as warning so the UI can still proceed
        if (!global.__dynikWarnings) global.__dynikWarnings = [];
        global.__dynikWarnings.push({
          code: "PROFILE_SKU_SCORE_MISMATCH",
          profile_id: prof,
          detail: "SKU trong cùng profile có điểm lệch " + (max - min).toFixed(6),
        });
      }
      group.score = max; // use the common score
      group.ids.sort();
    });
    const items = Object.keys(byProfile).map((prof) => ({
      id: prof,
      raw_percent: byProfile[prof].score,
      display_percent: Math.round(byProfile[prof].score),
      product_ids: byProfile[prof].ids,
    }));
    items.sort((a, b) => {
      if (b.raw_percent !== a.raw_percent) return b.raw_percent - a.raw_percent;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return { items, denominator, productMap };
  }

  /* ----------------------------------------------------------
   * Tie / near-tie handling on ranking unit
   * ---------------------------------------------------------- */
  function applyTies(items) {
    if (items.length === 0) return { top: [], alternative: null, allTies: [] };
    const topScore = items[0].raw_percent;
    const allTies = items.filter((it) => Math.abs(it.raw_percent - topScore) <= EPS);
    return { top: allTies, alternative: null, allTies };
  }

  function applyNearTie(items, top) {
    if (top.length > 1) return null; // joint top wins; no alternative
    if (items.length < 2) return null;
    const topScore = items[0].raw_percent;
    const nextScore = items[1].raw_percent;
    if (topScore - nextScore <= NEAR_TIE_PP) {
      // collect all candidates tied at nextScore within epsilon for stability
      const altCandidates = items
        .slice(1)
        .filter((it) => Math.abs(it.raw_percent - nextScore) <= EPS);
      // pick first by id ascending (already sorted)
      return altCandidates[0] || items[1];
    }
    return null;
  }

  /* ----------------------------------------------------------
   * Public API: compute(categoryId, answers) -> recommendation
   * ---------------------------------------------------------- */
  function compute(cfg, categoryId, answers) {
    validateConfig(cfg);
    const category = findCategory(cfg, categoryId);
    // Attach config to category for downstream helpers
    category.__config = cfg;

    const rankingUnit = category.ranking_unit || "product_id";
    let ranked;
    if (rankingUnit === "profile_id") {
      ranked = rankByProfile(category, answers, cfg);
    } else {
      ranked = rankProducts(category, answers, cfg);
    }

    const tie = applyTies(ranked.items);
    const alternative = applyNearTie(ranked.items, tie.top);

    // Low-match notice
    const lowMatchThreshold = (cfg.scoring && cfg.scoring.low_match_policy && cfg.scoring.low_match_policy.threshold_below) || 50;
    const lowMatch = ranked.items.length > 0 && ranked.items[0].raw_percent < lowMatchThreshold;

    // Reasons / benefits (shared across all SKUs in a perfume profile, identical scores)
    const reasons = buildReasons(category, answers);
    const benefits = buildBenefit(category, answers);

    // Build top entries with product data
    const topEntries = tie.top.map((entry) => buildEntry(cfg, category, rankingUnit, entry, reasons));

    let altEntry = null;
    if (alternative) {
      altEntry = buildEntry(cfg, category, rankingUnit, alternative, reasons);
    }

    return {
      category_id: categoryId,
      ranking_unit: rankingUnit,
      raw_percent: ranked.items[0] ? ranked.items[0].raw_percent : 0,
      display_percent: ranked.items[0] ? Math.round(ranked.items[0].raw_percent) : 0,
      band: ranked.items[0] ? bandOf(ranked.items[0].raw_percent, cfg) : null,
      top: topEntries,
      alternative: altEntry,
      joint_winner: tie.top.length > 1,
      low_match: lowMatch,
      low_match_policy: cfg.scoring && cfg.scoring.low_match_policy,
      reasons,
      benefits,
      all_scores: ranked.items,
      denominator: ranked.denominator,
    };
  }

  function buildEntry(cfg, category, rankingUnit, rankedItem, reasons) {
    if (rankingUnit === "profile_id") {
      const profile = cfg.fragrance_profiles.find((p) => p.id === rankedItem.id);
      const variantGroup = (cfg.variant_selection && cfg.variant_selection.groups || []).find((g) => g.profile_id === rankedItem.id);
      const variantProducts = (variantGroup ? variantGroup.product_ids : rankedItem.product_ids || [])
        .map((pid) => findProduct(cfg, pid));
      const singleVariant = variantProducts.length === 1;
      const defaultProduct = variantGroup && variantGroup.default_product_id
        ? findProduct(cfg, variantGroup.default_product_id)
        : (singleVariant ? variantProducts[0] : null);
      return {
        kind: "fragrance",
        recommendation_id: profile ? profile.id : rankedItem.id,
        profile_id: rankedItem.id,
        name: profile ? profile.name : rankedItem.id,
        summary: profile ? profile.summary : "",
        raw_percent: rankedItem.raw_percent,
        display_percent: rankedItem.display_percent,
        band: bandOf(rankedItem.raw_percent, cfg),
        reasons,
        variant_products: variantProducts,
        single_variant: singleVariant,
        selected_product: defaultProduct, // null if multi-variant and no selection yet
        variant_label: cfg.variant_selection && cfg.variant_selection.selection_label || "Chọn dung tích",
      };
    }
    // product_id ranking
    const product = findProduct(cfg, rankedItem.id);
    return {
      kind: "product",
      recommendation_id: product.id,
      product_id: product.id,
      profile_id: product.profile_id,
      name: product.name,
      short_name: product.short_name,
      size: product.size,
      description_short: product.description_short,
      image_url: product.image_url,
      purchase_url: product.purchase_url,
      price: product.price,
      raw_percent: rankedItem.raw_percent,
      display_percent: rankedItem.display_percent,
      band: bandOf(rankedItem.raw_percent, cfg),
      reasons,
    };
  }

  /* ----------------------------------------------------------
   * Select variant (size) on a perfume entry
   * ---------------------------------------------------------- */
  function selectVariant(cfg, entry, productId) {
    if (!entry || entry.kind !== "fragrance") return entry;
    const variant = (entry.variant_products || []).find((p) => p.id === productId);
    if (!variant) {
      throw new Error("Dung tích không hợp lệ: " + productId);
    }
    entry.selected_product = variant;
    // raw_percent, display_percent, band, reasons intentionally unchanged
    return entry;
  }

  /* ----------------------------------------------------------
   * Reset a perfume entry's selected variant
   * ---------------------------------------------------------- */
  function clearVariantSelection(entry) {
    if (entry && entry.kind === "fragrance" && !entry.single_variant) {
      entry.selected_product = null;
    }
    return entry;
  }

  global.DynikScoring = {
    compute,
    selectVariant,
    clearVariantSelection,
    bandOf,
    _internals: { rankProducts, rankByProfile, applyTies, applyNearTie },
  };
})(window);

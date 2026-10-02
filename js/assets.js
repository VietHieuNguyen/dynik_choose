/**
 * Asset resolver
 *
 * Centralised decision for image URLs / fallbacks / local images.
 * Uses exact assets from anhdaidien1 for results.
 */
(function (global) {
  "use strict";

  const PACKSHOT_PNG = {
    shampoo: "assets/packshot/shampoo.png",
    deodorant: "assets/packshot/deodorant.png",
    perfume: "assets/packshot/perfume.png",
    body_wash: "assets/packshot/body_wash.png",
    wash_5in1: "assets/packshot/wash_5in1.png",
  };

  const CATEGORY_LABEL = {
    shampoo: "Dầu gội sạch gàu",
    deodorant: "Lăn khử mùi",
    perfume: "Nước hoa",
    body_wash: "Sữa tắm mát lạnh",
    wash_5in1: "Tắm gội 5in1",
  };

  // Exact 1:1 mapping from product ID to anhdaidien1 assets
  const PRODUCT_IMAGE_MAP = {
    // Lăn khử mùi
    deodorant_dynamic: "assets/anhdaidien1/lkm_dynamic.png",
    deodorant_legend: "assets/anhdaidien1/lkm_legend.png",
    deodorant_oceanic: "assets/anhdaidien1/lkm_oceanic.png",
    deodorant_urban: "assets/anhdaidien1/lkm_urban.png",

    // Sữa tắm
    body_wash_legend: "assets/anhdaidien1/st_legend.jpg",
    body_wash_oceanic: "assets/anhdaidien1/st_oceanic.jpg",

    // Sữa tắm gội 5in1
    wash_5in1_dynamic: "assets/anhdaidien1/5in1_dynamic.png",
    wash_5in1_legend: "assets/anhdaidien1/5in1_legend.png",
    wash_5in1_oceanic: "assets/anhdaidien1/5in1_oceanic.png",
    wash_5in1_urban: "assets/anhdaidien1/5in1_urban.png",

    // Dầu gội
    shampoo_dynamic: "assets/anhdaidien1/dg_dynamic.png",
    shampoo_legend: "assets/anhdaidien1/dg_legend.png",
    shampoo_oceanic: "assets/anhdaidien1/dg_oceanic.png",
    shampoo_urban: "assets/anhdaidien1/dg_urban.png",

    // Nước hoa 50ml & 9ml
    perfume_50ml_the_mannik: "assets/anhdaidien1/nh_the manik_50ml.jpg",
    perfume_50ml_valoren: "assets/anhdaidien1/nh_valoren_50ml.jpg",
    perfume_9ml_the_mannik: "assets/anhdaidien1/nh_the manik_9ml.jpg",
    perfume_9ml_valoren: "assets/anhdaidien1/nh_valoren_9ml.jpg",

    // Nước hoa BST Journey (50ml)
    perfume_journey_breathing_mountain_air: "assets/anhdaidien1/nh_breathing_50ml.jpg",
    perfume_journey_bucolic_retreat: "assets/anhdaidien1/nh_bucolic_50ml.jpg",
    perfume_journey_swimming_at_riverside: "assets/anhdaidien1/nh_swimming_50ml.jpg",
    perfume_journey_cocooning_under_snow: "assets/anhdaidien1/nh_cocooning_50ml.jpg",
  };

  function categoryPackshot(categoryId) {
    return PACKSHOT_PNG[categoryId] || "assets/packshot/perfume.png";
  }

  function categoryName(categoryId) {
    return CATEGORY_LABEL[categoryId] || categoryId;
  }

  function categoryQuestionCount(category) {
    if (!category) return 4;
    if (typeof category.question_count === "number") return category.question_count;
    if (Array.isArray(category.questions)) return category.questions.length;
    return 4;
  }

  /**
   * Resolve image for a product. Returns { src, fallbackSrc, isMissing, alt }.
   * Prioritizes exact anhdaidien1 assets.
   */
  function productImage(product) {
    if (product) {
      const pid = product.id || product.product_id;
      const mappedSrc = pid && PRODUCT_IMAGE_MAP[pid];
      const localSrc = pid ? `assets/products/${pid}.jpg` : null;
      const remoteSrc = (typeof product.image_url === "string" && product.image_url.length > 0) ? product.image_url : null;
      const src = mappedSrc || localSrc || remoteSrc;

      if (src) {
        return {
          src: src,
          fallbackSrc: remoteSrc || localSrc,
          isMissing: false,
          alt: product.name || "Sản phẩm DYNIK",
        };
      }
    }
    return {
      src: null,
      fallbackSrc: null,
      isMissing: true,
      alt: (product && product.name) || "Sản phẩm DYNIK",
    };
  }

  /**
   * Resolve preview image for fragrance profile before size selection.
   * Defaults to the 50ml bottle for prominent display.
   */
  function defaultSelectedImageForFragrance(entry) {
    if (!entry || !entry.variant_products) return null;
    const sortedDesc = entry.variant_products.slice().sort((a, b) => {
      const av = (a.size && a.size.value) || 0;
      const bv = (b.size && b.size.value) || 0;
      return bv - av; // 50ml first
    });

    for (const v of sortedDesc) {
      const img = productImage(v);
      if (img && img.src) {
        return {
          src: img.src,
          fallbackSrc: img.fallbackSrc,
          isMissing: false,
          alt: v.name,
          preview_size: v.size,
          preview_product_id: v.id,
        };
      }
    }
    return {
      src: null,
      fallbackSrc: null,
      isMissing: true,
      alt: entry.name || "Mùi hương DYNIK",
      preview_size: sortedDesc[0] ? sortedDesc[0].size : null,
      preview_product_id: sortedDesc[0] ? sortedDesc[0].id : null,
    };
  }

  global.DynikAssets = {
    categoryPackshot,
    categoryName,
    categoryQuestionCount,
    productImage,
    defaultSelectedImageForFragrance,
    PRODUCT_IMAGE_MAP,
  };
})(window);

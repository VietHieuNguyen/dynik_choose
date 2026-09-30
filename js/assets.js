/**
 * Asset resolver
 *
 * Centralised decision for image URLs / fallbacks / local images.
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
   * Prioritizes locally downloaded high-res assets in assets/products/
   */
  function productImage(product) {
    if (product) {
      const localSrc = product.id ? `assets/products/${product.id}.jpg` : null;
      const remoteSrc = (typeof product.image_url === "string" && product.image_url.length > 0) ? product.image_url : null;
      if (localSrc || remoteSrc) {
        return {
          src: localSrc || remoteSrc,
          fallbackSrc: remoteSrc,
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

  function defaultSelectedImageForFragrance(entry) {
    if (!entry || !entry.variant_products) return null;
    const sorted = entry.variant_products.slice().sort((a, b) => {
      const av = (a.size && a.size.value) || 0;
      const bv = (b.size && b.size.value) || 0;
      return av - bv;
    });
    for (const v of sorted) {
      const localSrc = v.id ? `assets/products/${v.id}.jpg` : null;
      const remoteSrc = v.image_url || null;
      if (localSrc || remoteSrc) {
        return {
          src: localSrc || remoteSrc,
          fallbackSrc: remoteSrc,
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
      preview_size: sorted[0] ? sorted[0].size : null,
      preview_product_id: sorted[0] ? sorted[0].id : null,
    };
  }

  global.DynikAssets = {
    categoryPackshot,
    categoryName,
    categoryQuestionCount,
    productImage,
    defaultSelectedImageForFragrance,
  };
})(window);

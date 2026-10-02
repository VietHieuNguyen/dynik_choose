/**
 * DYNIK quiz app
 *
 * Screens:
 *   #screen-categories  – 5 category cards (entry)
 *   #screen-quiz        – question runner
 *   #screen-result      – recommendation
 *   #screen-error       – load error / fatal state
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const STORAGE_KEY = "dynik.quiz.v2"; // schema 2.0.0 & 2.0.1

  const uiCopy = {
    categorySelectionTitle: "Chọn loại sản phẩm",
    categorySelectionLede: "Vài câu hỏi ngắn giúp gợi ý mùi hương phù hợp nhất với bạn.",
    back: "Quay lại",
    continue: "Tiếp tục",
    final: "Xem kết quả",
    retake: "Làm lại",
    changeCategory: "Chọn loại khác",
    buy: "Mua ngay trên TikTok Shop",
    scoreLabel: "Độ phù hợp",
    scoreCaption: "Dựa trên câu trả lời của bạn.",
    nearTieTitle: "Gợi ý tương đương",
    jointTitle: "Các lựa chọn phù hợp tương đương",
    errorLoad: "Không tải được dữ liệu sản phẩm. Vui lòng thử lại.",
    errorRetry: "Thử lại",
    benefitLabel: "Ưu tiên của bạn",
  };

  /* ----------------------------------------------------------
   * App state
   * ---------------------------------------------------------- */
  const state = {
    cfg: null,
    combos: [],
    categoryId: null,
    questionIndex: 0,
    answers: {}, // { question_id: option_id }
    recommendation: null,
    warnings: [],
  };

  /* ----------------------------------------------------------
   * Boot
   * ---------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    bindGlobalHandlers();
    loadConfig()
      .then((cfg) => {
        state.cfg = cfg;
        // Reset stale v1 storage
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (!parsed || (parsed.schema_version !== "2.0.0" && parsed.schema_version !== "2.0.1" && parsed.schema_version !== cfg.schema_version)) {
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch (_) { /* noop */ }
        renderCategories();
      })
      .catch((err) => {
        console.error(err);
        renderError(err);
      });
  });

  function bindGlobalHandlers() {
    $("#retry-button")?.addEventListener("click", () => {
      location.reload();
    });
    $("#header-logo-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      renderCategories();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function loadConfig() {
    const [cfgRes, combosRes] = await Promise.all([
      fetch("data/dynik_quiz_products_vi_5_categories.json", { cache: "no-store" }),
      fetch("data/combos.json", { cache: "no-store" }).catch(() => null),
    ]);
    if (!cfgRes.ok) throw new Error("HTTP " + cfgRes.status);
    const json = await cfgRes.json();
    let combos = [];
    if (combosRes && combosRes.ok) {
      try {
        combos = await combosRes.json();
      } catch (_) { /* noop */ }
    }
    state.combos = Array.isArray(combos) ? combos : [];
    return json;
  }

  /* ----------------------------------------------------------
   * Screens
   * ---------------------------------------------------------- */
  function showScreen(name) {
    $$(".screen").forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
    const sticky = $("#sticky-buy");
    if (sticky && name !== "result") {
      sticky.classList.remove("is-visible");
      sticky.innerHTML = "";
    }
  }

  function renderError(err) {
    const screen = $("#screen-error");
    if (!screen) return;
    const msg = screen.querySelector(".status-banner__message");
    if (msg) msg.textContent = (err && err.message) || uiCopy.errorLoad;
    showScreen("error");
  }

  /* ----------------------------------------------------------
   * Category screen
   * ---------------------------------------------------------- */
  function renderCategories() {
    const grid = $("#category-grid");
    const introTitle = $("#intro-title");
    const introLede = $("#intro-lede");
    if (introTitle) introTitle.textContent = uiCopy.categorySelectionTitle;
    if (introLede) introLede.textContent = uiCopy.categorySelectionLede;

    grid.innerHTML = "";
    const orderedIds = (state.cfg.ui && state.cfg.ui.category_order) || state.cfg.categories.map((c) => c.id);
    orderedIds.forEach((cid) => {
      const cat = state.cfg.categories.find((c) => c.id === cid);
      if (!cat) return;
      grid.appendChild(buildCategoryCard(cat));
    });
    showScreen("categories");
  }

  function buildCategoryCard(category) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card";
    btn.setAttribute("aria-label", `Chọn ${DynikAssets.categoryName(category.id)}`);
    btn.dataset.categoryId = category.id;
    btn.innerHTML = `
      <span class="category-card__thumb" aria-hidden="true">
        <img src="${DynikAssets.categoryPackshot(category.id)}" alt="">
      </span>
      <span class="category-card__body">
        <span class="category-card__title">${escapeHtml(DynikAssets.categoryName(category.id))}</span>
        <span class="category-card__meta">
          <span>${DynikAssets.categoryQuestionCount(category)} câu hỏi</span>
        </span>
        <span class="category-card__cta">
          Bắt đầu
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7"/>
          </svg>
        </span>
      </span>
    `;
    btn.addEventListener("click", () => {
      // persist which category was selected for analytics later
      trackEvent("category_selected", { category_id: category.id });
      startQuiz(category.id);
    });
    return btn;
  }

  /* ----------------------------------------------------------
   * Quiz
   * ---------------------------------------------------------- */
  function startQuiz(categoryId) {
    state.categoryId = categoryId;
    state.questionIndex = 0;
    state.answers = {};
    state.recommendation = null;
    renderQuestion();
  }

  function renderQuestion() {
    const cat = state.cfg.categories.find((c) => c.id === state.categoryId);
    if (!cat) return;
    const q = cat.questions[state.questionIndex];
    if (!q) return showResults();

    showScreen("quiz");

    const screen = $("#screen-quiz");
    screen.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <header class="quiz-header">
        <button type="button" class="quiz-header__back" id="quiz-back">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          ${uiCopy.back}
        </button>
        <span class="quiz-header__progress">Câu <strong>${state.questionIndex + 1}</strong>/${cat.questions.length}</span>
      </header>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style="width:${((state.questionIndex) / cat.questions.length) * 100}%"></div>
      </div>
      <section class="question" aria-labelledby="q-title">
        <p class="question__category">${escapeHtml(DynikAssets.categoryName(state.categoryId))}</p>
        <h2 class="question__title" id="q-title" tabindex="-1">${escapeHtml(q.text)}</h2>
        <p class="question__intro">Chọn thẻ mô tả đúng gu của bạn nhất.</p>
        <div class="options" role="group" aria-labelledby="q-title"></div>
        <div class="quiz-actions">
          <button type="button" class="btn btn--ghost" id="quiz-back-2" ${state.questionIndex === 0 ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            <span>${uiCopy.back}</span>
          </button>
          <button type="button" class="btn btn--primary" id="quiz-next" disabled>
            <span>${state.questionIndex === cat.questions.length - 1 ? uiCopy.final : uiCopy.continue}</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </button>
        </div>
      </section>
    `;
    screen.appendChild(wrap);

    // options (rendered directly as button cards, no list, no radio buttons)
    const optionsList = screen.querySelector(".options");
    q.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.setAttribute("aria-pressed", "false");
      btn.dataset.optionId = opt.id;
      btn.innerHTML = `<span class="option__label">${escapeHtml(opt.label)}</span>`;
      btn.addEventListener("click", () => {
        state.answers[q.id] = opt.id;
        // visual active state
        $$(".option", optionsList).forEach((el) => {
          const isSel = el.dataset.optionId === opt.id;
          el.classList.toggle("is-selected", isSel);
          el.setAttribute("aria-pressed", isSel ? "true" : "false");
        });
        $("#quiz-next").disabled = false;
        trackEvent("question_answered", { question_id: q.id, option_id: opt.id });
      });
      // pre-select if previously chosen
      if (state.answers[q.id] === opt.id) {
        btn.classList.add("is-selected");
        btn.setAttribute("aria-pressed", "true");
      }
      // keyboard navigation
      btn.tabIndex = 0;
      btn.addEventListener("keydown", (ev) => {
        const items = $$(".option", optionsList);
        let idx = items.indexOf(document.activeElement);
        if (idx === -1) return;
        if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
          ev.preventDefault();
          items[(idx + 1) % items.length].focus();
        } else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
          ev.preventDefault();
          items[(idx - 1 + items.length) % items.length].focus();
        } else if (/^[1-4]$/.test(ev.key)) {
          const target = items[parseInt(ev.key, 10) - 1];
          if (target) target.click();
        }
      });
      optionsList.appendChild(btn);
    });

    // pre-select previous selection visual
    if (state.answers[q.id]) {
      $$(".option", optionsList).forEach((el) => {
        if (el.dataset.optionId === state.answers[q.id]) {
          el.classList.add("is-selected");
          el.setAttribute("aria-pressed", "true");
        }
      });
      $("#quiz-next").disabled = false;
    }

    // actions
    const onBack = () => {
      if (state.questionIndex === 0) return renderCategories();
      state.questionIndex -= 1;
      renderQuestion();
    };
    const onBack2 = $("#quiz-back-2");
    if (onBack2) onBack2.addEventListener("click", onBack);
    $("#quiz-back").addEventListener("click", onBack);

    $("#quiz-next").addEventListener("click", () => {
      if (!state.answers[q.id]) return;
      if (state.questionIndex === cat.questions.length - 1) {
        trackEvent("quiz_completed", { category_id: state.categoryId });
        showResults();
      } else {
        state.questionIndex += 1;
        renderQuestion();
      }
    });

    // focus the heading
    setTimeout(() => {
      const title = $("#q-title");
      if (title) title.focus({ preventScroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  }

  /* ----------------------------------------------------------
   * Results
   * ---------------------------------------------------------- */
  function showResults() {
    let rec;
    try {
      rec = DynikScoring.compute(state.cfg, state.categoryId, state.answers);
    } catch (err) {
      console.error(err);
      renderError(err);
      return;
    }
    state.recommendation = rec;
    trackEvent("result_viewed", {
      category_id: rec.category_id,
      raw_percent: rec.raw_percent,
      display_percent: rec.display_percent,
      recommendation_id: rec.top[0] ? rec.top[0].recommendation_id : null,
    });
    renderResult(rec);
  }

  function renderResult(rec) {
    showScreen("result");
    const screen = $("#screen-result");
    screen.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "result-wrap";
    wrap.appendChild(buildPrimaryResult(rec));
    if (rec.top && rec.top[0]) {
      const comboSection = buildComboSection(rec.top[0]);
      if (comboSection) {
        wrap.appendChild(comboSection);
      }
    }
    if (rec.alternative) {
      wrap.appendChild(buildAlternativeBlock(rec.alternative, rec));
    }
    if (rec.low_match && rec.low_match_policy) {
      wrap.appendChild(buildLowMatchNotice(rec));
    }
    wrap.appendChild(buildResultActions());

    screen.appendChild(wrap);

    // focus heading
    setTimeout(() => {
      const title = screen.querySelector(".result__name");
      if (title) {
        title.setAttribute("tabindex", "-1");
        title.focus({ preventScroll: false });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      renderStickyBuy();
    }, 60);
  }

  function buildPrimaryResult(rec) {
    const top = rec.top[0];
    if (!top) {
      const empty = document.createElement("div");
      empty.className = "status-banner";
      empty.innerHTML = `<h2>Chưa có kết quả phù hợp</h2><p>Vui lòng làm lại.</p>`;
      return empty;
    }

    const card = document.createElement("article");
    card.className = "result";
    card.setAttribute("aria-labelledby", "result-name");

    // Media column
    const media = document.createElement("div");
    media.className = "result__media";
    if (top.kind === "fragrance") {
      const preview = top.single_variant
        ? {
            src: top.selected_product ? DynikAssets.productImage(top.selected_product).src : null,
            fallbackSrc: top.selected_product ? DynikAssets.productImage(top.selected_product).fallbackSrc : null,
            isMissing: !top.selected_product,
            alt: top.selected_product ? top.selected_product.name : top.name,
          }
        : DynikAssets.defaultSelectedImageForFragrance(top);
      renderMedia(media, preview.src, preview.alt, preview.isMissing, preview.fallbackSrc);
    } else {
      const img = DynikAssets.productImage(top);
      renderMedia(media, img.src, img.alt, img.isMissing, img.fallbackSrc);
    }

    // Body column
    const body = document.createElement("div");
    body.className = "result__body";
    body.innerHTML = `
      <span class="result__category">${escapeHtml(DynikAssets.categoryName(rec.category_id))}</span>
      <h2 class="result__name" id="result-name">${escapeHtml(top.name)}</h2>
    `;

    // Size display (single or current selection)
    if (top.kind === "product") {
      const size = top.size;
      if (size) {
        const sizeEl = document.createElement("span");
        sizeEl.className = "result__size";
        sizeEl.textContent = `${size.value} ${size.unit}`;
        body.appendChild(sizeEl);
      }
    } else if (top.single_variant && top.selected_product) {
      const sizeEl = document.createElement("span");
      sizeEl.className = "result__size";
      const s = top.selected_product.size;
      sizeEl.textContent = `${s.value} ${s.unit}`;
      body.appendChild(sizeEl);
    }

    // Score block
    const scoreBlock = document.createElement("div");
    scoreBlock.className = "result__score";
    scoreBlock.innerHTML = `
      <span class="result__score-number">${top.display_percent}<sup>%</sup></span>
      <span class="result__score-text">
        <strong>${escapeHtml(uiCopy.scoreLabel)}</strong>
        <span>${escapeHtml(uiCopy.scoreCaption)}</span>
      </span>
    `;
    body.appendChild(scoreBlock);

    if (top.band && top.band.label) {
      const band = document.createElement("span");
      band.className = "result__band";
      band.textContent = top.band.label;
      body.appendChild(band);
    }

    // Description
    if (top.description_short) {
      const d = document.createElement("p");
      d.className = "result__description";
      d.textContent = top.description_short;
      body.appendChild(d);
    }

    // Reasons
    if (rec.reasons && rec.reasons.length) {
      const ul = document.createElement("ul");
      ul.className = "result__reasons";
      rec.reasons.forEach((r) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${escapeHtml(r.text)}</span>`;
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    // Benefits (weight=0 personalisation)
    if (rec.benefits && rec.benefits.length) {
      const wrap = document.createElement("div");
      wrap.className = "result__benefit";
      wrap.innerHTML = `<strong>${escapeHtml(uiCopy.benefitLabel)}:</strong> ${rec.benefits.map(escapeHtml).join(" · ")}`;
      body.appendChild(wrap);
    }

    // Joint winner note
    if (rec.joint_winner) {
      const jt = document.createElement("div");
      jt.className = "result__benefit";
      jt.innerHTML = `<strong>${escapeHtml(uiCopy.jointTitle)}.</strong> ${rec.top.map((t) => escapeHtml(t.name)).join(" · ")}`;
      body.appendChild(jt);
    }

    // Variant picker (perfume only)
    if (top.kind === "fragrance" && !top.single_variant) {
      body.appendChild(buildVariantPicker(top));
    }

    // Buy + actions
    body.appendChild(buildPrimaryActions(top));

    card.appendChild(media);
    card.appendChild(body);
    return card;
  }

  function buildVariantPicker(entry) {
    const wrap = document.createElement("div");
    wrap.className = "variant-picker";
    wrap.innerHTML = `
      <span class="variant-picker__label">${escapeHtml(entry.variant_label || "Bước cuối: Chọn dung tích bạn muốn mua")}</span>
      <div class="variant-picker__options" role="group" aria-label="Chọn dung tích"></div>
      <span class="variant-picker__hint">Vui lòng chọn dung tích (9ml hoặc 50ml) để mở nút mua hàng TikTok Shop.</span>
    `;
    const list = wrap.querySelector(".variant-picker__options");
    const hint = wrap.querySelector(".variant-picker__hint");
    entry.variant_products.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "variant-picker__option";
      btn.dataset.productId = p.id;
      const isSel = !!(entry.selected_product && entry.selected_product.id === p.id);
      btn.setAttribute("aria-pressed", isSel ? "true" : "false");
      if (isSel) btn.classList.add("is-selected");

      const badge = p.size.value === 9 ? " (Bỏ túi)" : (p.size.value === 50 ? " (Chai lớn)" : "");
      btn.textContent = `${p.size.value} ${p.size.unit}${badge}`;
      btn.addEventListener("click", () => {
        // visual
        $$(".variant-picker__option", list).forEach((el) => {
          const sel = el.dataset.productId === p.id;
          el.classList.toggle("is-selected", sel);
          el.setAttribute("aria-pressed", sel ? "true" : "false");
        });
        DynikScoring.selectVariant(state.cfg, entry, p.id);
        hint.textContent = `Đã chọn chai ${p.size.value} ${p.size.unit}. Bấm nút mua ngay bên dưới để mở TikTok Shop:`;

        // update preview image: if this product has an image_url, show it; otherwise clear
        const media = $(".result__media");
        const preview = DynikAssets.productImage(p);
        renderMedia(media, preview.src, preview.alt, preview.isMissing, preview.fallbackSrc);

        // update size label
        const sizeEl = $(".result__size");
        if (sizeEl) sizeEl.textContent = `${p.size.value} ${p.size.unit}`;

        // update buy button
        updateBuyButtonForEntry(entry);
        renderStickyBuy();

        // update combos
        updateCombosForEntry(entry);
      });
      list.appendChild(btn);
    });
    return wrap;
  }

  function buildPrimaryActions(entry) {
    const actions = document.createElement("div");
    actions.className = "result__actions";
    actions.appendChild(buildBuyButton(entry));
    const secondaryWrap = document.createElement("div");
    secondaryWrap.className = "result__actions-secondary";

    const retake = document.createElement("button");
    retake.type = "button";
    retake.className = "btn btn--ghost";
    retake.textContent = uiCopy.retake;
    retake.addEventListener("click", () => {
      trackEvent("retake", { category_id: state.categoryId });
      startQuiz(state.categoryId);
    });
    secondaryWrap.appendChild(retake);

    const change = document.createElement("button");
    change.type = "button";
    change.className = "btn btn--ghost";
    change.textContent = uiCopy.changeCategory;
    change.addEventListener("click", () => {
      trackEvent("change_category", { category_id: state.categoryId });
      renderCategories();
    });
    secondaryWrap.appendChild(change);

    actions.appendChild(secondaryWrap);

    return actions;
  }

  function buildBuyButton(entry) {
    const btn = document.createElement("a");
    btn.className = "btn btn--primary";
    btn.textContent = uiCopy.buy;
    btn.setAttribute("rel", "noopener noreferrer");
    updateBuyButtonForEntry(btn, entry);
    return btn;
  }

  function updateBuyButtonForEntry(entryOrBtn, entryArg) {
    let entry, buttons;
    if (entryArg) {
      buttons = [entryOrBtn];
      entry = entryArg;
    } else {
      entry = entryOrBtn;
      buttons = [$(".result__actions .btn--primary"), $("#sticky-buy .btn--primary")].filter(Boolean);
    }
    if (!buttons.length) return;
    let target = null;
    let enabled = false;
    if (entry.kind === "fragrance") {
      if (entry.single_variant) {
        target = entry.selected_product;
        enabled = true;
      } else {
        target = entry.selected_product;
        enabled = !!target;
      }
    } else {
      target = entry;
      enabled = true;
    }

    buttons.forEach((btn) => {
      if (enabled && target && target.purchase_url) {
        btn.style.display = "";
        btn.href = target.purchase_url;
        btn.target = "_blank";
        btn.removeAttribute("aria-disabled");
        btn.classList.remove("is-disabled");
        btn.textContent = target.size
          ? `Mua ngay chai ${target.size.value}${target.size.unit} trên TikTok Shop`
          : uiCopy.buy;
        btn.onclick = () => trackEvent("buy_clicked", {
          category_id: state.categoryId,
          product_id: target.id,
          recommendation_id: entry.recommendation_id,
        });
      } else {
        // If it requires variant selection and not chosen yet, hide the button completely!
        if (entry.kind === "fragrance" && !entry.single_variant) {
          btn.style.display = "none";
        } else {
          btn.style.display = "";
        }
        btn.removeAttribute("href");
        btn.removeAttribute("target");
        btn.setAttribute("aria-disabled", "true");
        btn.classList.add("is-disabled");
        btn.textContent = "Vui lòng chọn dung tích";
        btn.onclick = (e) => e.preventDefault();
      }
    });
  }

  function updateStickyVisibility() {
    const sticky = $("#sticky-buy");
    if (!sticky) return;
    const isResultActive = $("#screen-result") && $("#screen-result").classList.contains("is-active");
    if (!isResultActive || !state.recommendation) {
      sticky.classList.remove("is-visible");
      return;
    }
    const top = state.recommendation.top[0];
    if (!top || (top.kind === "fragrance" && !top.single_variant && !top.selected_product)) {
      sticky.classList.remove("is-visible");
      return;
    }

    const mainActions = $(".result__actions");
    if (!mainActions) {
      sticky.classList.remove("is-visible");
      return;
    }

    const rect = mainActions.getBoundingClientRect();
    // When the in-page main buy button is in the viewport, HIDE the sticky buy button!
    // Ensures only 1 buy button is EVER visible on screen at a time.
    const isMainButtonVisible = rect.top < window.innerHeight && rect.bottom > 0;
    
    // Only show sticky bar if user has scrolled PAST the in-page button (it is above the viewport)
    if (!isMainButtonVisible && rect.bottom <= 0) {
      sticky.classList.add("is-visible");
    } else {
      sticky.classList.remove("is-visible");
    }
  }

  function renderStickyBuy() {
    const sticky = $("#sticky-buy");
    if (!sticky) return;
    const rec = state.recommendation;
    const isResultActive = $("#screen-result") && $("#screen-result").classList.contains("is-active");
    if (!rec || !isResultActive) {
      sticky.classList.remove("is-visible");
      sticky.innerHTML = "";
      return;
    }
    const top = rec.top[0];
    if (!top || (top.kind === "fragrance" && !top.single_variant && !top.selected_product)) {
      sticky.classList.remove("is-visible");
      sticky.innerHTML = "";
      return;
    }
    sticky.innerHTML = "";
    const btn = buildBuyButton(top);
    btn.classList.add("btn--full");
    sticky.appendChild(btn);

    updateStickyVisibility();
  }

  window.addEventListener("scroll", updateStickyVisibility, { passive: true });
  window.addEventListener("resize", () => {
    renderStickyBuy();
    updateStickyVisibility();
  });

  function buildAlternativeBlock(alt, rec) {
    const wrap = document.createElement("section");
    wrap.className = "result__alt";
    wrap.innerHTML = `
      <h3 class="result__alt-title">${escapeHtml(uiCopy.nearTieTitle)}</h3>
      <div class="result__alt-list"></div>
    `;
    const list = wrap.querySelector(".result__alt-list");
    list.appendChild(buildAltItem(alt));
    return wrap;
  }

  function buildAltItem(entry) {
    const item = document.createElement("div");
    item.className = "result__alt-item";
    const thumb = document.createElement("div");
    thumb.className = "result__alt-thumb";
    if (entry.kind === "fragrance") {
      const preview = entry.single_variant
        ? DynikAssets.productImage(entry.selected_product || entry.variant_products[0])
        : DynikAssets.defaultSelectedImageForFragrance(entry);
      if (preview && preview.src) {
        const img = document.createElement("img");
        img.src = preview.src;
        img.alt = preview.alt || entry.name;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = `<span style="font-size:11px;color:var(--text-dim);text-align:center;padding:6px">${escapeHtml(entry.name)}</span>`;
      }
    } else {
      const img = DynikAssets.productImage(entry);
      if (!img.isMissing) {
        const im = document.createElement("img");
        im.src = img.src;
        im.alt = img.alt;
        thumb.appendChild(im);
      } else {
        thumb.innerHTML = `<span style="font-size:11px;color:var(--text-dim);text-align:center;padding:6px">${escapeHtml(entry.name)}</span>`;
      }
    }

    const txt = document.createElement("div");
    const name = document.createElement("p");
    name.className = "result__alt-name";
    name.textContent = entry.name + (entry.kind === "fragrance" && entry.selected_product ? ` · ${entry.selected_product.size.value}${entry.selected_product.size.unit}` : "");
    const score = document.createElement("p");
    score.className = "result__alt-score";
    score.textContent = `${uiCopy.scoreLabel}: ${entry.display_percent}%`;

    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "btn btn--solid-dark";
    buy.style.marginTop = "6px";
    buy.textContent = "Chọn mùi này";
    buy.addEventListener("click", () => {
      // swap recommendation to alt entry
      state.recommendation = {
        ...state.recommendation,
        top: [entry],
        alternative: null,
      };
      renderResult(state.recommendation);
    });

    txt.appendChild(name);
    txt.appendChild(score);
    if (entry.kind === "fragrance" && !entry.single_variant) {
      const hint = document.createElement("p");
      hint.className = "result__alt-score";
      hint.textContent = "Chọn thêm dung tích để xem link mua.";
      txt.appendChild(hint);
    }
    txt.appendChild(buy);

    item.appendChild(thumb);
    item.appendChild(txt);
    return item;
  }

  function buildLowMatchNotice(rec) {
    const div = document.createElement("div");
    div.className = "status-banner";
    div.style.marginTop = "16px";
    div.innerHTML = `
      <h2>${escapeHtml(rec.low_match_policy.title || "Gu của bạn khá đa dạng")}</h2>
      <p>${escapeHtml(rec.low_match_policy.message || "")}</p>
      <p style="font-size:12px;color:var(--text-dim)">Điểm hiện tại: ${rec.all_scores.slice(0, 6).map((s) => `${s.id} ${Math.round(s.raw_percent)}%`).join(" · ")}</p>
    `;
    return div;
  }

  /* ----------------------------------------------------------
   * Combos (compact, with product combo images from XLSX/anhdoiy)
   * ---------------------------------------------------------- */
  function findCombosForEntry(entry) {
    if (!state.combos || !state.combos.length || !entry) return [];
    const targetIds = new Set();
    if (entry.kind === "product") {
      if (entry.id) targetIds.add(entry.id);
      if (entry.product_id) targetIds.add(entry.product_id);
    } else if (entry.kind === "fragrance") {
      if (entry.selected_product && entry.selected_product.id) {
        targetIds.add(entry.selected_product.id);
      }
      if (Array.isArray(entry.variant_products)) {
        entry.variant_products.forEach((p) => {
          if (p && p.id) targetIds.add(p.id);
        });
      }
      if (entry.id) targetIds.add(entry.id);
      if (entry.profile_id) targetIds.add(entry.profile_id);
      if (entry.recommendation_id) targetIds.add(entry.recommendation_id);
    }

    return state.combos.filter((combo) => {
      return (
        Array.isArray(combo.associated_product_ids) &&
        combo.associated_product_ids.some((pid) => targetIds.has(pid))
      );
    });
  }

  function buildComboSection(entry) {
    const combos = findCombosForEntry(entry);
    if (!combos || combos.length === 0) return null;

    const section = document.createElement("section");
    section.className = "result__combos";
    section.setAttribute("aria-label", "Combo ưu đãi liên quan");
    section.innerHTML = `
      <div class="result__combos-header">
        <span class="result__combos-badge">Ưu đãi</span>
        <h3 class="result__combos-title">Combo tiết kiệm cùng mùi hương này</h3>
      </div>
      <ul class="result__combos-list"></ul>
    `;

    const list = section.querySelector(".result__combos-list");
    combos.forEach((c) => {
      const li = document.createElement("li");
      li.className = "result__combo-item";
      li.innerHTML = `
        <a href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer" class="result__combo-link">
          ${c.image ? `
            <span class="result__combo-thumb">
              <img src="${escapeHtml(c.image)}" alt="" loading="lazy" />
            </span>
          ` : ""}
          <span class="result__combo-info">
            <span class="result__combo-name">${escapeHtml(c.name)}</span>
          </span>
          <span class="result__combo-action">
            <span>Mua combo</span>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </span>
        </a>
      `;
      li.querySelector("a").addEventListener("click", () => {
        trackEvent("combo_clicked", { combo_name: c.name, link: c.link });
      });
      list.appendChild(li);
    });

    return section;
  }

  function updateCombosForEntry(entry) {
    const existing = $(".result__combos");
    const newSection = buildComboSection(entry);
    if (existing) {
      if (newSection) {
        existing.replaceWith(newSection);
      } else {
        existing.remove();
      }
    } else if (newSection) {
      const primary = $(".result");
      if (primary && primary.parentNode) {
        primary.parentNode.insertBefore(newSection, primary.nextSibling);
      }
    }
  }

  function buildResultActions() {
    // primary actions live inside the card; this is a top-level footer block
    return document.createDocumentFragment();
  }

  /* ----------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------- */
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMedia(media, src, alt, isMissing, fallbackSrc) {
    media.innerHTML = "";
    if (!src || isMissing) {
      media.classList.add("is-missing");
      const fb = document.createElement("div");
      fb.className = "result__media-fallback";
      fb.innerHTML = `Ảnh sản phẩm DYNIK<br/><strong style="color:var(--text)">${escapeHtml(alt)}</strong>`;
      media.appendChild(fb);
      const wrap = document.createElement("div");
      wrap.style.opacity = "0.22";
      wrap.style.width = "70%";
      wrap.style.maxWidth = "240px";
      wrap.innerHTML = `<img alt="" src="${DynikAssets.categoryPackshot(state.categoryId)}">`;
      media.appendChild(wrap);
      return;
    }
    media.classList.remove("is-missing");
    const img = document.createElement("img");
    img.className = "result__media-img";
    img.src = src;
    img.alt = alt || "Sản phẩm DYNIK";
    img.loading = "eager";
    img.addEventListener("error", () => {
      if (fallbackSrc && img.src !== fallbackSrc) {
        img.src = fallbackSrc;
      } else {
        media.classList.add("is-missing");
        img.remove();
        renderMedia(media, null, alt, true);
      }
    });
    media.appendChild(img);
  }

  function trackEvent(name, payload) {
    // analytics hook — silent no-op until a provider is wired in.
    try {
      const evt = { event: name, ts: Date.now(), ...payload };
      if (Array.isArray(state.cfg && state.cfg.design_rationale && state.cfg.design_rationale.measurement && state.cfg.design_rationale.measurement.events)) {
        // list understood but not enforced at runtime
      }
      if (window.console && console.debug) console.debug("[dynik:event]", evt);
    } catch (_) { /* noop */ }
  }
})();

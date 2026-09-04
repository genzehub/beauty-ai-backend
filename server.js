function concernScore(product, category, concern) {
  if (!concern) return 0;

  const key = clean(concern).replace(/ /g, "-");

  const text = productText(product);

  const strongText = clean(
    [
      product.title,
      product.productType,
      ...(product.tags || [])
    ].join(" ")
  );

  const full = ` ${text} `;
  const strong = ` ${strongText} `;

  const has = (term) =>
    full.includes(` ${clean(term)} `);

  const hasStrong = (term) =>
    strong.includes(` ${clean(term)} `);

  const hasAny = (terms) =>
    terms.some((term) => has(term));

  const hasAnyStrong = (terms) =>
    terms.some((term) => hasStrong(term));


  /* =====================================================
     1. MAKEUP — POWDER / COMPACT
     BLOCK BAKING POWDER CLEANSERS
  ===================================================== */

  if (category === "makeup" && key === "powder") {

    const blocked = [
      "foam",
      "cleanser",
      "cleansing",
      "face wash",
      "baking powder",
      "wash",
      "soap"
    ];

    if (hasAny(blocked)) {
      return 0;
    }

    const realPowderTerms = [
      "makeup powder",
      "face powder",
      "loose powder",
      "setting powder",
      "pressed powder",
      "compact",
      "powder pact",
      "fix powder"
    ];

    const productType = clean(product.productType);

    const realPowder =
      productType.includes("powder") ||
      hasAnyStrong(realPowderTerms);

    if (!realPowder) {
      return 0;
    }

    return 28;
  }


  /* =====================================================
     2. HAIR FALL
  ===================================================== */

  if (category === "haircare" && key === "hair-fall") {

    return [
      "hair fall",
      "hair loss",
      "anti hair loss",
      "thickening",
      "strengthening"
    ].some(has)
      ? 24
      : 0;
  }


  /* =====================================================
     3. DANDRUFF

     Exact dandruff products preferred.
     Scalp-care shampoo allowed as fallback.
  ===================================================== */

  if (category === "haircare" && key === "dandruff") {

    if (
      [
        "hair loss",
        "anti hair loss",
        "thickening",
        "strengthening"
      ].some(has)
    ) {
      return 0;
    }

    if (
      [
        "dandruff",
        "anti dandruff",
        "anti-dandruff",
        "flaky scalp",
        "flake"
      ].some(has)
    ) {
      return 30;
    }

    const scalpShampoo =
      (
        hasStrong("scalp care") ||
        hasStrong("scalp")
      ) &&
      hasStrong("shampoo");

    if (scalpShampoo) {
      return 14;
    }

    return 0;
  }


  /* =====================================================
     4. DRY HAIR

     Allows actual hair moisture / nourishing products.
  ===================================================== */

  if (category === "haircare" && key === "dry") {

    if (
      [
        "foot",
        "feet",
        "heel",
        "face cream",
        "body lotion"
      ].some(has)
    ) {
      return 0;
    }

    const productType = clean(product.productType);

    const hairEvidence =
      productType.includes("hair") ||
      [
        "hair",
        "shampoo",
        "conditioner",
        "scalp",
        "hair mask",
        "hair treatment"
      ].some(hasStrong);

    if (!hairEvidence) {
      return 0;
    }

    if (
      [
        "dry hair",
        "dry scalp",
        "hydrating hair",
        "moisturizing hair"
      ].some(has)
    ) {
      return 30;
    }

    if (
      [
        "moisture",
        "moisturizing",
        "hydrating",
        "nourishing",
        "conditioning",
        "ceramide",
        "repair"
      ].some(has)
    ) {
      return 14;
    }

    return 0;
  }


  /* =====================================================
     OILY SCALP
  ===================================================== */

  if (category === "haircare" && key === "oily") {

    if (
      [
        "foot",
        "feet",
        "heel",
        "hair loss",
        "thickening"
      ].some(has)
    ) {
      return 0;
    }

    if (
      [
        "oily scalp",
        "oily hair",
        "excess sebum",
        "sebum control"
      ].some(has)
    ) {
      return 24;
    }

    const scalpShampoo =
      (
        hasStrong("scalp care") ||
        hasStrong("scalp")
      ) &&
      hasStrong("shampoo");

    if (scalpShampoo) {
      return 10;
    }

    return 0;
  }


  /* =====================================================
     DAMAGED HAIR
  ===================================================== */

  if (category === "haircare" && key === "damaged") {

    const productType = clean(product.productType);

    const hairEvidence =
      productType.includes("hair") ||
      [
        "hair",
        "shampoo",
        "conditioner",
        "hair treatment",
        "hair mask"
      ].some(hasStrong);

    if (!hairEvidence) {
      return 0;
    }

    if (
      [
        "damaged hair",
        "damage care",
        "hair repair",
        "repair treatment",
        "protein treatment",
        "keratin"
      ].some(has)
    ) {
      return 28;
    }

    return 0;
  }


  /* =====================================================
     5. FRAGRANCE

     IMPORTANT:
     Must be an ACTUAL fragrance product.

     Blocks:
     hand cream
     perfume shower
     shampoo
     conditioner
     body wash
     etc.
  ===================================================== */

  if (category === "fragrance") {

    const blockedFragranceFalseMatches = [
      "hand cream",
      "body lotion",
      "body cream",
      "body wash",
      "shower gel",
      "perfume shower",
      "shampoo",
      "conditioner",
      "hair treatment",
      "treatment",
      "hair mask",
      "cleanser",
      "cleansing",
      "soap"
    ];

    if (hasAnyStrong(blockedFragranceFalseMatches)) {
      return 0;
    }

    const productType = clean(product.productType);

    const fragranceSignals = [
      "perfume",
      "parfum",
      "eau de parfum",
      "eau de toilette",
      "edp",
      "edt",
      "body mist",
      "fragrance"
    ];

    const realFragrance =
      productType.includes("fragrance") ||
      productType.includes("perfume") ||
      hasAnyStrong(fragranceSignals);

    if (!realFragrance) {
      return 0;
    }

    const terms =
      (CONCERNS[category] || {})[key] || [];

    let score = 0;

    for (const term of terms) {

      if (hasStrong(term)) {
        score += 16;

      } else if (has(term)) {
        score += 5;
      }
    }

    return score;
  }


  /* =====================================================
     DEFAULT
     SKINCARE + OTHER MAKEUP CONCERNS
  ===================================================== */

  const terms =
    (CONCERNS[category] || {})[key] || [];

  let score = 0;

  for (const term of terms) {

    if (hasStrong(term)) {
      score += 12;

    } else if (has(term)) {
      score += 4;
    }
  }

  return score;
}

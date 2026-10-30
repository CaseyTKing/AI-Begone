/*
 * Google Search selectors and label text: the ONLY place to edit when Google
 * changes its markup. See README "Updating selectors and label text".
 *
 * Preference order for identifying things:
 *   1. stable attributes (aria-*, role, data-*, jsname, href params)
 *   2. localized label text (exact match, keyed by <html lang>)
 *   3. class names (last resort; obfuscated and change often)
 *
 * Label text is matched exactly after normalisation (case, whitespace,
 * NFKC, curly quotes/dashes), never by substring.
 */
(function () {
  'use strict';

  const NoAI = (globalThis.NoAI = globalThis.NoAI || {});
  NoAI.config = NoAI.config || {};

  NoAI.config.google = {
    version: 1,
    // Date the selectors/labels below were last checked against live Google.
    // Bump `version` and this date whenever you re-verify or change them.
    // NOTE: v1 values were checked against the synthetic fixtures only, not
    // live Google. Re-verify on live pages and update this date.
    lastVerified: '2026-10-12',

    pages: {
      // /search?udm=2 or /search?tbm=isch -> Google Images
      images: { udm: ['2'], tbm: ['isch'] },
      // Pages left completely alone (udm=50 is AI Mode itself).
      skip: { udm: ['50'] },
    },

    // Containers to observe, in order of preference. Empty -> <body>.
    roots: {
      web: ['#main', '#cnt', '#rcnt'],
      // The image viewer panel may render outside the results container.
      images: [],
      other: ['#main', '#cnt'],
    },

    overview: {
      // Flash guard. Elements matching these are hidden from first paint until
      // the rules verify them (label found -> stays hidden behind the button;
      // not found within pendingTimeoutMs -> shown). Class names, last resort.
      // KEEP IN SYNC with the overview block in styles.css (tests/check.js
      // enforces this).
      candidateSelectors: ['div.hdzaWe', 'div.YzCcne'],
      pendingTimeoutMs: 1000,

      // Where the "AI Overview" heading can be. Headings inside links are
      // ignored (that's an organic result title, not the module heading).
      headingSelectors: ['h1', 'h2', '[role="heading"]', '[role="region"][aria-label]'],

      // From the heading we climb to the ancestor that is a direct child of
      // one of these result columns; that ancestor is the overview block.
      columnSelectors: [
        '#rso',
        '#center_col',
        '#rcnt',
        '#search',
        '#taw',
        '#topstuff',
        '#botstuff',
        '[role="main"]',
        'main',
      ],
      maxClimb: 25,

      // The block we hide must contain none of these (organic results, ads,
      // whole columns). If it does, we hide nothing.
      mustNotContain: [
        '#rso',
        '#search',
        '#tads',
        '#bottomads',
        '#botstuff',
        'div.g',
        'a h3',
        '[data-noai-ui]',
      ],

      labels: {
        en: ['AI Overview', 'AI Overviews'],
        de: ['Übersicht mit KI', 'KI-Übersicht'],
        fr: ['Aperçu IA', "Aperçu de l'IA", 'Aperçus IA'],
        es: ['Vista creada con IA', 'Resumen creado con IA', 'Resumen de IA'],
        it: ['Panoramica AI', 'Panoramica IA', "Panoramica creata con l'AI"],
        pt: ['Visão geral criada por IA', 'Visão geral de IA', 'Resumo de IA'],
        nl: ['AI-overzicht'],
        ja: ['AI による概要'],
        hi: ['एआई से मिली खास जानकारी', 'AI से मिली खास जानकारी'],
      },
    },

    aiMode: {
      // Regions that hold the search box and the vertical tabs. The AI Mode
      // control is only ever hidden inside one of these.
      regionSelectors: [
        '#searchform',
        'form[role="search"]',
        '#top_nav',
        '#hdtb',
        '#hdtb-msb',
        '[role="navigation"]',
      ],
      // Stable: AI Mode is /search?udm=50. Match the exact param (not udm=500).
      // KEEP IN SYNC with the AI Mode block in styles.css.
      linkSelectors: ['a[href*="udm=50&"]', 'a[href$="udm=50"]'],
      // Elements whose own text may be the AI Mode label.
      labelElementSelectors: ['a', 'button', '[role="link"]', '[role="button"]', '[role="tab"]'],
      // If the control sits in one of these and it's the only control there,
      // hide the wrapper so no empty slot is left behind.
      itemSelectors: ['[role="listitem"]', 'li'],
      labels: {
        en: ['AI Mode'],
        de: ['KI-Modus', 'AI-Modus'],
        fr: ['Mode IA'],
        es: ['Modo IA'],
        it: ['Modalità AI', 'Modalità IA'],
        pt: ['Modo IA'],
        nl: ['AI-modus'],
        ja: ['AI モード'],
        hi: ['एआई मोड', 'AI मोड'],
      },
    },

    images: {
      // One result card in the grid, most specific first. Hiding collapses
      // the card, so this must be the element that occupies the grid slot.
      gridItemSelectors: [
        'div[jsname="dTDiAc"]', // udm=2 result card
        'div.isv-r', // legacy tbm=isch card (class, last resort)
        'div[data-lpage]',
        'div[data-ri]',
        // Not div[data-docid]: the detail panel carries it too.
      ],
      // The thumbnail inside a card (first match wins, else largest <img>).
      thumbSelectors: ['img[jsname="Q4LuWd"]', 'g-img img', 'img.YQ4gaf'],

      // The image detail/preview panel.
      panelSelectors: ['[role="dialog"]', '[aria-modal="true"]', '#Sva75c', '#islsp'],
      // The main image in the panel (first match wins, else largest <img>).
      panelImageSelectors: ['img[jsname="kn3ccd"]', 'img[jsname="HiaYvf"]', 'img.sFlh5c', 'img.iPVvYb', 'img.n3VNCb'],
      panelMinImageSize: 80,

      // Attributes shared by a panel and its grid card, used to apply a
      // panel-only label to the matching thumbnail. URL params too.
      linkAttributes: ['data-docid', 'data-tbnid', 'data-id'],
      linkUrlParams: ['imgrc', 'vhid'],

      // Labels can be visible text or an accessible name on a badge.
      labelAttributes: ['aria-label', 'title'],
      maxLabelLength: 60,

      // Whether to apply domain-based detection (uses ai-image-sources.js).
      domainDetection: true,
      // Whether to apply keyword detection in alt/title/aria-label (uses ai-image-sources.js).
      keywordDetection: true,
      // Attributes scanned for keyword matches. Machine-readable only — NOT
      // free-form text content — to keep false positives low.
      keywordAttributes: ['alt', 'title', 'aria-label', 'data-tooltip'],

      // Terms appended to the search query when imageQueryExclude is enabled.
      // Only missing terms are added; existing ones are left as-is.
      queryExcludeTerms: ['-midjourney', '-"stable diffusion"', '-"dall-e"', '-"ai generated"'],

      // Only labels Google itself shows for AI-generated images, including
      // the AI-specific Content Credentials (C2PA) wording. A Content
      // Credentials icon alone does NOT mean AI-generated and is ignored.
      labels: {
        en: ['AI-generated', 'AI generated', 'Generated with AI', 'Made with Google AI', 'Created with Google AI'],
        de: ['KI-generiert', 'Mit KI generiert', 'Mit Google AI erstellt', 'Mit Google KI erstellt'],
        fr: ['Généré par IA', "Généré par l'IA", "Créé avec l'IA de Google"],
        es: ['Generado por IA', 'Generado con IA', 'Creado con la IA de Google'],
        it: ["Generato dall'IA", "Generato con l'IA", 'Generato con AI', "Creato con l'AI di Google"],
        pt: ['Gerado por IA', 'Gerado com IA', 'Criado com a IA do Google'],
        nl: ['Gegenereerd door AI', 'Gegenereerd met AI', 'Gemaakt met Google AI'],
        ja: ['AI 生成', 'AI により生成', 'Google AI で作成'],
        hi: ['एआई से जनरेट किया गया', 'AI से जनरेट किया गया', 'Google AI से बनाया गया'],
      },
    },

    ui: {
      showOverview: 'Show AI Overview',
      hideOverview: 'Hide AI Overview',
      showImage: 'AI-generated · Show anyway',
      showImageAria: 'AI-generated image, blurred. Show anyway',
    },
  };
})();

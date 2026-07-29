/**
 * card-art.js — Haarlem Hold'em card face texture generator
 *
 * Draws a card face onto a canvas, built exactly to the geometry in
 * card-art-spec.md so it stays compatible with the V7.2 squeeze mechanic's
 * curl (buildCurlableCard / makeFaceTexture). If you change any of the
 * FIXED numbers below, the index will curl into blank card stock instead
 * of showing the rank/suit — see the spec doc before touching those.
 *
 * Usage:
 *   const canvas = CardArt.renderFace('A', 'spades', 512);
 *   const texture = new THREE.CanvasTexture(canvas);
 *   texture.flipY = false; // required — see spec
 */
(function (global) {
  'use strict';

  // ---- FIXED (spec-locked) geometry — do not change ------------------
  const MARGIN_PCT = 0.008;   // 0.8% of canvas size
  const RANK_SIZE_PCT = 0.09; // 9%
  const SUIT_SIZE_PCT = 0.065; // 6.5%
  const GAP_PCT = 0.012;      // 1.2%
  const BLOCK_HEIGHT_MULT = 1.15;
  const ASPECT_W = 1.4;
  const ASPECT_H = 2.0; // 0.7 : 1

  // ---- FLEXIBLE (design) choices — safe to restyle --------------------
  const FACE_BG = '#f3ecd8';      // warm ivory / parchment (Haarlem Back family)
  const BLACK_SUIT_COLOR = '#1a2740'; // deep cobalt-black, not pure black
  const RED_SUIT_COLOR = '#8c1d2b';   // muted burgundy, not bright red
  const GOLD = '#c9a84c';
  const FONT_FAMILY = "'Montserrat', -apple-system, sans-serif";

  const SUITS = {
    spades:   { symbol: '\u2660', color: BLACK_SUIT_COLOR },
    clubs:    { symbol: '\u2663', color: BLACK_SUIT_COLOR },
    hearts:   { symbol: '\u2665', color: RED_SUIT_COLOR },
    diamonds: { symbol: '\u2666', color: RED_SUIT_COLOR },
  };

  function measureBlock(ctx, rankText, suitSymbol, rankSize, suitSize, gap) {
    ctx.font = `700 ${rankSize}px ${FONT_FAMILY}`;
    const rankWidth = ctx.measureText(rankText).width;
    ctx.font = `700 ${suitSize}px ${FONT_FAMILY}`;
    const suitWidth = ctx.measureText(suitSymbol).width;
    return {
      rankWidth, suitWidth,
      blockWidth: rankWidth + gap + suitWidth,
      blockHeight: Math.max(rankSize, suitSize) * BLOCK_HEIGHT_MULT,
    };
  }

  // Draws rank+suit left-to-right, top-aligned, in LOCAL space starting at (0,0).
  function drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap) {
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;

    ctx.font = `700 ${rankSize}px ${FONT_FAMILY}`;
    ctx.fillText(rankText, 0, 0);
    const rankWidth = ctx.measureText(rankText).width;

    ctx.font = `700 ${suitSize}px ${FONT_FAMILY}`;
    ctx.fillText(suitSymbol, rankWidth + gap, 0);
  }

  function drawIndices(ctx, size, rankText, suitSymbol, color) {
    const m = size * MARGIN_PCT;
    const rankSize = size * RANK_SIZE_PCT;
    const suitSize = size * SUIT_SIZE_PCT;
    const gap = size * GAP_PCT;
    const { blockWidth, blockHeight } = measureBlock(ctx, rankText, suitSymbol, rankSize, suitSize, gap);

    // Top-left — upright, no transform.
    ctx.save();
    ctx.translate(m, m);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    // Top-right — upright.
    ctx.save();
    ctx.translate(size - m - blockWidth, m);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    // Bottom-left — vertical-only flip (scale Y by -1), NOT a full mirror.
    // Rank/suit keep normal left-to-right order; only up/down flips.
    ctx.save();
    ctx.translate(m, size - m - blockHeight + blockHeight);
    ctx.scale(1, -1);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    // Bottom-right — vertical-only flip.
    ctx.save();
    ctx.translate(size - m - blockWidth, size - m - blockHeight + blockHeight);
    ctx.scale(1, -1);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();
  }

  // Subtle center motif — flat gold, no gradient/shadow (curl needs flat shading).
  // Kept well clear of all four index corners.
  function drawCenterMotif(ctx, size, suitSymbol, color) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.font = `700 ${size * 0.32}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suitSymbol, size / 2, size / 2);
    ctx.restore();

    // thin gold frame, inset well past the index margin zone
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, size * 0.004);
    const inset = size * 0.14;
    ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    ctx.restore();
  }

  function renderFace(rank, suit, size = 512) {
    const suitDef = SUITS[suit];
    if (!suitDef) throw new Error(`Unknown suit: ${suit}`);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Flat, evenly-lit fill — no gradients/shadows (would look broken once curled).
    ctx.fillStyle = FACE_BG;
    ctx.fillRect(0, 0, size, size);

    drawCenterMotif(ctx, size, suitDef.symbol, suitDef.color);
    drawIndices(ctx, size, String(rank), suitDef.symbol, suitDef.color);

    return canvas;
  }

  function renderBack(size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#BE1622';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = size * 0.02;
    const inset = size * 0.06;
    ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = GOLD;
    ctx.globalAlpha = 0.9;
    ctx.font = `700 ${size * 0.3}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2666', size / 2, size / 2);
    ctx.restore();

    return canvas;
  }

  // Bold, fully-opaque variant of renderFace — for contexts that need the
  // card instantly readable at a glance (the phone's hold-to-peek), rather
  // than the original's deliberately subtle center motif (0.16 alpha, tuned
  // for the 3D squeeze demo's curl reveal, where a dramatic gradual unveil
  // is the whole point). This is a SEPARATE function so index.html's frozen
  // squeeze demo keeps its original look untouched.
  function drawCenterMotifBold(ctx, size, suitSymbol, color) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = `700 ${size * 0.42}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suitSymbol, size / 2, size / 2);
    ctx.restore();
  }

  // Bigger index sizing for the bold phone variant — genuinely larger
  // percentages, not just a bigger source canvas (which doesn't change the
  // proportion at all). Kept separate from drawIndices/the constants above
  // so the frozen squeeze demo's sizing is completely unaffected.
  function drawIndicesBold(ctx, size, rankText, suitSymbol, color) {
    const m = size * 0.02;
    const rankSize = size * 0.16;
    const suitSize = size * 0.12;
    const gap = size * 0.012;
    const { blockWidth, blockHeight } = measureBlock(ctx, rankText, suitSymbol, rankSize, suitSize, gap);

    ctx.save();
    ctx.translate(m, m);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    ctx.save();
    ctx.translate(size - m - blockWidth, m);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    // Bottom corners: upright, same as the top ones. Real cards flip the
    // bottom index so it's readable from either end when physically
    // rotated in your hand — but a flat phone screen is always viewed from
    // one fixed angle, so there's no "other end" to serve. Upright is
    // simply correct here, not a physical-card convention to replicate.
    ctx.save();
    ctx.translate(m, size - m - blockHeight + size * 0.02);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();

    ctx.save();
    ctx.translate(size - m - blockWidth, size - m - blockHeight + size * 0.02);
    drawBlock(ctx, rankText, suitSymbol, color, rankSize, suitSize, gap);
    ctx.restore();
  }

  function renderFaceBold(rank, suit, size = 512) {
    const suitDef = SUITS[suit];
    if (!suitDef) throw new Error(`Unknown suit: ${suit}`);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = FACE_BG;
    ctx.fillRect(0, 0, size, size);

    drawCenterMotifBold(ctx, size, suitDef.symbol, suitDef.color);
    drawIndicesBold(ctx, size, String(rank), suitDef.symbol, suitDef.color);

    return canvas;
  }

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

  global.CardArt = {
    renderFace,
    renderFaceBold,
    renderBack,
    RANKS,
    SUIT_NAMES,
    MARGIN_PCT, // exposed for the debug-guide overlay in the test harness
  };
})(typeof window !== 'undefined' ? window : globalThis);

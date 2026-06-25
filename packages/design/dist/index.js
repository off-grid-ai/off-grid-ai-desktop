"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  COLORS_DARK: () => COLORS_DARK,
  COLORS_LIGHT: () => COLORS_LIGHT,
  FONTS: () => FONTS,
  FONT_MONO: () => FONT_MONO,
  RADIUS: () => RADIUS,
  SPACING: () => SPACING,
  TYPOGRAPHY: () => TYPOGRAPHY,
  cssVar: () => cssVar
});
module.exports = __toCommonJS(index_exports);
var COLORS_LIGHT = {
  primary: "#059669",
  primaryDark: "#047857",
  primaryLight: "#34D399",
  background: "#FFFFFF",
  surface: "#F5F5F5",
  surfaceLight: "#EBEBEB",
  surfaceHover: "#E0E0E0",
  text: "#0A0A0A",
  textSecondary: "#525252",
  textMuted: "#8A8A8A",
  textDisabled: "#BFBFBF",
  border: "#E5E5E5",
  borderLight: "#D4D4D4",
  borderFocus: "#059669",
  success: "#525252",
  warning: "#0A0A0A",
  error: "#DC2626",
  trending: "#D97706",
  errorBackground: "rgba(220, 38, 38, 0.10)",
  info: "#525252",
  overlay: "rgba(0, 0, 0, 0.4)",
  divider: "#EBEBEB"
};
var COLORS_DARK = {
  primary: "#34D399",
  primaryDark: "#10B981",
  primaryLight: "#6EE7B7",
  background: "#0A0A0A",
  surface: "#141414",
  surfaceLight: "#1E1E1E",
  surfaceHover: "#252525",
  text: "#FFFFFF",
  textSecondary: "#B0B0B0",
  textMuted: "#808080",
  textDisabled: "#4A4A4A",
  border: "#1E1E1E",
  borderLight: "#2A2A2A",
  borderFocus: "#34D399",
  success: "#B0B0B0",
  warning: "#FFFFFF",
  error: "#C75050",
  trending: "#F59E0B",
  errorBackground: "rgba(239, 68, 68, 0.15)",
  info: "#B0B0B0",
  overlay: "rgba(0, 0, 0, 0.7)",
  divider: "#1A1A1A"
};
var FONT_MONO = "'Menlo', ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', monospace";
var FONTS = {
  mono: "Menlo"
};
var SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
};
var RADIUS = {
  sm: 2,
  md: 8
};
var TYPOGRAPHY = {
  display: { fontSize: 22, fontFamily: FONTS.mono, fontWeight: "200", letterSpacing: -0.5 },
  h1: { fontSize: 24, fontFamily: FONTS.mono, fontWeight: "300", letterSpacing: -0.5 },
  h2: { fontSize: 16, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: -0.2 },
  h3: { fontSize: 13, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: -0.2 },
  body: { fontSize: 14, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: 0 },
  bodySmall: { fontSize: 13, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: 0 },
  label: { fontSize: 10, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: 0.3 },
  labelSmall: { fontSize: 9, fontFamily: FONTS.mono, fontWeight: "400", letterSpacing: 0.3 },
  meta: { fontSize: 10, fontFamily: FONTS.mono, fontWeight: "300", letterSpacing: 0 },
  metaSmall: { fontSize: 9, fontFamily: FONTS.mono, fontWeight: "300", letterSpacing: 0 }
};
function cssVar(token) {
  return `var(--og-${kebab(token)})`;
}
function kebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COLORS_DARK,
  COLORS_LIGHT,
  FONTS,
  FONT_MONO,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
  cssVar
});

declare const COLORS_LIGHT: {
    readonly primary: "#059669";
    readonly primaryDark: "#047857";
    readonly primaryLight: "#34D399";
    readonly background: "#FFFFFF";
    readonly surface: "#F5F5F5";
    readonly surfaceLight: "#EBEBEB";
    readonly surfaceHover: "#E0E0E0";
    readonly text: "#0A0A0A";
    readonly textSecondary: "#525252";
    readonly textMuted: "#8A8A8A";
    readonly textDisabled: "#BFBFBF";
    readonly border: "#E5E5E5";
    readonly borderLight: "#D4D4D4";
    readonly borderFocus: "#059669";
    readonly success: "#525252";
    readonly warning: "#0A0A0A";
    readonly error: "#DC2626";
    readonly trending: "#D97706";
    readonly errorBackground: "rgba(220, 38, 38, 0.10)";
    readonly info: "#525252";
    readonly overlay: "rgba(0, 0, 0, 0.4)";
    readonly divider: "#EBEBEB";
};
declare const COLORS_DARK: {
    readonly primary: "#34D399";
    readonly primaryDark: "#10B981";
    readonly primaryLight: "#6EE7B7";
    readonly background: "#0A0A0A";
    readonly surface: "#141414";
    readonly surfaceLight: "#1E1E1E";
    readonly surfaceHover: "#252525";
    readonly text: "#FFFFFF";
    readonly textSecondary: "#B0B0B0";
    readonly textMuted: "#808080";
    readonly textDisabled: "#4A4A4A";
    readonly border: "#1E1E1E";
    readonly borderLight: "#2A2A2A";
    readonly borderFocus: "#34D399";
    readonly success: "#B0B0B0";
    readonly warning: "#FFFFFF";
    readonly error: "#C75050";
    readonly trending: "#F59E0B";
    readonly errorBackground: "rgba(239, 68, 68, 0.15)";
    readonly info: "#B0B0B0";
    readonly overlay: "rgba(0, 0, 0, 0.7)";
    readonly divider: "#1A1A1A";
};
type ThemeColors = typeof COLORS_LIGHT;
type ColorToken = keyof ThemeColors;
declare const FONT_MONO = "'Menlo', ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', monospace";
declare const FONTS: {
    readonly mono: "Menlo";
};
declare const SPACING: {
    readonly xs: 4;
    readonly sm: 8;
    readonly md: 12;
    readonly lg: 16;
    readonly xl: 24;
    readonly xxl: 32;
};
type SpacingToken = keyof typeof SPACING;
declare const RADIUS: {
    readonly sm: 2;
    readonly md: 8;
};
declare const TYPOGRAPHY: {
    readonly display: {
        readonly fontSize: 22;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "200";
        readonly letterSpacing: -0.5;
    };
    readonly h1: {
        readonly fontSize: 24;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "300";
        readonly letterSpacing: -0.5;
    };
    readonly h2: {
        readonly fontSize: 16;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: -0.2;
    };
    readonly h3: {
        readonly fontSize: 13;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: -0.2;
    };
    readonly body: {
        readonly fontSize: 14;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: 0;
    };
    readonly bodySmall: {
        readonly fontSize: 13;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: 0;
    };
    readonly label: {
        readonly fontSize: 10;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: 0.3;
    };
    readonly labelSmall: {
        readonly fontSize: 9;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "400";
        readonly letterSpacing: 0.3;
    };
    readonly meta: {
        readonly fontSize: 10;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "300";
        readonly letterSpacing: 0;
    };
    readonly metaSmall: {
        readonly fontSize: 9;
        readonly fontFamily: "Menlo";
        readonly fontWeight: "300";
        readonly letterSpacing: 0;
    };
};
type TypographyToken = keyof typeof TYPOGRAPHY;
declare function cssVar(token: ColorToken): string;

export { COLORS_DARK, COLORS_LIGHT, type ColorToken, FONTS, FONT_MONO, RADIUS, SPACING, type SpacingToken, TYPOGRAPHY, type ThemeColors, type TypographyToken, cssVar };

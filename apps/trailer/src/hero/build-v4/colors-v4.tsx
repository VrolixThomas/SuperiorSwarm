import { type ReactNode, createContext, useContext } from "react";

// Token tables ported from apps/desktop/src/renderer/styles.css :root and html[data-theme="light"].
const DARK = {
	bgBase: "#0a0a0a",
	bgSurface: "#161618",
	bgElevated: "#1f1f22",
	bgOverlay: "#2c2c2e",
	bgActive: "#3a3a3d",
	bgTabBar: "#111113",
	border: "rgba(255,255,255,0.1)",
	borderSubtle: "rgba(255,255,255,0.06)",
	borderActive: "rgba(255,255,255,0.16)",
	text: "#f5f5f7",
	textSecondary: "#b5b5ba",
	textTertiary: "#8e8e93",
	textQuaternary: "#6e6e73",
	accent: "#0a84ff",
	accentSubtle: "rgba(10,132,255,0.16)",
	success: "#30d158",
	danger: "#ff453a",
	warning: "#ff9f0a",
} as const;

const LIGHT = {
	bgBase: "#fafaf7",
	bgSurface: "#f2f2ef",
	bgElevated: "#ffffff",
	bgOverlay: "#e8e8e3",
	bgActive: "#c8c8c2",
	bgTabBar: "#ededea",
	border: "rgba(0,0,0,0.1)",
	borderSubtle: "rgba(0,0,0,0.06)",
	borderActive: "rgba(0,0,0,0.18)",
	text: "#1d1d1f",
	textSecondary: "#3a3a3c",
	textTertiary: "#6e6e73",
	textQuaternary: "#76767a",
	accent: "#0a84ff",
	accentSubtle: "rgba(10,132,255,0.16)",
	success: "#28a745",
	danger: "#dc3545",
	warning: "#fd7e14",
} as const;

export const C_V4 = { dark: DARK, light: LIGHT } as const;
export type ThemeModeV4 = "dark" | "light";
export type ColorsV4 = typeof DARK;

const ThemeContext = createContext<ThemeModeV4>("dark");

export function ThemeProviderV4({
	value,
	children,
}: {
	value: ThemeModeV4;
	children: ReactNode;
}) {
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeV4(): ThemeModeV4 {
	return useContext(ThemeContext);
}

export function useColorsV4(): ColorsV4 {
	const theme = useThemeV4();
	return C_V4[theme] as ColorsV4;
}

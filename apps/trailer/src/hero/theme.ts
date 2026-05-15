export const HERO = {
	bg: "linear-gradient(135deg, #0a0a0a 0%, #1a120a 50%, #0a0a0a 100%)",
	glow: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(196,149,108,0.22) 0%, transparent 70%)",
	accent: "#c4956c",
	accentSoft: "rgba(196,149,108,0.35)",
	text: "#f5f5f7",
	textMuted: "#8e8e93",
	black: "#000000",
} as const;

export const SNAP = { damping: 18, stiffness: 200, mass: 0.5 } as const;
export const SOFT = { damping: 22, stiffness: 120, mass: 0.6 } as const;

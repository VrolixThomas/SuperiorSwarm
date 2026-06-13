export const PROJECT_COLORS = [
	"#0a84ff",
	"#30d158",
	"#ff9f0a",
	"#ff375f",
	"#bf5af2",
	"#64d2ff",
	"#ffd60a",
	"#ff6482",
];

export function randomColor(): string {
	return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)] ?? "#0a84ff";
}

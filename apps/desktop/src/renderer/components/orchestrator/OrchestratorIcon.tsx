export function OrchestratorIcon({ size = 12, color }: { size?: number; color: string }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 12 12"
			fill="none"
			className="shrink-0"
		>
			<circle cx="6" cy="2.5" r="1.4" stroke={color} strokeWidth="1.2" />
			<circle cx="2.5" cy="9.5" r="1.4" stroke={color} strokeWidth="1.2" />
			<circle cx="9.5" cy="9.5" r="1.4" stroke={color} strokeWidth="1.2" />
			<path d="M6 4 L3 8 M6 4 L9 8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
		</svg>
	);
}

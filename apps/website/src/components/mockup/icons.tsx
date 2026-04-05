export function FileIcon({ color, size = 12 }: { color: string; size?: number }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			className="shrink-0"
		>
			<path
				d="M3.5 1.75A.75.75 0 014.25 1h5.19a.75.75 0 01.53.22l3.06 3.06a.75.75 0 01.22.53v8.44a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75V1.75z"
				fill={color}
				opacity="0.2"
			/>
			<path
				d="M3.5 1.75A.75.75 0 014.25 1h5.19a.75.75 0 01.53.22l3.06 3.06a.75.75 0 01.22.53v8.44a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75V1.75z"
				stroke={color}
				strokeWidth="0.75"
			/>
		</svg>
	);
}

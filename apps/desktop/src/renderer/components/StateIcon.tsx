interface StateIconProps {
	type: string;
	color: string;
	size?: number;
}

export function StateIcon({ type, color, size = 14 }: StateIconProps) {
	const svgProps = {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		fill: "none",
		className: "shrink-0",
	};

	switch (type) {
		case "triage":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle
						cx="7"
						cy="7"
						r="5.5"
						stroke={color}
						strokeWidth="1.5"
						strokeDasharray="3.14 3.14"
						fill="none"
					/>
				</svg>
			);

		case "backlog":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
				</svg>
			);

		case "unstarted":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<circle cx="7" cy="7" r="2" fill={color} />
				</svg>
			);

		case "started":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5" fill={color} />
				</svg>
			);

		case "completed":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="6" fill={color} />
					<path
						d="M4.5 7.2 L6.2 8.9 L9.5 5.5"
						stroke="#fff"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			);

		case "cancelled":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<path d="M5 5 L9 9 M9 5 L5 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			);

		default:
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="4" fill={color} />
				</svg>
			);
	}
}

export function QueueIcon({
	name,
	size = 18,
}: {
	name: "queue" | "repos" | "tickets" | "prs" | "hermes" | "settings" | "question" | "ready";
	size?: number;
}) {
	const paths = {
		queue: (
			<>
				<path d="M4 5h16v14H4z" />
				<path d="M4 13h4l2 3h4l2-3h4M8 9h8" />
			</>
		),
		repos: <path d="M3 7h7l2-3h7a2 2 0 0 1 2 2v12H3V7zm0 0V4h7l2 3" />,
		tickets: (
			<>
				<rect x="5" y="3" width="14" height="18" rx="2" />
				<path d="M9 8h6M9 12h6M9 16h3" />
			</>
		),
		prs: (
			<>
				<circle cx="6" cy="5" r="2" />
				<circle cx="18" cy="19" r="2" />
				<path d="M6 7v14M18 17V9a4 4 0 0 0-4-4h-2m2-2-2 2 2 2" />
			</>
		),
		hermes: (
			<>
				<rect x="3" y="6" width="18" height="14" rx="3" />
				<path d="M12 6V3m-5 9h1m8 0h1M8 16h8" />
			</>
		),
		settings: (
			<>
				<circle cx="12" cy="12" r="3" />
				<path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z" />
			</>
		),
		question: (
			<>
				<path d="M5 4h14v12h-7l-5 4v-4H5z" />
				<path d="M10 8a2 2 0 0 1 4 0c0 2-2 1-2 3m0 2h.01" />
			</>
		),
		ready: (
			<>
				<circle cx="12" cy="12" r="9" />
				<path d="m8 12 3 3 5-6" />
			</>
		),
	};
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{paths[name]}
		</svg>
	);
}

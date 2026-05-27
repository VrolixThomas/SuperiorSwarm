import { SOCIAL_LIST } from "@/lib/constants";

type IconKey = (typeof SOCIAL_LIST)[number]["key"];

const ICONS: Record<IconKey, React.ReactNode> = {
	x: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.832l4.713 6.231 5.445-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
		</svg>
	),
	linkedin: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
		</svg>
	),
	youtube: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M23.5 6.2a3.02 3.02 0 0 0-2.13-2.14C19.48 3.5 12 3.5 12 3.5s-7.48 0-9.37.56A3.02 3.02 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3.02 3.02 0 0 0 2.13 2.14C4.52 20.5 12 20.5 12 20.5s7.48 0 9.37-.56a3.02 3.02 0 0 0 2.13-2.14C24 15.9 24 12 24 12s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.27 3.6-6.27 3.6Z" />
		</svg>
	),
	github: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.02c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5Z" />
		</svg>
	),
};

export function SocialIcons({
	size = 16,
	className = "",
	itemClassName = "",
}: {
	size?: number;
	className?: string;
	itemClassName?: string;
}) {
	return (
		<ul className={`flex items-center gap-3 ${className}`}>
			{SOCIAL_LIST.map((s) => (
				<li key={s.key}>
					<a
						href={s.href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={s.label}
						className={`flex items-center justify-center text-text-muted transition-colors hover:text-text-primary ${itemClassName}`}
						style={{ width: size + 8, height: size + 8 }}
					>
						<span style={{ width: size, height: size, display: "inline-block" }}>
							{ICONS[s.key]}
						</span>
					</a>
				</li>
			))}
		</ul>
	);
}

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GeistMono } from "geist/font/mono";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/constants";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
});

export const metadata: Metadata = {
	title: {
		default: `${SITE.name} — ${SITE.tagline}`,
		template: `%s · ${SITE.name}`,
	},
	description: SITE.description,
	keywords: [
		"Claude Code",
		"Codex",
		"Gemini CLI",
		"AI coding agents",
		"PR review",
		"terminal multiplexer",
		"git worktrees",
		"MCP",
		"developer tools",
		"desktop app",
	],
	authors: [{ name: "Thomas Vrolix", url: SITE.github }],
	creator: "Thomas Vrolix",
	publisher: SITE.name,
	applicationName: SITE.name,
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "any" },
			{ url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
		],
		apple: "/apple-touch-icon.png",
	},
	openGraph: {
		title: `${SITE.name} — ${SITE.tagline}`,
		description: SITE.description,
		type: "website",
		url: SITE.url,
		images: [{ url: "/og-image.png", width: 1200, height: 630 }],
	},
	twitter: {
		card: "summary_large_image",
		title: `${SITE.name} — ${SITE.tagline}`,
		description: SITE.description,
		images: ["/og-image.png"],
		site: "@superiorswarm",
		creator: "@superiorswarm",
	},
	robots: { index: true, follow: true },
	metadataBase: new URL(SITE.url),
	alternates: { canonical: "/" },
};

const ORG_JSON_LD = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: SITE.name,
	url: SITE.url,
	logo: `${SITE.url}/apple-touch-icon.png`,
	sameAs: [SITE.socials.x, SITE.socials.linkedin, SITE.socials.youtube, SITE.socials.github],
};

const APP_JSON_LD = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: SITE.name,
	description: SITE.description,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "macOS",
	offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
	url: SITE.url,
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={`${inter.variable} ${GeistMono.variable}`}>
			<head>
				<meta name="theme-color" content="#0a0a0a" />
				<link rel="manifest" href="/manifest.webmanifest" />
				<script
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: structured-data JSON-LD
					dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
				/>
				<script
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: structured-data JSON-LD
					dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_JSON_LD) }}
				/>
			</head>
			<body className="bg-bg-base text-text-primary font-sans antialiased">
				<a
					href="#hero"
					className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-bg-elevated focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary focus:outline focus:outline-2 focus:outline-accent"
				>
					Skip to content
				</a>
				{children}
				<Analytics />
				<SpeedInsights />
			</body>
		</html>
	);
}

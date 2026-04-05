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
	title: `${SITE.name} — ${SITE.tagline}`,
	description: SITE.description,
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
	},
	robots: { index: true, follow: true },
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={`${inter.variable} ${GeistMono.variable}`}>
			<body className="bg-bg-base text-text-primary font-sans antialiased">
				{children}
				<Analytics />
				<SpeedInsights />
			</body>
		</html>
	);
}

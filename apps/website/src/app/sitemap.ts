import { SITE } from "@/lib/constants";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const now = new Date();
	const routes = ["", "/downloads", "/changelog", "/privacy", "/terms"];
	return routes.map((route) => ({
		url: `${SITE.url}${route}`,
		lastModified: now,
		changeFrequency: route === "" ? "weekly" : "monthly",
		priority: route === "" ? 1 : 0.7,
	}));
}

"use client";

import { useEffect, useState } from "react";

export type DetectedPlatform = "mac" | "windows" | "linux" | "mobile";

function detectPlatform(): DetectedPlatform {
	const ua = navigator.userAgent;

	// Check mobile first — phones/tablets can't run the desktop app
	if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
		return "mobile";
	}

	if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
	if (/Windows/i.test(ua)) return "windows";
	if (/Linux/i.test(ua)) return "linux";

	// Unknown → show download (primary CTA)
	return "mac";
}

/** True when the visitor should see the download CTA (mac users + mobile). */
export function shouldShowDownload(platform: DetectedPlatform): boolean {
	return platform === "mac" || platform === "mobile";
}

export function useDetectedPlatform(): DetectedPlatform {
	// SSR default: "mac" to avoid flash — download is the primary CTA
	const [platform, setPlatform] = useState<DetectedPlatform>("mac");

	useEffect(() => {
		setPlatform(detectPlatform());
	}, []);

	return platform;
}

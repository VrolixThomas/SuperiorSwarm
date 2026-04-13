import { AmbientParticles } from "@/components/ambient-particles";
import { CtaFooter } from "@/components/cta-footer";
import { FeatureSections } from "@/components/feature-sections";
import { Hero } from "@/components/hero";
import { MockupShell } from "@/components/mockup/mockup-shell";
import { Nav } from "@/components/nav";
import { ReleaseProvider } from "@/lib/release-context";
import { getLatestRelease } from "@/lib/github";

export default async function Home() {
	const release = await getLatestRelease();

	return (
		<ReleaseProvider release={release}>
			<AmbientParticles />
			<Nav />
			<main className="relative z-10">
				<Hero />
				<MockupShell />
				<FeatureSections />
				<CtaFooter />
			</main>
		</ReleaseProvider>
	);
}

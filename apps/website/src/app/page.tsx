import { AmbientParticles } from "@/components/ambient-particles";
import { CtaFooter } from "@/components/cta-footer";
import { FeatureSections } from "@/components/feature-sections";
import { Hero } from "@/components/hero";
import { MockupShell } from "@/components/mockup/mockup-shell";
import { Nav } from "@/components/nav";
import { WhatsNewStrip } from "@/components/whats-new-strip";
import { getLatestRelease } from "@/lib/github";
import { ReleaseProvider } from "@/lib/release-context";

export default async function Home() {
	const release = await getLatestRelease();

	return (
		<ReleaseProvider release={release}>
			<AmbientParticles />
			<Nav />
			<main className="relative z-10">
				<Hero whatsNew={<WhatsNewStrip />} />
				<MockupShell />
				<FeatureSections />
				<CtaFooter />
			</main>
		</ReleaseProvider>
	);
}

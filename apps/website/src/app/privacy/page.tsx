import { LegalPage, P, Section, UL } from "@/components/legal-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Notice — SuperiorSwarm",
	description: "How SuperiorSwarm collects and uses your data.",
};

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Notice" updated="2026-04-18">
			<Section>
				<P>
					SuperiorSwarm is a desktop application that runs entirely on your machine. Two pieces of
					data leave your device, both described below.
				</P>
			</Section>

			<Section heading="1. Account data (required to sign in)">
				<P>
					To sign in you use GitHub or Apple OAuth. Our Supabase project stores the standard OAuth
					profile fields those providers return: your email address, display name, avatar URL,
					provider user ID, and the access token Supabase uses to keep your session valid. This is
					the minimum needed to authenticate you and is managed by Supabase Auth.
				</P>
			</Section>

			<Section heading="2. Usage telemetry (on by default, toggleable)">
				<P>
					Once per day (and once immediately after you first sign in), the app sends a single
					snapshot row tied to your Supabase account ID. It contains:
				</P>
				<UL>
					<li>
						<strong className="text-text-primary">Environment:</strong> app version, OS platform
						(darwin / win32 / linux), CPU arch, locale.
					</li>
					<li>
						<strong className="text-text-primary">Lifecycle:</strong> when you first launched the
						app, when you first signed in, when this snapshot was sent.
					</li>
					<li>
						<strong className="text-text-primary">Integrations:</strong> booleans indicating whether
						you have ever connected GitHub, Linear, Jira, or Bitbucket (never any tokens or account
						identifiers).
					</li>
					<li>
						<strong className="text-text-primary">Feature usage:</strong> booleans for whether
						you've ever used AI review and comment solver.
					</li>
					<li>
						<strong className="text-text-primary">Cumulative counters:</strong> total number of
						terminal sessions started, reviews started, and comments solved over the lifetime of the
						install.
					</li>
					<li>
						<strong className="text-text-primary">Auth provider:</strong> which OAuth provider you
						signed in with (github / apple).
					</li>
				</UL>
			</Section>

			<Section heading="What the telemetry snapshot never includes">
				<UL>
					<li>Repository contents, file paths, file names, or file hashes</li>
					<li>Branch names, commit messages, commit SHAs, diffs</li>
					<li>Pull request titles, descriptions, comments, or reviews</li>
					<li>Ticket titles, descriptions, or any Linear/Jira content</li>
					<li>Prompts you send to Claude or any other agent</li>
					<li>Agent responses or terminal output</li>
					<li>Access tokens or any credential material</li>
				</UL>
			</Section>

			<Section heading="How to opt out">
				<P>
					Toggle it off anytime under <strong className="text-text-primary">Preferences → Usage analytics</strong>. When off, no further snapshots are sent.
				</P>
			</Section>

			<Section heading="Your rights (GDPR)">
				<P>
					If you are in the European Economic Area, you have the following rights regarding your
					personal data:
				</P>
				<UL>
					<li>
						<strong className="text-text-primary">Access:</strong> Request a copy of the personal
						data we hold about you.
					</li>
					<li>
						<strong className="text-text-primary">Rectification:</strong> Ask us to correct
						inaccurate data.
					</li>
					<li>
						<strong className="text-text-primary">Erasure:</strong> Ask us to delete your account
						and associated data.
					</li>
					<li>
						<strong className="text-text-primary">Restriction:</strong> Ask us to restrict
						processing of your data in certain circumstances.
					</li>
					<li>
						<strong className="text-text-primary">Portability:</strong> Request your data in a
						machine-readable format.
					</li>
					<li>
						<strong className="text-text-primary">Objection:</strong> Object to processing based on
						legitimate interest (this applies to usage telemetry).
					</li>
				</UL>
				<P>
					To exercise any of these rights, open an issue on{" "}
					<a
						href="https://github.com/VrolixThomas/SuperiorSwarm"
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent underline underline-offset-2 hover:text-text-primary"
					>
						GitHub
					</a>
					. We will respond within 30 days. You also have the right to lodge a complaint with the{" "}
					<a
						href="https://www.dataprotectionauthority.be"
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent underline underline-offset-2 hover:text-text-primary"
					>
						Belgian Data Protection Authority
					</a>
					.
				</P>
			</Section>

			<Section heading="Questions">
				<P>
					Open an issue on{" "}
					<a
						href="https://github.com/VrolixThomas/SuperiorSwarm"
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent underline underline-offset-2 hover:text-text-primary"
					>
						GitHub
					</a>
					.
				</P>
			</Section>
		</LegalPage>
	);
}

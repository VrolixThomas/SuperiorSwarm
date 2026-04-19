import { Caps, LegalPage, P, Section, UL } from "@/components/legal-page";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Service — SuperiorSwarm",
	description: "Terms governing your use of SuperiorSwarm.",
};

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service" updated="2026-04-18">
			<Section>
				<P>
					By downloading, installing, or using SuperiorSwarm (the "App"), you agree to these Terms
					of Service ("Terms"). If you do not agree, do not use the App.
				</P>
			</Section>

			<Section heading="1. The App">
				<P>
					SuperiorSwarm is a desktop application that helps you manage AI coding agents, terminal
					sessions, and integrations with third-party services (GitHub, Linear, Jira, Bitbucket, and
					AI providers such as Anthropic Claude). The App is provided by Thomas Vrolix ("we", "us",
					"our").
				</P>
			</Section>

			<Section heading="2. Acceptance">
				<P>
					These Terms form a legally binding agreement between you and us. By creating an account or
					using the App you confirm you are at least 18 years old (or the age of majority in your
					jurisdiction) and have the authority to enter this agreement.
				</P>
			</Section>

			<Section heading="3. License">
				<P>
					We grant you a personal, non-exclusive, non-transferable, revocable license to use the App
					for your own lawful purposes. You may not:
				</P>
				<UL>
					<li>
						Sublicense, sell, resell, or redistribute the App or its source code in violation of the
						project license.
					</li>
					<li>Use the App to develop a competing product or service.</li>
					<li>Reverse-engineer or decompile any non-open-source portions of the App.</li>
					<li>Use the App in any way that violates applicable law.</li>
				</UL>
			</Section>

			<Section heading="4. Your Responsibilities">
				<P>You are solely responsible for:</P>
				<UL>
					<li>All code, content, prompts, and instructions you process through the App.</li>
					<li>
						The outputs produced by any AI service you invoke via the App (including but not limited
						to Anthropic Claude, OpenAI Codex, or any other agent). We do not control, endorse, or
						guarantee those outputs.
					</li>
					<li>
						Ensuring you have the right to use any repository, codebase, or third-party service you
						connect to the App.
					</li>
					<li>Maintaining the confidentiality of your authentication credentials and API keys.</li>
					<li>
						Compliance with the terms of service of any third-party service you access through the
						App (GitHub, Linear, Jira, Bitbucket, Anthropic, etc.).
					</li>
					<li>
						Any consequences arising from automated actions (commits, pull requests, comments) the
						App or its AI agents take on your behalf.
					</li>
				</UL>
			</Section>

			<Section heading="5. Third-Party Services">
				<P>
					The App connects to third-party services at your direction. We are not a party to your
					agreements with those services and have no liability for their availability, accuracy, or
					conduct. API keys and OAuth tokens you provide are stored locally on your device and are
					never transmitted to us.
				</P>
			</Section>

			<Section heading="6. Disclaimer of Warranties">
				<Caps>
					The App is provided "as is" and "as available" without warranty of any kind, express or
					implied, including but not limited to warranties of merchantability, fitness for a
					particular purpose, non-infringement, or uninterrupted/error-free operation.
				</Caps>
				<P>We do not warrant that:</P>
				<UL>
					<li>The App will meet your requirements or be suitable for your specific use case.</li>
					<li>
						AI-generated code, reviews, or suggestions will be correct, complete, or safe to deploy.
					</li>
					<li>
						The App will be available at any particular time or that defects will be corrected.
					</li>
				</UL>
				<Caps>Use of the App and reliance on any AI output is entirely at your own risk.</Caps>
			</Section>

			<Section heading="7. Limitation of Liability">
				<Caps>
					To the maximum extent permitted by applicable law, in no event will we be liable for any
					indirect, incidental, special, consequential, or punitive damages, or any loss of profits,
					revenue, data, business, or goodwill, arising out of or in connection with your use of or
					inability to use the App — even if we have been advised of the possibility of such
					damages.
				</Caps>
				<Caps>
					Our total aggregate liability to you for any claims arising under these Terms will not
					exceed the amount you paid us in the 12 months preceding the claim, or €0 if no payment
					was made.
				</Caps>
				<P>
					Some jurisdictions do not allow certain liability exclusions. In those jurisdictions our
					liability is limited to the maximum extent permitted by law.
				</P>
			</Section>

			<Section heading="8. Indemnification">
				<P>
					You agree to indemnify, defend, and hold harmless us and our affiliates, officers, and
					agents from any claims, damages, losses, liabilities, costs, and expenses (including
					reasonable legal fees) arising from: (a) your use of the App; (b) your violation of these
					Terms; (c) your violation of any third-party rights; or (d) any AI-generated output you
					deploy or publish using the App.
				</P>
			</Section>

			<Section heading="9. Privacy and Analytics">
				<P>
					Our collection and use of your data is governed by the{" "}
					<a
						href="/privacy"
						className="text-accent underline underline-offset-2 hover:text-text-primary"
					>
						Privacy Notice
					</a>
					. Usage telemetry is on by default and can be disabled at any time under{" "}
					<strong className="text-text-primary">Preferences → Usage analytics</strong>. We process
					telemetry data on the basis of our legitimate interest in understanding aggregate product
					usage.
				</P>
			</Section>

			<Section heading="10. Intellectual Property">
				<P>
					The App and its original content, features, and architecture are owned by us and protected
					by applicable intellectual property laws. Open-source components are licensed under their
					respective licenses. Nothing in these Terms transfers any IP rights to you beyond the
					license granted in Section 3.
				</P>
				<P>
					Your code, repositories, and content remain entirely yours. We claim no rights over
					anything you process through the App.
				</P>
			</Section>

			<Section heading="11. Termination">
				<P>
					We may suspend or terminate your access to the App at any time if you breach these Terms
					or if we discontinue the App. You may stop using the App at any time. On termination, the
					license in Section 3 ends. Sections 6, 7, 8, and 10 survive termination.
				</P>
			</Section>

			<Section heading="12. Changes to These Terms">
				<P>
					We may update these Terms from time to time. We will update the "Last updated" date above.
					Continued use of the App after changes are published constitutes acceptance of the updated
					Terms. For material changes we will make reasonable efforts to notify users (e.g., in-app
					notice or GitHub release notes).
				</P>
			</Section>

			<Section heading="13. Governing Law and Disputes">
				<P>
					These Terms are governed by the laws of Belgium, without regard to its conflict-of-law
					provisions. Any dispute arising out of these Terms or your use of the App will be subject
					to the exclusive jurisdiction of the courts of Brussels, Belgium, unless mandatory
					consumer protection law in your jurisdiction requires otherwise.
				</P>
			</Section>

			<Section heading="14. Contact">
				<P>
					Questions about these Terms: open an issue at{" "}
					<a
						href="https://github.com/VrolixThomas/SuperiorSwarm"
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent underline underline-offset-2 hover:text-text-primary"
					>
						github.com/VrolixThomas/SuperiorSwarm
					</a>
					.
				</P>
			</Section>
		</LegalPage>
	);
}

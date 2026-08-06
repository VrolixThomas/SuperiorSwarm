import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const interactionCardsModule = "../src/renderer/components/hermes/HermesInteractionCards.tsx";
const { HermesApprovalCard, HermesClarificationChoices } = await import(interactionCardsModule);

describe("Hermes interaction cards", () => {
	test("renders the complete prompt and every server-provided approval choice as inert text", () => {
		const html = renderToStaticMarkup(
			createElement(HermesApprovalCard, {
				interaction: {
					requestId: "approval-1",
					prompt: "Deploy <script>unsafe()</script>\n\nCommand:\ndeploy --environment production",
					choices: [
						{ value: "allow_once", label: "Allow this deployment" },
						{ value: "deny", label: "Deny and return" },
					],
				},
				pending: false,
				onChoose: () => undefined,
			})
		);

		expect(html).toContain("Deploy &lt;script&gt;unsafe()&lt;/script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).toContain("deploy --environment production");
		expect(html).toContain("Allow this deployment");
		expect(html).toContain("Deny and return");
	});

	test("renders clarification choices as distinct answer controls", () => {
		const html = renderToStaticMarkup(
			createElement(HermesClarificationChoices, {
				choices: [
					{ value: "staging", label: "Staging" },
					{ value: "production", label: "Production" },
				],
				pending: false,
				onChoose: () => undefined,
			})
		);

		expect(html.match(/<button/g)).toHaveLength(2);
		expect(html).toContain("Staging");
		expect(html).toContain("Production");
	});
});

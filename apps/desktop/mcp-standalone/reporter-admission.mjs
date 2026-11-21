/** This fallback never blocks transport startup. A bounded asynchronous exchange can run
 * after transport startup and is also awaited by the first tool. Existing pins never change. */
export function createReporterAdmission(context, baseUrl, authorization) {
	let pending;
	return async function ensureReporter(headers) {
		if (context.queueReporter || !context.queueAdmission) return;
		if (!pending) {
			pending = (async () => {
				const deadline = performance.now() + 5000;
				for (let attempt = 0; attempt < 50 && performance.now() < deadline; attempt++) {
					const response = await fetch(`${baseUrl}/context.admit`, {
						method: "POST",
						headers: {
							Authorization: authorization,
							...headers,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ token: context.queueAdmission.token }),
						signal: AbortSignal.timeout(
							Math.max(1, Math.ceil(Math.min(1000, deadline - performance.now())))
						),
					});
					const result = await response.json();
					if (response.status === 200 && result.status === "admitted") {
						const reporter = result.reporter;
						const entityId = context.workspaceId ?? context.crossRepoOrchestratorId;
						if (
							reporter?.type !== "terminal" ||
							reporter.workspaceId !== entityId ||
							reporter.terminalId !== headers["X-Terminal-Id"] ||
							typeof reporter.provider !== "string" ||
							typeof reporter.providerSessionId !== "string" ||
							!reporter.providerSessionId
						)
							throw new Error("Invalid first conversation admission");
						context.queueReporter = reporter;
						context.queueAdmission = undefined;
						return;
					}
					if (response.status !== 202 || result.status !== "pending")
						throw new Error(
							result.message ||
								"First conversation admission rejected; restart MCP in the intended conversation."
						);
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				throw new Error(
					"The first conversation is not registered yet. Retry after startup; no report or reply was sent."
				);
			})().finally(() => {
				pending = undefined;
			});
		}
		await pending;
	};
}

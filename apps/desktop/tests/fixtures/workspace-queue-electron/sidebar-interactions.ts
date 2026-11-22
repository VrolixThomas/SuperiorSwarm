import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebContents } from "electron";

export async function checkSidebarInteractions(contents: WebContents, root: string) {
	const js = <T>(code: string): Promise<T> => contents.executeJavaScript(code);
	const wait = async (code: string) => {
		for (let i = 0; i < 100; i++) {
			if (await js<boolean>(code)) return;
			await new Promise((r) => setTimeout(r, 25));
		}
		throw new Error(`Sidebar interaction timeout: ${code}`);
	};
	const setOpen = async (id: string, open: boolean) => {
		await js(
			`(() => {const b=document.querySelector('[data-sidebar-band="${id}"] button[aria-expanded]');if(b.getAttribute('aria-expanded')!=="${open}")b.click()})()`
		);
		await wait(
			`document.querySelector('[data-sidebar-band="${id}"] button[aria-expanded]').getAttribute('aria-expanded')==="${open}"`
		);
	};
	const drag = async (id: string, over: string, expected: string[]) => {
		const rects = await js<{
			x: number;
			y: number;
			targetY: number;
			height: number;
			width: number;
		}>(`(() => {
			const band=document.querySelector('[data-sidebar-band="${id}"]');
			const handle=band.querySelector('button[aria-label="Reorder section"]').getBoundingClientRect();
			const header=band.firstElementChild.getBoundingClientRect();
			const target=document.querySelector('[data-sidebar-band="${over}"]').getBoundingClientRect();
			return {x:handle.x+handle.width/2,y:handle.y+handle.height/2,targetY:target.y+target.height/2,height:header.height,width:header.width};
		})()`);
		const x = Math.round(rects.x);
		const startY = Math.round(rects.y);
		const endY = Math.round(rects.targetY);
		contents.sendInputEvent({ type: "mouseMove", x, y: startY });
		contents.sendInputEvent({ type: "mouseDown", x, y: startY, button: "left", clickCount: 1 });
		for (let step = 1; step <= 12; step++) {
			contents.sendInputEvent({
				type: "mouseMove",
				x,
				y: Math.round(startY + ((endY - startY) * step) / 12),
			});
			await new Promise((r) => setTimeout(r, 20));
		}
		await contents
			.capturePage({ x: 72, y: 0, width: 360, height: 700 })
			.then((c) => writeFileSync(join(root, `sidebar-drag-${id}-over-${over}.png`), c.toPNG()));
		const shape = await js<{ height: number; width: number; opacity: string; background: string }>(
			`(() => {const el=document.querySelector('[data-sidebar-band="${id}"]');const r=el.firstElementChild.getBoundingClientRect();const s=getComputedStyle(el);return {height:r.height,width:r.width,opacity:s.opacity,background:s.backgroundColor}})()`
		);
		contents.sendInputEvent({ type: "mouseUp", x, y: endY, button: "left", clickCount: 1 });
		if (Math.abs(shape.height - rects.height) > 1 || Math.abs(shape.width - rects.width) > 1)
			throw new Error(
				`Section header distorted during drag: ${JSON.stringify({ id, before: rects, after: shape })}`
			);
		if (shape.opacity !== "1" || shape.background === "rgba(0, 0, 0, 0)")
			throw new Error("Dragged section lets underlying content show through");
		await wait(
			`JSON.stringify([...document.querySelectorAll('[data-sidebar-band]')].map(el=>el.dataset.sidebarBand))===${JSON.stringify(JSON.stringify(expected))}`
		);
		await wait(
			`[...document.querySelectorAll('[data-sidebar-band]')].every(el=>{const r=el.getBoundingClientRect();return r.top>=52&&r.bottom<=innerHeight+1})`
		);
		const saved = await js<string[]>(
			"JSON.parse(localStorage.getItem('ss.sidebar.bands.v1')).order"
		);
		if (JSON.stringify(saved) !== JSON.stringify(expected))
			throw new Error("Section order was not saved");
		// PointerSensor suppresses clicks for 50ms after dropping.
		await new Promise((r) => setTimeout(r, 60));
	};
	// Reproduce the recording: drag a collapsed repository section across expanded folders.
	await setOpen("repositories", false);
	await setOpen("orchestrators", false);
	await drag("repositories", "folders", ["repositories", "folders", "orchestrators"]);
	await js("document.querySelector('nav button[data-queue-trigger]').click()");
	await wait("!document.querySelector('[data-workspace-sidebar]')");
	await js("document.querySelector('nav button[aria-label=Projects]').click()");
	await wait(
		`JSON.stringify([...document.querySelectorAll('[data-sidebar-band]')].map(el=>el.dataset.sidebarBand))==='["repositories","folders","orchestrators"]'`
	);
	await wait("!!document.querySelector('[data-sidebar-band-body=folders]')");
	await drag("orchestrators", "repositories", ["orchestrators", "repositories", "folders"]);
	await setOpen("folders", false);
	await drag("folders", "orchestrators", ["folders", "orchestrators", "repositories"]);
	await drag("repositories", "orchestrators", ["folders", "repositories", "orchestrators"]);
	for (const id of ["folders", "repositories", "orchestrators"]) await setOpen(id, true);
	const resize = await js<{ x: number; y: number; targetY: number }>(`(() => {
		const band=document.querySelector('[data-sidebar-band=folders]');
		const handle=band.nextElementSibling.getBoundingClientRect();
		return {x:Math.round(handle.x+handle.width/2),y:Math.round(handle.y+handle.height/2),targetY:Math.round(band.getBoundingClientRect().top+180)};
	})()`);
	contents.sendInputEvent({ type: "mouseMove", x: resize.x, y: resize.y });
	contents.sendInputEvent({
		type: "mouseDown",
		x: resize.x,
		y: resize.y,
		button: "left",
		clickCount: 1,
	});
	contents.sendInputEvent({ type: "mouseMove", x: resize.x, y: resize.targetY });
	await wait(
		"Math.abs(document.querySelector('[data-sidebar-band=folders]').getBoundingClientRect().height-180)<1"
	);
	contents.sendInputEvent({
		type: "mouseUp",
		x: resize.x,
		y: resize.targetY,
		button: "left",
		clickCount: 1,
	});
	await drag("folders", "repositories", ["repositories", "folders", "orchestrators"]);
	if (
		!(await js<boolean>(
			"Math.abs(document.querySelector('[data-sidebar-band=folders]').getBoundingClientRect().height-180)<1"
		))
	)
		throw new Error("Reordering discarded resized section height");
	await drag("folders", "repositories", ["folders", "repositories", "orchestrators"]);
}

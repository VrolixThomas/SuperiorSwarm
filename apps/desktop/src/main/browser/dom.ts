// Executed only in an Electron isolated world in the registered browser webview.
// Never install a preload or expose this control state to the website's JS world.
export const browserDOM = String.raw`(() => {
  const key = '__superiorSwarmBrowser';
  if (globalThis[key] && globalThis[key].document === document) return;
  const ids = new WeakMap();
  let refs = new Map();
  const prefix = crypto.randomUUID();
  let next = 0;
  const clean = (text, limit) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const sensitive = el => el.matches('input[type=password],input[type=file],input[type=hidden]') || /password|secret|token|api.?key|credit.?card|cc-number|cc-csc/i.test([el.name,el.id,el.autocomplete].join(' '));
  const rendered = el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && r.width > 0 && r.height > 0 && !el.closest('[hidden],[inert],[aria-hidden=true]');
  };
  const visible = r => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const role = el => el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:el.type === 'checkbox' ? 'checkbox' : 'textbox',TEXTAREA:'textbox',SELECT:'combobox'}[el.tagName] || 'element');
  const snapshot = () => {
    const elements = [], current = new Map();
    let truncated = false;
    for (const el of document.querySelectorAll('a[href],button,input,textarea,select,[role],[tabindex],[contenteditable=true]')) {
      if (!rendered(el) || sensitive(el)) continue;
      if (elements.length >= 150) { truncated = true; break; }
      let id = ids.get(el);
      if (!id) { id = prefix + ':' + (++next); ids.set(el, id); }
      current.set(id, el);
      const r = el.getBoundingClientRect();
      const labels = el.labels ? Array.from(el.labels).map(l => l.innerText).join(' ') : '';
      const name = clean(el.getAttribute('aria-label') || labels || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title'), 500);
      elements.push({id,role:role(el),name,tag:el.tagName.toLowerCase(),
        ...('value' in el ? {value:String(el.value).slice(0,2000)} : {}),
        bounds:{x:r.x,y:r.y,width:r.width,height:r.height},visible:visible(r),enabled:!el.disabled && el.getAttribute('aria-disabled') !== 'true'});
    }
    refs = current;
    const texts = [];
    let length = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const n = walker.currentNode, p = n.parentElement;
      if (!p || p.closest('script,style,noscript,textarea,select') || sensitive(p) || !rendered(p)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      if (!Array.from(range.getClientRects()).some(visible)) continue;
      const text = clean(n.textContent,16001);
      if (!text) continue;
      const separator = texts.length ? 1 : 0;
      const remaining = 16000 - length - separator;
      if (remaining <= 0) { truncated = true; break; }
      texts.push(text.slice(0,remaining));
      length += separator + Math.min(text.length,remaining);
      if (text.length > remaining) { truncated = true; break; }
    }
    return {url:location.href,title:document.title.slice(0,500),text:texts.join('\n'),elements,scroll:{x:scrollX,y:scrollY},documentId:prefix,truncated};
  };
  const act = command => {
    const el = command.elementId ? refs.get(command.elementId) : null;
    if(command.elementId && (!el || !el.isConnected || !rendered(el) || sensitive(el))) throw Error('Stale browser element');
    if(command.kind === 'scroll') {
      if(el) el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      else scrollTo({left:command.x ?? scrollX,top:command.y ?? scrollY,behavior:'instant'});
      return;
    }
    if(!el || el.disabled || el.getAttribute('aria-disabled') === 'true') throw Error('Browser element is disabled');
    const r = el.getBoundingClientRect();
    if(!visible(r)) throw Error('Scroll browser element into view first');
    const hit = document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.y+r.height/2)));
    if(!hit || !(hit === el || el.contains(hit))) throw Error('Browser element is obscured');
    if(command.kind === 'click') { el.click(); return; }
    if(command.kind === 'type') {
      if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || !/^(text|search|email|url|tel|number)?$/.test(el.type === 'textarea' ? '' : el.type)) throw Error('Browser element is not an editable text field');
      el.focus();
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,command.text);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }
  };
  globalThis[key] = {document,snapshot,act};
})()`;

export const browserSnapshotScript = `${browserDOM}; globalThis.__superiorSwarmBrowser.snapshot()`;

export function browserActionScript(command: object, expectedSnapshot: string): string {
	return `${browserDOM}; (() => {
		const control = globalThis.__superiorSwarmBrowser;
		const expected = JSON.parse(${JSON.stringify(expectedSnapshot)});
		const current = control.snapshot();
		if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error('Browser observation changed before action');
		control.act(${JSON.stringify(command)});
	})()`;
}

/**
 * The script that runs inside the page being recorded or replayed. It is written as a normal function and injected as text
 * (`(${pageAgent})()`), so it must not use anything from this module: it runs in the page, not here. It is idempotent: injecting
 * it again after a navigation installs it once per document.
 *
 * Recording: it queues what the person does (clicks, typing, keys, scrolling) and what the page throws, and the recorder drains the
 * queue. Replay: `perform` re-does one recorded step. Typing into a password-like field is never captured.
 */
export function pageAgent(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = window as any;
  if (w.__dbRec) return;
  const queue: any[] = [];
  const api: any = { drain: undefined, snapshot: undefined, perform: undefined, info: undefined };
  w.__dbRec = api;

  // What the previous document of this tab had not yet handed over when it unloaded.
  try {
    const left = sessionStorage.getItem('__dbRecQ');
    if (left) {
      sessionStorage.removeItem('__dbRecQ');
      const items = JSON.parse(left);
      if (Array.isArray(items)) queue.push(...items);
    }
  } catch { /* storage unavailable: nothing carried over */ }
  const stash = () => { try { if (queue.length) sessionStorage.setItem('__dbRecQ', JSON.stringify(queue)); } catch { /* ignore */ } };
  addEventListener('pagehide', stash, true);
  addEventListener('beforeunload', stash, true);

  const push = (e: any) => { e.at = Date.now(); queue.push(e); if (queue.length > 4000) queue.splice(0, 1000); };
  const SECRET_FIELD = /pass|pwd|token|secret|otp|cvv|cvc|card|ssn|auth|pin\b/i;
  const esc = (s: string) => (w.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  function selectorOf(el: Element): string {
    for (const a of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${v.replace(/"/g, '\\"')}"]`;
    }
    const stable = (id: string) => id && !/\d{4,}|[0-9a-f]{8,}|:r\d/i.test(id) && document.querySelectorAll('#' + esc(id)).length === 1;
    if (el.id && stable(el.id)) return '#' + esc(el.id);
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      if (node !== el && node.id && stable(node.id)) { parts.unshift('#' + esc(node.id)); break; }
      if (node === document.documentElement) break;
      const tag = node.tagName.toLowerCase();
      const name = node.getAttribute('name');
      let part = tag;
      if (name && document.querySelectorAll(`${tag}[name="${name.replace(/"/g, '\\"')}"]`).length === 1) { parts.unshift(`${tag}[name="${name.replace(/"/g, '\\"')}"]`); break; }
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }
  function describe(el: Element) {
    const input = el as HTMLInputElement;
    return {
      selector: selectorOf(el), tag: el.tagName.toLowerCase(),
      text: clip((el as HTMLElement).innerText || input.value, 80) || undefined,
      label: clip(el.getAttribute('aria-label') || el.getAttribute('title') || input.placeholder || el.getAttribute('name') || el.getAttribute('alt'), 80) || undefined,
      role: el.getAttribute('role') || undefined
    };
  }
  const interactive = (el: Element) => el.closest('a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],[data-testid]') || el;
  const isSecret = (el: Element) => {
    const i = el as HTMLInputElement;
    return i.type === 'password' || SECRET_FIELD.test(`${i.name} ${i.id} ${i.autocomplete} ${el.getAttribute('aria-label') ?? ''} ${i.placeholder ?? ''}`);
  };

  addEventListener('click', e => {
    const t = e.target as Element | null;
    if (!t || !t.tagName) return;
    push({ type: 'click', target: describe(interactive(t)), x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }, true);

  const typing = new Map<Element, ReturnType<typeof setTimeout>>();
  const flushInput = (el: Element) => {
    clearTimeout(typing.get(el)); typing.delete(el);
    const i = el as HTMLInputElement;
    const secret = isSecret(el);
    push({ type: 'input', target: describe(el), value: secret ? '' : String(i.value ?? ''), masked: secret });
  };
  addEventListener('input', e => {
    const el = e.target as HTMLInputElement | null;
    if (!el || !el.tagName || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(checkbox|radio|file|button|submit|range|color)$/.test(el.type)) return;
    clearTimeout(typing.get(el));
    typing.set(el, setTimeout(() => flushInput(el), 600));
  }, true);
  addEventListener('change', e => {
    const el = e.target as HTMLElement | null;
    if (!el || !el.tagName) return;
    if (el.tagName === 'SELECT') flushInput(el);
    else if (typing.has(el)) flushInput(el);
  }, true);
  addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    const t = e.target as Element | null;
    if (t && typing.has(t)) flushInput(t); // the text typed before Enter comes first
    push({ type: 'key', key: e.key, target: t && t.tagName && t !== document.body ? describe(t) : undefined });
  }, true);

  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => push({ type: 'scroll', x: Math.round(scrollX), y: Math.round(scrollY) }), 350);
  }, { capture: true, passive: true });

  addEventListener('error', e => {
    if (e instanceof ErrorEvent) push({ type: 'error', message: e.message || 'Script error', source: e.filename || undefined, line: e.lineno || undefined, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 4000) : undefined });
  }, true);
  addEventListener('unhandledrejection', e => {
    const r: any = e.reason;
    push({ type: 'error', message: 'Unhandled promise rejection: ' + (r && r.message ? r.message : String(r)), stack: r && r.stack ? String(r.stack).slice(0, 4000) : undefined });
  });

  api.drain = () => queue.splice(0, queue.length);
  api.info = () => ({ width: innerWidth, height: innerHeight, userAgent: navigator.userAgent, url: location.href, title: document.title });

  // The page as it is now, safe to look at later: no scripts, no handlers, typed values kept except for secret fields.
  api.snapshot = () => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script,noscript,iframe,object,embed,link[rel=preload],link[rel=modulepreload]').forEach(n => n.remove());
    const live = Array.from(document.querySelectorAll('input,textarea,select'));
    clone.querySelectorAll('input,textarea,select').forEach((n, i) => {
      const src = live[i] as HTMLInputElement | undefined;
      if (!src) return;
      if (isSecret(src)) { n.removeAttribute('value'); if (n.tagName === 'TEXTAREA') n.textContent = ''; return; }
      if (n.tagName === 'TEXTAREA') n.textContent = src.value;
      else if (n.tagName === 'INPUT') { n.setAttribute('value', src.value); if (src.checked) n.setAttribute('checked', ''); else n.removeAttribute('checked'); }
    });
    clone.querySelectorAll('*').forEach(n => {
      for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
    });
    // Styles inlined, so a snapshot looks right without the dev server (and with the app's own security policy).
    const origLinks = Array.from(document.querySelectorAll('link[rel=stylesheet]'));
    const cloneLinks = Array.from(clone.querySelectorAll('link[rel=stylesheet]'));
    origLinks.forEach((l, i) => {
      try {
        const sheet = (l as HTMLLinkElement).sheet;
        if (!sheet) return;
        const st = document.createElement('style');
        st.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        cloneLinks[i]?.replaceWith(st);
      } catch { /* a cross-origin sheet cannot be read: left as a link */ }
    });
    const head = clone.querySelector('head');
    if (head) { const base = document.createElement('base'); base.href = location.href; head.prepend(base); }
    return { url: location.href, html: ('<!doctype html>' + clone.outerHTML).slice(0, 400000) };
  };

  // ---- replay: re-do one recorded step ----------------------------------------------------------------------------------------
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function resolve(t: any): Element | null {
    let el: Element | null = null;
    try { el = document.querySelector(t.selector); } catch { /* an invalid selector falls through to the text search */ }
    if (el && visible(el)) return el;
    const same = Array.from(document.querySelectorAll(t.tag)).filter(visible);
    return same.find(n => t.text && clip((n as HTMLElement).innerText || (n as HTMLInputElement).value, 80) === t.text)
      || same.find(n => t.label && (clip(n.getAttribute('aria-label') || n.getAttribute('title') || (n as HTMLInputElement).placeholder || n.getAttribute('name'), 80) === t.label))
      || null;
  }
  function ghost(el: Element) {
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid #ff4d5e;border-radius:6px;background:rgba(255,77,94,.12);z-index:2147483647;pointer-events:none;transition:opacity .5s ease .25s`;
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 900);
  }
  function setValue(el: any, value: string) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  api.perform = (step: any): 'ok' | 'missed' | 'skipped' => {
    try {
      if (step.kind === 'scroll') { scrollTo(step.x, step.y); return 'ok'; }
      if (step.kind === 'key') {
        const el: any = (step.target && resolve(step.target)) || document.activeElement || document.body;
        for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: step.key, code: step.key, bubbles: true, cancelable: true }));
        if (step.key === 'Enter' && el.form && typeof el.form.requestSubmit === 'function' && el.tagName === 'INPUT') el.form.requestSubmit();
        return 'ok';
      }
      const el: any = resolve(step.target);
      if (!el) return 'missed';
      el.scrollIntoView({ block: 'center', inline: 'center' });
      ghost(el);
      if (step.kind === 'click') { el.focus?.({ preventScroll: true }); el.click(); return 'ok'; }
      if (step.kind === 'input') {
        if (step.masked) return 'skipped'; // never recorded, so it cannot be re-typed
        el.focus?.({ preventScroll: true });
        setValue(el, step.value);
        return 'ok';
      }
      return 'skipped';
    } catch {
      return 'missed';
    }
  };
}

/** The code to run in the page: installs the agent (once per document), then evaluates `expression`. */
export const inject = (expression: string): string => `(${pageAgent.toString()})(); ${expression}`;

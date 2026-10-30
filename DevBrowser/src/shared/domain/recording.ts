import { z } from 'zod';
import { redactUrl, SECRET_HEADER, type NetworkTransaction } from './network';

/**
 * A bug recording: what a person did in a page, and what the page and the network did in return, as one file a teammate can
 * open and replay. Pure data and pure functions here; capturing lives in the renderer (`browser/recorder.ts`).
 */
export const RECORDING_FORMAT = 'devbrowser-recording';
export const RECORDING_VERSION = 1;
export const RECORDING_EXTENSION = '.devrec.json';

/** Limits that keep a file shareable (and a hostile one from exhausting memory when opened). */
export const LIMITS = { steps: 6000, body: 16_000, html: 400_000, screenshot: 400_000, file: 25_000_000, screenshots: 6 } as const;

export const TargetSchema = z.object({
  selector: z.string().max(600),
  tag: z.string().max(40),
  text: z.string().max(200).optional(),
  label: z.string().max(200).optional(),
  role: z.string().max(40).optional()
});
export type RecordedTarget = z.infer<typeof TargetSchema>;

const base = { t: z.number().min(0) }; // milliseconds from the start of the recording
export const StepSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('navigate'), url: z.string().max(4000), title: z.string().max(300).optional() }),
  z.object({ ...base, kind: z.literal('click'), target: TargetSchema, x: z.number().optional(), y: z.number().optional() }),
  z.object({ ...base, kind: z.literal('input'), target: TargetSchema, value: z.string().max(4000), masked: z.boolean().default(false) }),
  z.object({ ...base, kind: z.literal('key'), key: z.string().max(40), target: TargetSchema.optional() }),
  z.object({ ...base, kind: z.literal('scroll'), x: z.number(), y: z.number() }),
  z.object({ ...base, kind: z.literal('console'), level: z.enum(['log', 'warning', 'error']), message: z.string().max(4000) }),
  z.object({ ...base, kind: z.literal('error'), message: z.string().max(4000), source: z.string().max(500).optional(), line: z.number().optional(), stack: z.string().max(6000).optional() }),
  z.object({
    ...base, kind: z.literal('request'), id: z.string().max(200), method: z.string().max(12), url: z.string().max(4000),
    status: z.number().optional(), durationMs: z.number().optional(), error: z.string().max(500).optional(), mimeType: z.string().max(200).optional(),
    requestHeaders: z.record(z.string()).optional(), responseHeaders: z.record(z.string()).optional(),
    requestBody: z.string().max(LIMITS.body + 40).optional(), responseBody: z.string().max(LIMITS.body + 40).optional()
  }),
  z.object({
    ...base, kind: z.literal('snapshot'), label: z.string().max(200), url: z.string().max(4000),
    html: z.string().max(LIMITS.html).optional(), screenshot: z.string().max(LIMITS.screenshot).optional()
  })
]);
export type RecordedStep = z.infer<typeof StepSchema>;
export type StepKind = RecordedStep['kind'];

export const RecordingSchema = z.object({
  format: z.literal(RECORDING_FORMAT),
  version: z.literal(RECORDING_VERSION),
  id: z.string().max(100),
  title: z.string().max(300),
  createdAt: z.number(),
  app: z.object({ name: z.string().max(60), version: z.string().max(40) }),
  startUrl: z.string().max(4000),
  viewport: z.object({ width: z.number(), height: z.number() }),
  userAgent: z.string().max(500).optional(),
  durationMs: z.number().min(0),
  /** How many secrets were removed before this file was written. */
  redactions: z.number().min(0).default(0),
  steps: z.array(StepSchema).max(LIMITS.steps)
});
export type Recording = z.infer<typeof RecordingSchema>;

// ---- redaction: a recording is meant to be shared, so credentials never go into it -----------------------------------------

const SECRET_KEY = /token|secret|password|passwd|pwd|api[-_]?key|apikey|auth|session|signature|credential|authorization|cookie|otp|cvv|card/i;
const SECRET_VALUE: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,           // a JWT
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,                                  // an Authorization value
  /\b(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{16,}\b/g,                      // Stripe / OpenAI style keys
  /\bAKIA[0-9A-Z]{16}\b/g,                                                        // an AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,                                              // a GitHub token
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g                                             // a Slack token
];
export const REDACTED = '[redacted]';

/** Removes credentials from free text and JSON bodies. Returns the cleaned text and how many things were removed. */
export function redactText(input: string): { text: string; count: number } {
  let count = 0;
  let text = input;
  // JSON-ish `"password": "value"` pairs, whatever the surrounding document.
  text = text.replace(/("([^"\\]{1,60})"\s*:\s*)"((?:[^"\\]|\\.){1,2000})"/g, (m, head: string, key: string) => {
    if (!SECRET_KEY.test(key)) return m;
    count++;
    return `${head}"${REDACTED}"`;
  });
  for (const re of SECRET_VALUE) text = text.replace(re, () => { count++; return REDACTED; });
  return { text, count };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [truncated ${s.length - n} characters]` : s);

/** A captured request as a step: credentials removed from headers, URL and bodies; bodies cut to a shareable size. */
export function requestStep(tx: NetworkTransaction, startedAt: number, options: { bodies?: boolean } = {}): { step: RecordedStep; redactions: number } {
  let redactions = 0;
  const headers = (h: Record<string, string> | undefined) => {
    if (!h) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      if (SECRET_HEADER.test(k)) { out[k] = REDACTED; redactions++; } else out[k] = clip(v, 400);
    }
    return out;
  };
  const redacted = redactUrl(tx.url);
  if (redacted !== tx.url) redactions++;
  const url = redacted.length > 3900 ? redacted.slice(0, 3900) : redacted;
  const body = (b: string | undefined) => {
    if (!options.bodies || !b) return undefined;
    const r = redactText(b); redactions += r.count;
    return clip(r.text, LIMITS.body);
  };
  const step: RecordedStep = {
    t: Math.max(0, tx.startTime - startedAt), kind: 'request', id: tx.id, method: tx.method, url,
    status: tx.statusCode, error: tx.error, mimeType: tx.mimeType,
    durationMs: tx.endTime !== undefined ? Math.max(0, tx.endTime - tx.startTime) : undefined,
    requestHeaders: headers(tx.requestHeaders), responseHeaders: headers(tx.responseHeaders),
    requestBody: body(tx.requestBody), responseBody: body(tx.responseBody)
  };
  return { step, redactions };
}

/** Steps in time order; a console error the page also threw is kept once; the list is capped. */
export function orderSteps(steps: RecordedStep[]): RecordedStep[] {
  const sorted = [...steps].sort((a, b) => a.t - b.t);
  const same = (a: string, b: string) => a.includes(b.slice(0, 60)) || b.includes(a.slice(0, 60));
  const out: RecordedStep[] = [];
  for (const s of sorted) {
    if (s.kind === 'console' && s.level === 'error' && out.some(o => o.kind === 'error' && Math.abs(o.t - s.t) < 250 && same(s.message, o.message))) continue;
    if (s.kind === 'error') {
      const twin = out.findIndex(o => o.kind === 'console' && o.level === 'error' && Math.abs(o.t - s.t) < 250 && same(s.message, o.message));
      if (twin >= 0) out.splice(twin, 1); // the page's own report replaces the console line, which says the same thing
    }
    out.push(s);
  }
  return out.slice(0, LIMITS.steps);
}

export function buildRecording(input: {
  id: string; title: string; startedAt: number; endedAt: number; startUrl: string; viewport: { width: number; height: number };
  userAgent?: string; steps: RecordedStep[]; redactions: number; appVersion: string;
}): Recording {
  return {
    format: RECORDING_FORMAT, version: RECORDING_VERSION, id: input.id, title: input.title, createdAt: input.startedAt,
    app: { name: 'DevBrowser', version: input.appVersion }, startUrl: input.startUrl, viewport: input.viewport, userAgent: input.userAgent,
    durationMs: Math.max(0, input.endedAt - input.startedAt), redactions: input.redactions, steps: orderSteps(input.steps)
  };
}

export type ParseResult = { ok: true; recording: Recording } | { ok: false; error: string };

/** Opens a recording file's text. Anything that is not a version-1 recording is refused with a reason, never half-loaded. */
export function parseRecording(text: string): ParseResult {
  if (text.length > LIMITS.file) return { ok: false, error: 'This file is too large to be a bug recording.' };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This is not a recording: the file is not valid JSON.' }; }
  const head = json as { format?: unknown; version?: unknown };
  if (head?.format !== RECORDING_FORMAT) return { ok: false, error: 'This is not a DevBrowser recording.' };
  if (head.version !== RECORDING_VERSION) return { ok: false, error: `This recording is version ${String(head.version)}; this DevBrowser opens version ${RECORDING_VERSION}. Update DevBrowser.` };
  const parsed = RecordingSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `The recording is damaged (${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'invalid'}).` };
  }
  return { ok: true, recording: parsed.data };
}

export const serializeRecording = (r: Recording): string => JSON.stringify(r);

export function fileName(r: Pick<Recording, 'title' | 'createdAt'>): string {
  const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bug';
  return `${slug}-${new Date(r.createdAt).toISOString().slice(0, 16).replace(/[-:T]/g, '')}${RECORDING_EXTENSION}`;
}

// ---- reading a recording ---------------------------------------------------------------------------------------------------

export const isFailedRequest = (s: RecordedStep): boolean => s.kind === 'request' && (!!s.error || (s.status ?? 0) >= 400 || s.status === 0);

export interface RecordingSummary { actions: number; requests: number; failedRequests: number; errors: number; navigations: number; snapshots: number }
export function summarize(r: Recording): RecordingSummary {
  const n = (f: (s: RecordedStep) => boolean) => r.steps.filter(f).length;
  return {
    actions: n(s => s.kind === 'click' || s.kind === 'input' || s.kind === 'key'),
    requests: n(s => s.kind === 'request'), failedRequests: n(isFailedRequest),
    errors: n(s => s.kind === 'error' || (s.kind === 'console' && s.level === 'error')),
    navigations: n(s => s.kind === 'navigate'), snapshots: n(s => s.kind === 'snapshot')
  };
}

export const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };
export const pathOf = (url: string): string => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

export function describeStep(s: RecordedStep): string {
  const who = (t: RecordedTarget) => t.label || (t.text ? `"${t.text}"` : '') || t.selector;
  switch (s.kind) {
    case 'navigate': return `Opened ${s.url}`;
    case 'click': return `Clicked ${s.target.tag === 'a' ? 'link' : s.target.tag === 'button' ? 'button' : s.target.tag} ${who(s.target)}`;
    case 'input': return `Typed ${s.masked ? '••••••' : `"${s.value.length > 40 ? s.value.slice(0, 40) + '…' : s.value}"`} into ${who(s.target)}`;
    case 'key': return `Pressed ${s.key}`;
    case 'scroll': return `Scrolled to ${Math.round(s.y)}px`;
    case 'console': return `Console ${s.level}: ${s.message}`;
    case 'error': return `Uncaught error: ${s.message}`;
    case 'request': return `${s.method} ${pathOf(s.url)} → ${s.error ? s.error : s.status ?? '…'}`;
    case 'snapshot': return `Snapshot: ${s.label}`;
  }
}

/**
 * Where it went wrong: the first error or failing request, and the last thing the person did in the few seconds before it.
 * This is the line a bug report starts with.
 */
export function diagnose(r: Recording): { firstProblem?: RecordedStep; trigger?: RecordedStep; problems: RecordedStep[] } {
  const problems = r.steps.filter(s => s.kind === 'error' || isFailedRequest(s) || (s.kind === 'console' && s.level === 'error'));
  const firstProblem = problems[0];
  if (!firstProblem) return { problems };
  const trigger = [...r.steps].reverse().find(s => s.t <= firstProblem.t + 50 && firstProblem.t - s.t <= 5000 && (s.kind === 'click' || s.kind === 'input' || s.kind === 'key'));
  return { firstProblem, trigger, problems };
}

/** A default title from what went wrong, so a recording is findable in a list. */
export function suggestTitle(steps: RecordedStep[], startUrl: string): string {
  const err = steps.find(s => s.kind === 'error');
  if (err && err.kind === 'error') return err.message.slice(0, 70);
  const bad = steps.find(isFailedRequest);
  if (bad && bad.kind === 'request') return `${bad.method} ${pathOf(bad.url).slice(0, 50)} → ${bad.error ?? bad.status}`;
  return `Session on ${hostOf(startUrl)}`;
}

// ---- replaying --------------------------------------------------------------------------------------------------------------

export type ReplayAction = Extract<RecordedStep, { kind: 'click' | 'input' | 'key' | 'scroll' | 'navigate' }>;

/**
 * What a replay performs, in order. Clicks, typing, keys and scrolling are re-performed. The first address is opened by the
 * replay itself; a later navigation is only re-performed when the person typed it (nothing they did caused it), since a click
 * that loads a page loads it again on its own.
 */
export function replayPlan(r: Recording): ReplayAction[] {
  const plan: ReplayAction[] = [];
  let lastAction = -Infinity;
  let first = true;
  for (const s of r.steps) {
    if (s.kind === 'navigate') {
      if (first) { first = false; continue; }
      if (s.t - lastAction > 2500) plan.push(s);
      continue;
    }
    if (s.kind === 'click' || s.kind === 'input' || s.kind === 'key') { plan.push(s); lastAction = s.t; }
    else if (s.kind === 'scroll') plan.push(s);
  }
  return plan;
}

/** The pause before a step, kept close to what the person did but never so long that a replay feels stuck. */
export function pauseBefore(step: { t: number }, previous: { t: number } | undefined, speed = 1): number {
  const gap = previous ? step.t - previous.t : 400;
  return Math.round(Math.min(1400, Math.max(120, gap)) / Math.max(0.25, speed));
}

/** Messages compared across machines: numbers, ids and hashes differ per run, the wording does not. */
export const signature = (message: string): string =>
  message.toLowerCase().replace(/https?:\/\/[^\s)]+/g, '<url>').replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/g, "<id>").replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 140);

export interface ObservedRun { errors: string[]; failedRequests: { method: string; path: string; status: number | string }[] }
export interface Verdict {
  verdict: 'reproduced' | 'partly' | 'not-reproduced' | 'nothing-to-compare';
  matched: string[];
  missing: string[];
  extra: string[];
}

/** Did the replay hit the same problems the recording shows? Compares uncaught errors / console errors and failing requests. */
export function compareRun(r: Recording, observed: ObservedRun): Verdict {
  const expected: { key: string; text: string }[] = [];
  for (const s of r.steps) {
    if (s.kind === 'error' || (s.kind === 'console' && s.level === 'error')) expected.push({ key: `e:${signature(s.message)}`, text: s.message });
    else if (s.kind === 'request' && isFailedRequest(s)) expected.push({ key: `r:${s.method} ${pathOf(s.url).split('?')[0]} ${s.error ? 'err' : s.status}`, text: `${s.method} ${pathOf(s.url)} → ${s.error ?? s.status}` });
  }
  const seen = new Set<string>([
    ...observed.errors.map(m => `e:${signature(m)}`),
    ...observed.failedRequests.map(q => `r:${q.method} ${q.path.split('?')[0]} ${typeof q.status === 'string' ? 'err' : q.status}`)
  ]);
  const uniq = [...new Map(expected.map(e => [e.key, e])).values()];
  if (!uniq.length) return { verdict: 'nothing-to-compare', matched: [], missing: [], extra: [...seen].map(k => k.slice(2)) };
  const matched = uniq.filter(e => seen.has(e.key)), missing = uniq.filter(e => !seen.has(e.key));
  const known = new Set(uniq.map(e => e.key));
  return {
    verdict: matched.length === uniq.length ? 'reproduced' : matched.length ? 'partly' : 'not-reproduced',
    matched: matched.map(e => e.text), missing: missing.map(e => e.text), extra: [...seen].filter(k => !known.has(k)).map(k => k.slice(2))
  };
}

/** Swap the origin of a recorded address for another (the teammate's dev server runs on a different port). */
export function rebase(url: string, fromOrigin: string, toOrigin: string): string {
  try {
    const u = new URL(url);
    if (u.origin !== new URL(fromOrigin).origin) return url;
    const to = new URL(toOrigin);
    return `${to.origin}${u.pathname}${u.search}${u.hash}`;
  } catch { return url; }
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceX, forceY } from 'd3-force';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import type { SentinelLink, SentinelNode } from '../../../shared/domain/sentinel';

/**
 * SentinelGraph's live topology, as the web dashboard draws it: a force layout where a service's size is its
 * PageRank, colour is health, and the agent's path lights up during an investigation. Colours come from the
 * app's three tokens (accent, warn, danger) over neutrals, read from CSS so both themes work.
 */

type N = NodeObject<SentinelNode>;
type L = LinkObject<SentinelNode, SentinelLink>;

export interface GraphHighlight {
  nodes: Set<string>;
  edges: Set<string>;
  currentNodes: Set<string>;
  currentEdges: Set<string>;
  /** accent: the agent's path; danger: a blast radius. */
  tone: 'accent' | 'danger';
}

interface Props {
  nodes: SentinelNode[];
  links: SentinelLink[];
  highlight: GraphHighlight;
  showContext: boolean;
  selected: string | null;
  onSelect: (node: SentinelNode | null) => void;
  fitKey: number;
  theme: string;
}

const LAYER_Y: Record<string, number> = { edge: -340, business: -100, data: 170, platform: 340 };
const INFRA = new Set(['Service', 'Database']);
const RECENT_MS = 2 * 60 * 60 * 1000;
const CONTEXT_LINK = (t: string) => !['DEPENDS_ON', 'READS_FROM', 'WRITES_TO'].includes(t);

interface Palette {
  accent: string; warn: string; danger: string; ink: string; muted: string; faint: string; surface: string; bg: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { accent: v('--accent'), warn: v('--warn'), danger: v('--danger'), ink: v('--text-primary'),
    muted: v('--text-secondary'), faint: v('--text-muted'), surface: v('--bg-tertiary'), bg: v('--bg-secondary') };
}

/** `#rrggbb` + alpha -> rgba(), for translucent strokes from the theme's tokens. */
function alpha(hex: string, a: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}

const endId = (end: L['source']) => (typeof end === 'object' && end ? String((end as N).id) : String(end));

function radius(n: N): number {
  if (n.type === 'Service') return 5.5 + 22 * Math.sqrt(n.pagerank ?? 0.01);
  if (n.type === 'Database') return 6.5;
  if (n.type === 'Incident' || n.type === 'Deployment') return 4.5;
  return 3.5;
}

function isLive(n: SentinelNode, now: number): boolean {
  switch (n.type) {
    case 'Alert': return n.status !== 'resolved';
    case 'Deployment': return (n.at ?? 0) >= now - RECENT_MS && n.status === 'live';
    case 'Action': return n.status === 'pending';
    case 'Incident': return n.status === 'investigating' || n.status === 'mitigating';
    default: return false;
  }
}

function shape(ctx: CanvasRenderingContext2D, n: N, r: number): void {
  const x = n.x ?? 0;
  const y = n.y ?? 0;
  ctx.beginPath();
  switch (n.type) {
    case 'Database':
      ctx.roundRect(x - r, y - r * 0.8, r * 2, r * 1.6, r * 0.4);
      break;
    case 'Deployment':
    case 'Incident':
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r * 1.3, y);
      ctx.lineTo(x, y + r * 1.3);
      ctx.lineTo(x - r * 1.3, y);
      ctx.closePath();
      break;
    case 'Alert':
      ctx.moveTo(x, y - r * 1.4);
      ctx.lineTo(x + r * 1.3, y + r);
      ctx.lineTo(x - r * 1.3, y + r);
      ctx.closePath();
      break;
    case 'Team':
    case 'Runbook':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

/** Status colour: only failures get a colour; everything healthy stays neutral. */
function statusColor(p: Palette, n: SentinelNode): string | null {
  if (n.status === 'down' || n.type === 'Alert') return p.danger;
  if (n.status === 'degraded' || (n.type === 'Action' && n.status === 'pending')) return p.warn;
  return null;
}

export const GraphCanvas: React.FC<Props> = ({ nodes, links, highlight, showContext, selected, onSelect, fitKey, theme }) => {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [now, setNow] = useState(() => Date.now());
  const fitted = useRef(false);
  // Re-read the colour tokens whenever the theme changes.
  const palette = useMemo(readPalette, [theme]);

  // Reuse node objects across refreshes so the layout keeps its positions instead of starting over.
  const known = useRef(new Map<string, N>());
  const data = useMemo(() => {
    const next = new Map<string, N>();
    const graphNodes = nodes.map(n => {
      const node = Object.assign(known.current.get(n.id) ?? {}, n) as N;
      next.set(n.id, node);
      return node;
    });
    known.current = next;
    return { nodes: graphNodes, links: links.map(l => ({ ...l })) as L[] };
  }, [nodes, links]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Keep the graph framed when its box changes size (dock resized, inspector opened), until the user takes
  // over by zooming or panning; Fit hands control back.
  const userMoved = useRef(false);
  const visibleRef = useRef<(n: SentinelNode) => boolean>(n => INFRA.has(n.type));
  const fitUntil = useRef(0); // zoom events before this time come from our own fit animation, not the user
  const fit = (ms: number) => {
    fitUntil.current = Date.now() + ms + 200;
    fg.current?.zoomToFit(ms, 40, n => visibleRef.current(n)); // frame everything shown, incl. live alerts and deploys
  };
  useEffect(() => {
    if (fitKey) userMoved.current = false;
    if (fitKey || (fitted.current && !userMoved.current)) {
      const t = setTimeout(() => fit(400), 450); // after the force layout has had time to spread new nodes out
      return () => clearTimeout(t);
    }
    // `fit` only reads refs, so it isn't a dependency. Re-fit when services come or go (a codebase was connected).
  }, [fitKey, size.w, size.h, nodes.length]);

  // Top 5 chokepoints by betweenness get a dashed ring.
  const chokepoints = useMemo(() => new Set(nodes.filter(n => n.type === 'Service')
    .sort((a, b) => (b.betweenness ?? 0) - (a.betweenness ?? 0)).slice(0, 5).map(n => n.id)), [nodes]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force('y', forceY<N>(n => (n.layer ? LAYER_Y[n.layer] ?? 0 : n.type === 'Database' ? 380 : 0))
      .strength(n => (INFRA.has(n.type) ? 0.3 : 0)));
    g.d3Force('collide', forceCollide<N>(n => radius(n) + 4));
    g.d3Force('x', forceX<N>(0).strength(n => (INFRA.has(n.type) ? 0.015 : 0)));
    g.d3Force('charge')?.strength?.((n: N) => (INFRA.has(n.type) ? -320 : -40));
    const link = g.d3Force('link');
    link?.distance?.((l: L) => (l.type === 'DEPENDS_ON' ? 80 : 30));
    link?.strength?.((l: L) => (l.type === 'DEPENDS_ON' ? 0.12 : l.type === 'OWNS' ? 0.02 : 0.6));
    g.d3ReheatSimulation();
  }, [data]);

  const byId = useMemo(() => new Map(data.nodes.map(n => [n.id, n])), [data]);
  const visible = (n: SentinelNode) =>
    INFRA.has(n.type) || showContext || highlight.nodes.has(n.id) || isLive(n, now) || n.id === selected;
  visibleRef.current = visible;
  const linkVisible = (l: L) => {
    const s = byId.get(endId(l.source));
    const t = byId.get(endId(l.target));
    if (!s || !t || !visible(s) || !visible(t)) return false;
    if (l.type === 'OWNS') return showContext || highlight.edges.has(l.id) || (highlight.nodes.has(s.id) && highlight.nodes.has(t.id));
    return true;
  };
  const failingTarget = (l: L) => {
    const t = byId.get(endId(l.target));
    return l.type === 'DEPENDS_ON' && l.breaker !== 'open' && !!t?.status && t.status !== 'healthy';
  };
  const hl = highlight.tone === 'accent' ? palette.accent : palette.danger;

  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }}>
      <ForceGraph2D<SentinelNode, SentinelLink>
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        autoPauseRedraw={false}
        cooldownTicks={180}
        d3VelocityDecay={0.35}
        minZoom={0.3}
        maxZoom={8}
        onEngineStop={() => {
          if (!fitted.current) {
            fitted.current = true;
            fit(600);
          } else if (!userMoved.current) {
            fit(400); // the layout settled after the graph changed (a codebase was connected): frame it again
          }
        }}
        nodeVisibility={n => visible(n)}
        linkVisibility={linkVisible}
        nodeLabel={n => tooltip(n)}
        onNodeClick={n => onSelect(n)}
        onBackgroundClick={() => onSelect(null)}
        onZoomEnd={() => { if (fitted.current && Date.now() > fitUntil.current) userMoved.current = true; }}
        linkColor={l => {
          if (highlight.currentEdges.has(l.id)) return alpha(hl, 0.95);
          if (highlight.edges.has(l.id)) return alpha(hl, 0.6);
          if (l.breaker === 'open') return alpha(palette.warn, 0.85);
          if (failingTarget(l)) return alpha(palette.danger, 0.4);
          return alpha(palette.faint, l.type === 'DEPENDS_ON' ? 0.3 : 0.35);
        }}
        linkWidth={l => (highlight.currentEdges.has(l.id) ? 2.2 : highlight.edges.has(l.id) ? 1.5
          : l.breaker === 'open' ? 1.4 : failingTarget(l) ? 1 : 0.6)}
        linkLineDash={l => (l.breaker === 'open' ? [4, 3] : CONTEXT_LINK(l.type) ? [2, 2] : null)}
        linkDirectionalArrowLength={l => (l.type === 'DEPENDS_ON' ? 2.5 : 0)}
        linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={() => alpha(palette.faint, 0.6)}
        linkDirectionalParticles={l => (highlight.edges.has(l.id) ? 2 : failingTarget(l) ? 1 : 0)}
        linkDirectionalParticleWidth={l => (highlight.edges.has(l.id) ? 2 : 1.6)}
        linkDirectionalParticleSpeed={l => (highlight.edges.has(l.id) ? 0.01 : 0.005)}
        linkDirectionalParticleColor={l => (highlight.edges.has(l.id) ? hl : palette.danger)}
        nodeCanvasObject={(n, ctx, scale) => drawNode(n, ctx, scale, palette, hl, {
          visited: highlight.nodes.has(n.id), current: highlight.currentNodes.has(n.id),
          chokepoint: chokepoints.has(n.id), selected: n.id === selected
        })}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          shape(ctx, n, radius(n) + 2);
          ctx.fill();
        }}
      />
    </div>
  );
};

function drawNode(n: N, ctx: CanvasRenderingContext2D, scale: number, p: Palette, hl: string,
  o: { visited: boolean; current: boolean; chokepoint: boolean; selected: boolean }): void {
  const x = n.x ?? 0;
  const y = n.y ?? 0;
  const r = radius(n);
  const t = performance.now();
  const lw = (w: number) => w / Math.max(scale, 0.7);
  const isInfra = INFRA.has(n.type);
  const failing = statusColor(p, n);
  const unhealthy = isInfra && !!failing;

  // Only real failures move: a slow, soft pulse ring.
  if (unhealthy && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    const period = n.status === 'down' ? 1300 : 2000;
    const k = (t % period) / period;
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + k * 9, 0, 2 * Math.PI);
    ctx.strokeStyle = alpha(failing!, 0.5 * (1 - k));
    ctx.lineWidth = lw(1.5);
    ctx.stroke();
  }
  if (o.current) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
    ctx.strokeStyle = alpha(hl, 0.5 + 0.4 * Math.sin(t / 220));
    ctx.lineWidth = lw(1.5);
    ctx.stroke();
  }

  shape(ctx, n, r);
  ctx.fillStyle = failing ?? (isInfra ? p.surface : alpha(p.faint, 0.7));
  ctx.fill();
  ctx.lineWidth = lw(o.visited || o.selected ? 1.8 : 1);
  ctx.strokeStyle = o.selected ? p.ink : o.visited ? hl : failing ?? (isInfra ? p.faint : 'transparent');
  ctx.stroke();

  if (o.chokepoint && n.type === 'Service') {
    ctx.beginPath();
    ctx.setLineDash([2, 2]);
    ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
    ctx.strokeStyle = alpha(p.faint, 0.8);
    ctx.lineWidth = lw(0.8);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const named = n.type === 'Deployment' || n.type === 'Person';
  const showLabel = o.current || unhealthy || o.selected || ((isInfra || named) && o.visited) ||
    (n.type === 'Service' && scale > 0.95) || (isInfra && scale > 1.5) ||
    (n.type === 'Service' && (n.pagerank ?? 0) > 0.04 && scale > 0.8) || (!isInfra && scale > 2.2);
  if (!showLabel) return;
  const strong = o.visited || unhealthy || o.selected;
  const fontSize = Math.max(10.5 / scale, 2.2);
  ctx.font = `${strong ? 600 : 400} ${fontSize}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = n.label.length > 30 ? `${n.label.slice(0, 29)}...` : n.label;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = alpha(p.bg, 0.85);
  ctx.fillRect(x - w / 2 - 1.5, y + r + 2.5, w + 3, fontSize + 1.5);
  ctx.fillStyle = unhealthy ? failing! : o.visited ? hl : strong ? p.ink : p.muted;
  ctx.fillText(label, x, y + r + 3);
}

function tooltip(n: SentinelNode): string {
  const rows = [`<b>${esc(n.label)}</b> <span style="opacity:.6">${n.type}</span>`];
  if (n.status) rows.push(`status: ${esc(n.status)}`);
  if (n.tier) rows.push(`tier: ${esc(n.tier)}${n.layer ? ` · layer: ${esc(n.layer)}` : ''}`);
  if (n.team) rows.push(`team: ${esc(n.team)}`);
  if (n.pagerank) rows.push(`pagerank ${n.pagerank.toFixed(3)} · betweenness ${(n.betweenness ?? 0).toFixed(1)}`);
  if (n.change_summary) rows.push(esc(n.change_summary));
  if (n.message && n.type === 'Commit') rows.push(esc(n.message));
  if (n.metric) rows.push(`${esc(n.metric)} = ${n.value} (threshold ${n.threshold})`);
  if (n.title) rows.push(esc(n.title));
  if (n.reason) rows.push(esc(n.reason));
  return `<div style="font:12px -apple-system,system-ui;line-height:1.45;max-width:280px">${rows.join('<br/>')}</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

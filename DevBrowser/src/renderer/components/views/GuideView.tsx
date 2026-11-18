import React from 'react';
import {
  ArrowRight, Bot, CircleDot, FolderGit2, GitCompareArrows, Globe, History, Keyboard, LayoutDashboard, Network, Play, Send,
  Share2, ShieldAlert, ShieldCheck, Terminal
} from 'lucide-react';
import { useAppStore, type NavigationView } from '../../store/useAppStore';

const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
const MOD = mac ? '⌘' : 'Ctrl+';

interface Journey {
  title: string;
  why: string;
  steps: string[];
  cta: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * The product, on one page, inside the product: what it is, the journeys it supports from start to finish, every tool in one
 * line, and what runs where. Every "Try it" button does what its journey describes.
 */
export const GuideView: React.FC = () => {
  const setActiveView = useAppStore(s => s.setActiveView);
  const connectCodebase = useAppStore(s => s.connectCodebase);
  const checkImpact = useAppStore(s => s.checkImpact);
  const setShortcuts = useAppStore(s => s.setShortcutsModalOpen);
  const setPalette = useAppStore(s => s.setCommandPaletteOpen);
  const go = (v: NavigationView) => () => setActiveView(v);

  const journeys: Journey[] = [
    { title: 'Open your app and see what it is doing', icon: <Play size={16} />, cta: 'Run your project', run: go('run'),
      why: 'Your dev server, the page, its requests and its errors in one window.',
      steps: ['Start your dev server from Run (DevBrowser suggests the command), or type localhost:3000 in the address bar.',
        'The page opens in a tab by itself when the server is up.',
        'Network lists every request with timing, headers and bodies. Console shows errors. Security shows what the site exposes.'] },
    { title: 'Map your codebase', icon: <FolderGit2 size={16} />, cta: 'Connect a codebase', run: () => void connectCodebase(),
      why: 'A live map of your services, databases, outside APIs and who owns what. Nothing to draw.',
      steps: ['Connect a codebase and pick the project folder.',
        'Overview shows what was found: services or modules, connections, databases, owners and recent changes.',
        'System map draws it, front-ends at the top and data at the bottom. Browsing your app adds the calls that really happen.'] },
    { title: 'Find out why something broke', icon: <ShieldAlert size={16} />, cta: 'Open Overview', run: go('overview'),
      why: 'Alerts are symptoms. The map knows which one thing they share.',
      steps: ['When something fails, Overview shows the alerts in coral and an Investigate button.',
        'The agent walks the map: the unhealthy dependency the alerting services share, the change that landed there, who owns it.',
        'It proposes fixes with their risk (roll back, scale up, page the owner). Nothing runs until you approve.'] },
    { title: 'Check a change before you merge', icon: <GitCompareArrows size={16} />, cta: 'Check my changes',
      run: () => { setActiveView('dependencies'); void checkImpact(); },
      why: 'Know the blast radius of your edit while it is still on your machine.',
      steps: ['Edit code in the connected project as usual.',
        'Check my changes maps each changed file to its service or module.',
        'The map lights up everything that depends on it, with how risky the change is.'] },
    { title: 'Hand a bug to a teammate', icon: <CircleDot size={16} />, cta: 'Open Bug recorder', run: go('recorder'),
      why: 'One file instead of "works on my machine".',
      steps: ['Bug recorder → Record this tab, then do what triggers the bug.',
        'Export: clicks, requests, responses and console errors in one file. Passwords, tokens and cookies are removed.',
        'Your teammate opens it, replays it on their copy of the app, and DevBrowser says whether the same error happens.'] },
  ];

  const tools: [React.ReactNode, string, string, string?][] = [
    [<LayoutDashboard size={14} />, 'Overview', 'Your system at a glance: health, alerts, changes, approvals'],
    [<Share2 size={14} />, 'System map', 'Services and their dependencies; investigate and check changes here'],
    [<Network size={14} />, 'Network', 'Requests of the page you are on; mock a response; throttle; export HAR'],
    [<Terminal size={14} />, 'Console', 'Errors and warnings of the page you are on'],
    [<ShieldAlert size={14} />, 'Security', 'Read-only checks of what the site exposes, with evidence and fixes'],
    [<Send size={14} />, 'API client', 'Send requests, replay one from Network, import cURL, check responses'],
    [<Play size={14} />, 'Run', 'Start your dev server; crashes explained in plain words'],
    [<CircleDot size={14} />, 'Bug recorder', 'Record a bug as one shareable, replayable file'],
    [<Bot size={14} />, 'AI assistant', 'Ask about this page; runs on your machine with Ollama'],
    [<History size={14} />, 'History & bookmarks', 'Everything you visited and saved, searchable'],
    [<Globe size={14} />, 'Search', 'Every action by name', `${MOD}K`],
  ];

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 880, gap: 28 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">Guide</span>
          <h1 style={{ fontSize: 32 }}>DevBrowser, in one page</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 720 }}>
            DevBrowser is a web browser for people who build software. It shows everything the page you are on is doing.
            With <strong style={{ color: 'var(--text-primary)' }}>SentinelGraph</strong>, which it runs for you, it also keeps a live
            map of the system behind that page, and when something breaks it walks that map to the root cause.
          </p>
        </header>

        <section aria-label="In one minute" className="guide-pillars">
          <div className="card guide-pillar"><Globe size={18} color="var(--accent)" /><h3>Browse</h3>
            <p>A real browser: tabs, profiles, split view, device mode, history. Works with nothing set up.</p></div>
          <div className="card guide-pillar"><Network size={18} color="var(--accent)" /><h3>Inspect</h3>
            <p>The requests, errors and security of the page you are on, beside it, as you browse.</p></div>
          <div className="card guide-pillar"><Share2 size={18} color="var(--highlight)" /><h3>Understand your system</h3>
            <p>Your codebase as a map. Root cause, blast radius and fixes you approve.</p></div>
        </section>

        <section aria-label="What you can do" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="guide-h2">What you can do, start to finish</h2>
          {journeys.map((j, i) => (
            <article key={j.title} className="card guide-journey" aria-label={j.title}>
              <div className="guide-num">{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h3 style={{ fontSize: 16 }}>{j.title}</h3>
                <p className="muted" style={{ fontSize: 13 }}>{j.why}</p>
                <ol className="guide-steps">{j.steps.map(s => <li key={s}>{s}</li>)}</ol>
              </div>
              <button className="btn" onClick={j.run} style={{ alignSelf: 'flex-start' }}>{j.icon} {j.cta} <ArrowRight size={13} /></button>
            </article>
          ))}
        </section>

        <section aria-label="Every tool" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="guide-h2">Every tool, one line each</h2>
          <div className="card">
            {tools.map(([icon, name, what, key]) => (
              <div key={name} className="list-row" style={{ alignItems: 'center' }}>
                <span style={{ color: 'var(--accent)', display: 'flex', width: 18 }}>{icon}</span>
                <strong style={{ fontWeight: 600, width: 150, flexShrink: 0 }}>{name}</strong>
                <span className="muted" style={{ flex: 1 }}>{what}</span>
                {key && <span className="mono muted">{key}</span>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setPalette(true)}>Search every action <span className="mono muted">{MOD}K</span></button>
            <button className="btn" onClick={() => setShortcuts(true)}><Keyboard size={13} /> Keyboard shortcuts</button>
          </div>
        </section>

        <section aria-label="Codebases it maps" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="guide-h2">Codebases it maps</h2>
          <div className="card" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.6 }}>
            <p><strong>Several services:</strong> Docker Compose and Kubernetes, in any language. Databases, queues and the calls between
              services come from the configuration.</p>
            <p><strong>One product made of packages:</strong> npm, Yarn and pnpm workspaces, Gradle (Android, Kotlin, Java), Swift Package
              Manager, Cargo, Maven, .NET solutions and Go workspaces, with the dependencies their manifests declare.</p>
            <p><strong>One app:</strong> its modules and how they import each other, in TypeScript, JavaScript, Svelte, Vue, Python,
              Go, Java, Kotlin, Swift, Rust, Ruby, PHP, C# and more, plus the databases and outside APIs the code uses.</p>
            <p className="muted">Owners come from CODEOWNERS and recent changes from git. Tested on 20 public repositories of every
              shape: <code className="mono">sandbox/codebases.py</code>.</p>
          </div>
        </section>

        <section aria-label="What runs where" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="guide-h2">What runs where</h2>
          <div className="card" style={{ padding: '14px 18px' }}>
            <ul className="guide-steps" style={{ listStyle: 'none', paddingLeft: 0 }}>
              <li><ShieldCheck size={13} color="var(--accent)" style={{ verticalAlign: -2, marginRight: 8 }} />Pages load straight from their sites. DevBrowser has no servers of its own and collects no analytics.</li>
              <li><ShieldCheck size={13} color="var(--accent)" style={{ verticalAlign: -2, marginRight: 8 }} />SentinelGraph runs on this machine, on 127.0.0.1 only. DevBrowser starts it and stops it.</li>
              <li><ShieldCheck size={13} color="var(--accent)" style={{ verticalAlign: -2, marginRight: 8 }} />Captured traffic goes only to that SentinelGraph, with query strings removed.</li>
              <li><ShieldCheck size={13} color="var(--accent)" style={{ verticalAlign: -2, marginRight: 8 }} />The AI assistant runs locally with Ollama. The investigating agent proposes; you approve.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
};

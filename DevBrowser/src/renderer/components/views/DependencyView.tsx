import React, { useEffect, useMemo, useState } from 'react';
import { 
  Share2, 
  AlertTriangle, 
  Layers, 
  Server, 
  Database, 
  Globe, 
  Settings,
  Cloud,
  ExternalLink,
  Terminal,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Search,
  Filter,
  Activity,
  ShieldAlert
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';
import { layeredLayout } from '../../../shared/domain/sentinel';

interface VisualNodePosition {
  id: string;
  x: number;
  y: number;
  tier: 'client' | 'gateway' | 'service' | 'storage';
}

export const DependencyView: React.FC = () => {
  const graphNodes = useAppStore(s => s.graphNodes);
  const graphEdges = useAppStore(s => s.graphEdges);
  const selectedNodeId = useAppStore(s => s.selectedNodeId);
  const setSelectedNodeId = useAppStore(s => s.setSelectedNodeId);
  const blastRadius = useAppStore(s => s.blastRadius);
  const calculateBlastRadiusForNode = useAppStore(s => s.calculateBlastRadiusForNode);
  const tigerGraphStatus = useAppStore(s => s.tigerGraphStatus);
  const tigerGraphEndpoint = useAppStore(s => s.tigerGraphEndpoint);
  const tigerGraphName = useAppStore(s => s.tigerGraphName);
  const tigerGraphProviderType = useAppStore(s => s.tigerGraphProviderType);
  const tigerGraphMode = useAppStore(s => s.tigerGraphMode);
  const activeGraphTab = useAppStore(s => s.activeGraphTab);
  const setActiveGraphTab = useAppStore(s => s.setActiveGraphTab);
  const gsqlQuery = useAppStore(s => s.gsqlQuery);
  const setGsqlQuery = useAppStore(s => s.setGsqlQuery);
  const gsqlResult = useAppStore(s => s.gsqlResult as { ok: boolean; status: number; durationMs: number; data: unknown } | null);
  const isGsqlExecuting = useAppStore(s => s.isGsqlExecuting);
  const executeTigerGraphQuery = useAppStore(s => s.executeTigerGraphQuery);
  const setSetting = useAppStore(s => s.setSetting);
  const sentinelStatus = useAppStore(s => s.sentinelStatus);
  const sentinelUrl = useAppStore(s => s.sentinelUrl);
  const startSentinelInvestigation = useAppStore(s => s.startSentinelInvestigation);
  const refreshSentinelGraph = useAppStore(s => s.refreshSentinelGraph);
  const setActiveView = useAppStore(s => s.setActiveView);
  const createNewTab = useAppStore(s => s.createNewTab);

  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [queryMethod, setQueryMethod] = useState<'GET' | 'POST'>('GET');
  const [queryBodyText, setQueryBodyText] = useState<string>('{}');

  // Multi-tier coordinated layout coordinates for high aesthetic appeal (the offline sample graph)
  const sampleLayouts: Record<string, VisualNodePosition> = {
    'route:cart': { id: 'route:cart', x: 260, y: 70, tier: 'client' },
    'route:checkout-page': { id: 'route:checkout-page', x: 500, y: 70, tier: 'client' },
    'service:api-gw': { id: 'service:api-gw', x: 380, y: 190, tier: 'gateway' },
    'service:auth': { id: 'service:auth', x: 160, y: 190, tier: 'gateway' },
    'ep:checkout': { id: 'ep:checkout', x: 380, y: 310, tier: 'service' },
    'service:billing': { id: 'service:billing', x: 180, y: 440, tier: 'service' },
    'service:inventory': { id: 'service:inventory', x: 420, y: 440, tier: 'service' },
    'service:notifications': { id: 'service:notifications', x: 620, y: 440, tier: 'service' },
    'db:orders': { id: 'db:orders', x: 280, y: 570, tier: 'storage' },
    'db:redis-cache': { id: 'db:redis-cache', x: 500, y: 570, tier: 'storage' }
  };

  // Opening the view picks up what was browsed since the last load (captured traffic is sent first).
  useEffect(() => {
    void refreshSentinelGraph();
  }, [refreshSentinelGraph]);

  // The live SentinelGraph topology has any number of nodes: lay it out in dependency layers.
  const liveLayout = useMemo(() => layeredLayout(graphNodes, graphEdges), [graphNodes, graphEdges]);
  const isLive = sentinelStatus === 'connected';
  const nodeLayouts: Record<string, VisualNodePosition> = isLive ? liveLayout.positions : sampleLayouts;
  const canvasWidth = isLive ? liveLayout.width : 800;
  const canvasHeight = isLive ? liveLayout.height : 660;

  const selectedNode = graphNodes.find(n => n.id === selectedNodeId) || graphNodes[0];

  const filteredNodes = graphNodes.filter(n => {
    const matchesSearch = n.name.toLowerCase().includes(filterQuery.toLowerCase()) || n.id.toLowerCase().includes(filterQuery.toLowerCase());
    const layout = nodeLayouts[n.id];
    const matchesTier = selectedTier === 'all' || (layout && layout.tier === selectedTier);
    return matchesSearch && matchesTier;
  });

  const connectedEdges = graphEdges.filter(e => e.sourceId === selectedNode?.id || e.targetId === selectedNode?.id);

  // Check if a node is impacted in blast radius
  const isBlastAffected = (nodeId: string) => {
    return blastRadius?.affectedNodes.some(n => n.id === nodeId);
  };
  const isBlastRoot = (nodeId: string) => {
    return blastRadius?.rootNodeId === nodeId;
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'Database': return <Database size={15} color="var(--accent-purple)" />;
      case 'Service': return <Server size={15} color="var(--accent-indigo)" />;
      case 'FrontendRoute': return <Globe size={15} color="var(--accent-cyan)" />;
      default: return <Layers size={15} color="var(--accent-emerald)" />;
    }
  };

  const getNodeGlowColor = (nodeId: string, type: string) => {
    if (isBlastRoot(nodeId)) return '#f59e0b';
    if (isBlastAffected(nodeId)) return '#ef4444';
    if (selectedNodeId === nodeId) return '#06b6d4';
    switch (type) {
      case 'Database': return '#a855f7';
      case 'Service': return '#6366f1';
      case 'FrontendRoute': return '#06b6d4';
      default: return '#10b981';
    }
  };

  const handleOpenGraphStudioTab = () => {
    const targetUrl = tigerGraphEndpoint.includes('tgcloud.io')
      ? tigerGraphEndpoint
      : 'http://127.0.0.1:14240';
    createNewTab(targetUrl);
  };

  const handleExecuteConsoleQuery = () => {
    let parsedBody: unknown = undefined;
    if (queryMethod === 'POST') {
      try {
        parsedBody = JSON.parse(queryBodyText);
      } catch {
        // pass raw
      }
    }
    executeTigerGraphQuery(gsqlQuery, queryMethod, parsedBody);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Top Navigation & Provider Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Share2 size={18} color="var(--accent-cyan)" />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              API Dependency Graph
            </span>
          </div>

          {/* Provider Status Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Badge 
              label={
                sentinelStatus === 'connected' 
                  ? `SentinelGraph Live (${sentinelUrl})` 
                  : 'Sample Topology (Offline Demo)'
              } 
              variant={sentinelStatus === 'connected' ? 'success' : 'demo'} 
            />
          </div>
        </div>

        {/* View Tabs & Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            background: 'var(--bg-primary)',
            padding: '2px',
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)'
          }}>
            {[
              { id: 'topology', label: 'Visual Mesh', icon: <Layers size={13} /> },
              { id: 'graphstudio', label: 'TGCloud Studio', icon: <Cloud size={13} /> },
              { id: 'console', label: 'REST++ Console', icon: <Terminal size={13} /> }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveGraphTab(tab.id as never)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: activeGraphTab === tab.id ? 'var(--bg-active)' : 'transparent',
                  color: activeGraphTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              const question = selectedNode 
                ? `Service ${selectedNode.name} reported failure or abnormal latency. Investigate root cause, blast radius and remediate.`
                : 'Alerts are firing in the topology. Investigate root cause and propose remediation.';
              void startSentinelInvestigation(question);
            }}
            disabled={sentinelStatus !== 'connected'}
            title={sentinelStatus === 'connected' ? 'Launch SentinelGraph AI incident investigation on TigerGraph' : 'Connect SentinelGraph in Settings first'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: sentinelStatus === 'connected' ? 'rgba(239, 68, 68, 0.18)' : 'var(--bg-tertiary)',
              border: `1px solid ${sentinelStatus === 'connected' ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)'}`,
              color: sentinelStatus === 'connected' ? '#f87171' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 700,
              padding: '5px 12px',
              borderRadius: '5px',
              cursor: sentinelStatus === 'connected' ? 'pointer' : 'not-allowed'
            }}
          >
            <ShieldAlert size={12} />
            Investigate this failure
          </button>

          <button
            onClick={() => setActiveView('settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              padding: '5px 10px',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            <Settings size={12} />
            Configure SentinelGraph
          </button>
        </div>
      </div>

      {/* Main Tab View Rendering */}
      {activeGraphTab === 'topology' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Strict Mode Offline Hero State */}
          {tigerGraphMode === 'tigergraph-only' && tigerGraphStatus !== 'connected' ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
              textAlign: 'center',
              background: 'radial-gradient(circle at center, rgba(6, 182, 212, 0.05) 0%, transparent 70%)'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '2px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }} className="node-blast-affected">
                <Cloud size={36} color="#ef4444" />
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Strict TigerGraph Mode Active
              </h2>
              <p style={{ maxWidth: '520px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '20px' }}>
                Dev Browser is configured to render dependency topology <strong>exclusively through TigerGraph Cloud (TGCloud)</strong> or self-hosted REST++ endpoints. In-memory simulation fallback is currently suppressed.
              </p>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setActiveView('settings')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--accent-cyan)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Cloud size={14} />
                  Connect TigerGraph Cloud
                </button>

                <button
                  onClick={() => setSetting('tigerGraphMode', 'hybrid')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    borderRadius: '6px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <RotateCcw size={14} />
                  Enable In-Memory Simulation
                </button>
              </div>
            </div>
          ) : (
            /* Visual Interactive Canvas */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
              {/* Canvas Overlay Toolbar */}
              <div style={{
                position: 'absolute',
                top: '14px',
                left: '16px',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--glass-bg)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '4px 8px',
                boxShadow: 'var(--shadow-md)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '8px', borderRight: '1px solid var(--border-subtle)' }}>
                  <Search size={13} color="var(--text-muted)" />
                  <input
                    type="text"
                    value={filterQuery}
                    onChange={e => setFilterQuery(e.target.value)}
                    placeholder="Filter nodes..."
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      width: '110px',
                      outline: 'none'
                    }}
                  />
                </div>

                {/* Tier Filter Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Filter size={12} color="var(--text-muted)" />
                  {['all', 'client', 'gateway', 'service', 'storage'].map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTier(t)}
                      style={{
                        background: selectedTier === t ? 'var(--accent-cyan)' : 'transparent',
                        color: selectedTier === t ? '#000' : 'var(--text-muted)',
                        border: 'none',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        cursor: 'pointer'
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Zoom Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '8px', borderLeft: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={() => setZoomLevel(prev => Math.max(0.6, prev - 0.1))}
                    title="Zoom Out"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={() => setZoomLevel(prev => Math.min(1.4, prev + 0.1))}
                    title="Zoom In"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    onClick={() => setZoomLevel(1)}
                    title="Reset Canvas"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>

              {/* Dynamic SVG Topology Canvas */}
              <div 
                className="graph-grid-bg"
                style={{
                  flex: 1,
                  overflow: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                  userSelect: 'none'
                }}
              >
                <div style={{
                  position: 'relative',
                  width: `${canvasWidth}px`,
                  height: `${canvasHeight}px`,
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease'
                }}>
                  {/* SVG Connection Lines & Animated Flow Packets */}
                  <svg
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 1
                    }}
                  >
                    {graphEdges.map((edge, idx) => {
                      const src = nodeLayouts[edge.sourceId];
                      const dst = nodeLayouts[edge.targetId];
                      if (!src || !dst) return null;

                      const isEdgeSelected = selectedNodeId === edge.sourceId || selectedNodeId === edge.targetId;
                      const isEdgeHovered = hoveredNodeId === edge.sourceId || hoveredNodeId === edge.targetId;
                      const isAffected = isBlastAffected(edge.sourceId) && isBlastAffected(edge.targetId);

                      // Calculate smooth cubic Bezier curve
                      const midY = (src.y + dst.y) / 2;
                      const pathD = `M ${src.x + 80} ${src.y + 40} C ${src.x + 80} ${midY}, ${dst.x + 80} ${midY}, ${dst.x + 80} ${dst.y}`;

                      return (
                        <g key={idx}>
                          {/* Base Connection Stroke */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke={isAffected ? '#ef4444' : (isEdgeSelected || isEdgeHovered) ? '#06b6d4' : 'rgba(255, 255, 255, 0.15)'}
                            strokeWidth={isEdgeSelected || isEdgeHovered || isAffected ? 2.5 : 1.5}
                            strokeOpacity={isEdgeSelected || isEdgeHovered || isAffected ? 1 : 0.4}
                          />

                          {/* Animated Particle Packet Flow */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke={isAffected ? '#ef4444' : (isEdgeSelected || isEdgeHovered) ? '#38bdf8' : '#6366f1'}
                            strokeWidth={isEdgeSelected || isEdgeHovered || isAffected ? 3 : 2}
                            strokeDasharray="4, 12"
                            className="graph-edge-flow"
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Render Visual Node Cards */}
                  {filteredNodes.map(node => {
                    const pos = nodeLayouts[node.id] || { id: node.id, x: 380, y: 300, tier: 'service' };
                    const isSelected = selectedNodeId === node.id;
                    const glowColor = getNodeGlowColor(node.id, node.type);
                    const affected = isBlastAffected(node.id);
                    const isRoot = isBlastRoot(node.id);

                    return (
                      <div
                        key={node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        className={`transition-smooth ${isRoot ? 'node-blast-root' : affected ? 'node-blast-affected' : ''}`}
                        style={{
                          position: 'absolute',
                          left: `${pos.x}px`,
                          top: `${pos.y}px`,
                          width: '160px',
                          zIndex: isSelected ? 5 : 2,
                          background: isSelected ? 'var(--bg-active)' : 'var(--bg-surface)',
                          border: `2px solid ${glowColor}`,
                          borderRadius: '10px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          boxShadow: isSelected 
                            ? `0 0 16px ${glowColor}66, var(--shadow-lg)` 
                            : 'var(--shadow-md)',
                          backdropFilter: 'blur(4px)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {getNodeIcon(node.type)}
                            <span style={{ fontSize: '10px', fontWeight: 700, color: glowColor, textTransform: 'uppercase' }}>
                              {node.type.replace('FrontendRoute', 'Route')}
                            </span>
                          </div>

                          <span style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: affected ? '#ef4444' : '#10b981',
                            boxShadow: `0 0 6px ${affected ? '#ef4444' : '#10b981'}`
                          }} />
                        </div>

                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {node.name}
                        </div>

                        {/* Node Metrics Badge */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
                          <span>{pos.tier.toUpperCase()}</span>
                          <span style={{ color: affected ? '#f87171' : 'var(--accent-emerald)', fontWeight: 600 }}>
                            {affected ? 'CASCADE FAIL' : '● 99.9%'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Right Node Inspector & Blast Radius Simulation Panel */}
          <div style={{
            width: '320px',
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px',
            gap: '16px',
            flexShrink: 0,
            overflowY: 'auto'
          }}>
            {selectedNode && (
              <>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    {getNodeIcon(selectedNode.type)}
                    <Badge label={selectedNode.type} variant="primary" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {selectedNode.name}
                  </h3>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    ID: {selectedNode.id}
                  </div>
                </div>

                {/* Connected Dependencies */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    CONNECTED MESH DEPENDENCIES ({connectedEdges.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {connectedEdges.map((e, idx) => (
                      <div key={idx} style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        padding: '6px 8px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>
                          <span style={{ color: 'var(--accent-cyan)' }}>{e.type}</span> {e.sourceId === selectedNode.id ? `→ ${e.targetId}` : `← ${e.sourceId}`}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--accent-emerald)' }}>
                          38ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blast Radius Action Box */}
                <div style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={15} color="#f59e0b" />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Cascade Blast Radius Simulator
                    </span>
                  </div>

                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Simulate service degradation on <strong>{selectedNode.name}</strong> to measure ripple failure risk across the TigerGraph dependency topology.
                  </p>

                  <button
                    onClick={() => calculateBlastRadiusForNode(selectedNode.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      background: 'var(--accent-amber)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                    className="transition-smooth hover:opacity-90"
                  >
                    <Activity size={13} />
                    Run Blast Radius Analysis
                  </button>

                  {blastRadius && (
                    <div style={{
                      marginTop: '6px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      padding: '10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      <div style={{ color: '#f87171', fontWeight: 700, fontSize: '12px', marginBottom: '4px' }}>
                        Impact Severity: {Math.round(blastRadius.impactScore * 100)}%
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Affected Downstream Services: {blastRadius.affectedNodes.length}
                      </div>
                      <div style={{ color: 'var(--text-muted)', marginTop: '4px', fontSize: '10px' }}>
                        Root Cause: {blastRadius.rootNodeId}
                      </div>
                    </div>
                  )}
                </div>

                {/* TigerGraph Cloud Direct Action */}
                <div style={{
                  marginTop: 'auto',
                  padding: '12px',
                  background: 'var(--bg-surface)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
                    CLOUD REPOSITORY
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    Instance: <code>{new URL(tigerGraphEndpoint.startsWith('http') ? tigerGraphEndpoint : `https://${tigerGraphEndpoint}`).hostname}</code>
                  </div>
                  <button
                    onClick={handleOpenGraphStudioTab}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--accent-cyan)',
                      padding: '5px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <ExternalLink size={12} />
                    Explore in GraphStudio
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: TigerGraph Cloud GraphStudio Portal */}
      {activeGraphTab === 'graphstudio' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', overflowY: 'auto' }}>
          <div style={{ maxWidth: '820px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '12px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '8px',
                  background: 'rgba(6, 182, 212, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Cloud size={24} color="var(--accent-cyan)" />
                </div>

                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    TigerGraph Cloud GraphStudio Portal
                  </h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Official visual exploration, GSQL query editor, and interactive graph analytics.
                  </p>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                background: 'var(--bg-primary)',
                padding: '16px',
                borderRadius: '8px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)'
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>ENDPOINT: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{tigerGraphEndpoint}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>ACTIVE GRAPH: </span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{tigerGraphName}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>PROVIDER: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{tigerGraphProviderType.toUpperCase()}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>STATUS: </span>
                  <span style={{ color: tigerGraphStatus === 'connected' ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                    {tigerGraphStatus.toUpperCase()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleOpenGraphStudioTab}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--accent-cyan)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <ExternalLink size={14} />
                  Launch GraphStudio in Tab
                </button>

                <a
                  href={tigerGraphEndpoint.includes('tgcloud.io') ? tigerGraphEndpoint : 'http://127.0.0.1:14240'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-secondary)',
                    borderRadius: '6px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none'
                  }}
                >
                  Open in Default Browser
                </a>
              </div>
            </div>

            {/* Feature Highlights */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '4px' }}>
                  3D Visual Exploration
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Inspect vertices, edges, paths, and graph clusters interactively inside TigerGraph's hardware-accelerated canvas.
                </p>
              </div>

              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-indigo)', marginBottom: '4px' }}>
                  GSQL Query Editor
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Write, install, and execute high-performance GSQL graph algorithms such as PageRank, Betweenness, and Blast Radius.
                </p>
              </div>

              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: '4px' }}>
                  Zero License Overhead
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  TigerGraph Cloud automates cluster management and license provisioning without consuming your M4 Mac's memory.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Live REST++ / GSQL Query Console */}
      {activeGraphTab === 'console' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', gap: '16px', overflow: 'hidden' }}>
          {/* Query Bar */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={16} color="var(--accent-cyan)" />
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  TigerGraph REST++ Query Executor
                </span>
              </div>

              {/* Preset Selector */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { label: 'List Services', path: `/restpp/graph/${tigerGraphName}/vertices/Service`, method: 'GET' as const },
                  { label: 'List Endpoints', path: `/restpp/graph/${tigerGraphName}/vertices/Endpoint`, method: 'GET' as const },
                  { label: 'Fetch Schema', path: `/restpp/graph/${tigerGraphName}/schema`, method: 'GET' as const }
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setGsqlQuery(preset.path);
                      setQueryMethod(preset.method);
                    }}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={queryMethod}
                onChange={e => setQueryMethod(e.target.value as 'GET' | 'POST')}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  color: queryMethod === 'POST' ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                  fontWeight: 700,
                  fontSize: '12px',
                  padding: '6px 12px'
                }}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>

              <input
                type="text"
                value={gsqlQuery}
                onChange={e => setGsqlQuery(e.target.value)}
                placeholder="/restpp/graph/{graph_name}/vertices/{vertex_type}"
                style={{
                  flex: 1,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px'
                }}
              />

              <button
                onClick={handleExecuteConsoleQuery}
                disabled={isGsqlExecuting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--accent-cyan)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 18px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isGsqlExecuting ? 'wait' : 'pointer'
                }}
              >
                <Play size={13} />
                {isGsqlExecuting ? 'Executing...' : 'Run Query'}
              </button>
            </div>

            {queryMethod === 'POST' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  POST JSON Payload
                </label>
                <textarea
                  value={queryBodyText}
                  onChange={e => setQueryBodyText(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '6px',
                    padding: '8px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    resize: 'none'
                  }}
                />
              </div>
            )}
          </div>

          {/* Response Payload Viewer */}
          <div style={{
            flex: 1,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              background: 'var(--bg-tertiary)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>PAYLOAD RESPONSE</span>
              {gsqlResult && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Badge 
                    label={gsqlResult.ok ? `HTTP ${gsqlResult.status} OK` : `HTTP ${gsqlResult.status || 'ERR'}`} 
                    variant={gsqlResult.ok ? 'success' : 'danger'} 
                  />
                  <span style={{ color: 'var(--text-muted)' }}>
                    {gsqlResult.durationMs}ms
                  </span>
                </div>
              )}
            </div>

            <pre style={{
              flex: 1,
              padding: '16px',
              margin: 0,
              overflow: 'auto',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
              background: 'var(--bg-primary)'
            }}>
              {gsqlResult ? JSON.stringify(gsqlResult.data, null, 2) : '// Execute a REST++ query to view graph JSON payload'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
export default DependencyView;

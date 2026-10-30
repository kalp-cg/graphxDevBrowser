import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Loader2, 
  Copy, 
  Check, 
  ShieldCheck, 
  RotateCw 
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../common/Badge';

export const AIAssistantView: React.FC = () => {
  const aiMessages = useAppStore(s => s.aiMessages);
  const isAiGenerating = useAppStore(s => s.isAiGenerating);
  const ollamaStatus = useAppStore(s => s.ollamaStatus);
  const sendAiPrompt = useAppStore(s => s.sendAiPrompt);
  const checkOllama = useAppStore(s => s.checkOllama);
  const addToast = useAppStore(s => s.addToast);

  const [inputPrompt, setInputPrompt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim() || isAiGenerating) return;
    const prompt = inputPrompt;
    setInputPrompt('');
    await sendAiPrompt(prompt);
  };

  const handleCopyDiff = (diff: string, id: string) => {
    navigator.clipboard.writeText(diff);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
    addToast({ type: 'info', title: 'Code Diff Copied to Clipboard' });
  };

  const quickPrompts = [
    'Diagnose active console errors and network failures on current page',
    'Generate Playwright end-to-end regression test for /cart checkout',
    'Provide unified git diff to patch missing Content-Security-Policy header'
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* Top AI Status Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={16} color="var(--accent-emerald)" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Local AI Developer Assistant
          </span>
          <Badge
            label={ollamaStatus.ok ? `Ollama: ${ollamaStatus.model}` : 'Ollama: Offline'}
            variant={ollamaStatus.ok ? 'success' : 'danger'}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <ShieldCheck size={12} color="var(--accent-emerald)" />
            <span>100% On-Device (Apple Silicon M4) · Zero Cloud Leakage</span>
          </div>

          <button
            onClick={checkOllama}
            title="Refresh Ollama Connection Status"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {aiMessages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}>
              {msg.sender === 'user' ? (
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>You (Developer)</span>
              ) : (
                <span style={{ fontWeight: 600, color: 'var(--accent-emerald)' }}>Local AI ({ollamaStatus.model})</span>
              )}
              <span>· {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div style={{
              background: msg.sender === 'user' ? 'var(--accent-indigo)' : 'var(--bg-secondary)',
              color: msg.sender === 'user' ? 'white' : 'var(--text-primary)',
              border: msg.sender === 'user' ? 'none' : '1px solid var(--border-medium)',
              borderRadius: msg.sender === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              padding: '12px 16px',
              fontSize: '13px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap'
            }}>
              {msg.text}

              {msg.diff && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px 6px 0 0',
                    border: '1px solid var(--border-subtle)',
                    borderBottom: 'none'
                  }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      UNIFIED CODE DIFF (GIT PATCH)
                    </span>

                    <button
                      onClick={() => handleCopyDiff(msg.diff!, msg.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      {copiedId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                      {copiedId === msg.id ? 'Copied' : 'Copy Patch'}
                    </button>
                  </div>

                  <pre style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '0 0 6px 6px',
                    padding: '10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--accent-emerald)',
                    overflowX: 'auto',
                    margin: 0
                  }}>
                    {msg.diff}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ))}

        {isAiGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
            <Loader2 size={14} className="animate-spin" color="var(--accent)" />
            <span>Local model reasoning over local unified memory...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Chips */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '6px 16px',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-subtle)',
        overflowX: 'auto'
      }}>
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => sendAiPrompt(qp)}
            disabled={isAiGenerating}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '999px',
              padding: '4px 10px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
            className="transition-smooth"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Input Form Bar */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 16px',
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)'
        }}
      >
        <input
          type="text"
          value={inputPrompt}
          onChange={e => setInputPrompt(e.target.value)}
          placeholder="Ask local AI to debug code, explain console errors, or generate tests..."
          style={{
            flex: 1,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            outline: 'none'
          }}
        />

        <button
          type="submit"
          disabled={!inputPrompt.trim() || isAiGenerating}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--accent-emerald)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: !inputPrompt.trim() || isAiGenerating ? 'default' : 'pointer',
            opacity: !inputPrompt.trim() || isAiGenerating ? 0.6 : 1
          }}
          className="transition-smooth hover:opacity-90"
        >
          <Send size={14} />
          Send
        </button>
      </form>
    </div>
  );
};

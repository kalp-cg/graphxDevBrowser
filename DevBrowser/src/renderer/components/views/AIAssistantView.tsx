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
    'Explain the errors on this page',
    'Why did the last request fail?',
    'Write an end-to-end test for this page',
    'How do I fix the security findings here?'
  ];
  const offline = !ollamaStatus.ok && ollamaStatus.model !== 'checking...';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className={`status-dot ${ollamaStatus.ok ? 'ok' : offline ? 'danger' : 'warn'}`} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {ollamaStatus.ok ? `Running ${ollamaStatus.model}` : offline ? 'Not running' : 'Checking…'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          <ShieldCheck size={12} color="var(--accent)" /> On this machine: nothing you ask leaves it
        </span>
        <button className="icon-btn" onClick={checkOllama} title="Check again" aria-label="Check the local model again"><RotateCw size={13} /></button>
      </div>

      {/* Messages Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {aiMessages.length === 0 && (offline ? (
          <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={16} color="var(--accent)" /><strong style={{ fontSize: 14 }}>The assistant runs on your machine</strong></div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              It uses Ollama, so the code, pages and requests you ask about never leave this computer. Ollama is not running right now. To turn it on:
            </p>
            <ol style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)', paddingLeft: 20 }}>
              <li>Install Ollama from ollama.com</li>
              <li>In a terminal: <code className="mono">ollama pull {ollamaStatus.model && ollamaStatus.model !== 'none' ? ollamaStatus.model : 'qwen2.5-coder:7b'}</code></li>
              <li>Then <code className="mono">ollama serve</code>, and press Check again</li>
            </ol>
            <div><button className="btn primary" onClick={checkOllama}><RotateCw size={13} /> Check again</button></div>
          </div>
        ) : (
          <div className="card" style={{ padding: '16px 18px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Ask about the page you are on: its console errors, a request that failed, its security findings, or a test for it.
            The assistant sees what DevBrowser captured for this tab.
          </div>
        ))}
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
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>You</span>
              ) : (
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Assistant</span>
              )}
              <span>· {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div style={{
              background: msg.sender === 'user' ? 'var(--accent-soft)' : 'var(--bg-secondary)',
              color: 'var(--text-primary)',
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
            <span>Thinking…</span>
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
          placeholder="Ask local AI about this page: errors, failed requests, tests…"
          style={{
            flex: 1,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '10px',
            padding: '9px 12px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            outline: 'none'
          }}
        />

        <button
          type="submit"
          disabled={!inputPrompt.trim() || isAiGenerating}
          className="btn primary" style={{ height: 34 }}
        >
          <Send size={14} />
          Send
        </button>
      </form>
    </div>
  );
};

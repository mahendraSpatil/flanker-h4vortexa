// Owner: Neel | ElevenLabs Conversational AI — voice + text hybrid chatbot widget
import { useState, useCallback, useRef, useEffect, Component } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

const AGENT_ID = 'agent_5801m4ne6va6fqktrd7233c1yd4d';

/* ── Icons ─────────────────────────────────────────────────────────── */
const MicIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
  </svg>
);

/* ── Error Boundary ─────────────────────────────────────────────────── */
class ChatbotErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

/* ─────────────────────────────────────────────────────────────────────
   Inner widget — must live inside ConversationProvider
────────────────────────────────────────────────────────────────────── */
function ChatbotInner() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('text'); // 'text' | 'voice'
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Hi! I'm the ProofChain assistant. Ask me about verification results, how to upload documents, or what any error code means." }
  ]);
  const [inputText, setInputText] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const conversation = useConversation({
    onConnect: () => setIsConnecting(false),
    onDisconnect: () => { setIsConnecting(false); },
    onMessage: ({ message, source }) => {
      // Capture agent messages into the chat log
      if (source === 'ai' && message) {
        setMessages(prev => [...prev, { role: 'assistant', text: message }]);
      } else if (source === 'user' && message) {
        setMessages(prev => [...prev, { role: 'user', text: message }]);
      }
    },
    onError: (err) => { console.error('ElevenLabs error:', err); setIsConnecting(false); },
  });

  const isVoiceActive = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opening in text mode
  useEffect(() => {
    if (isOpen && mode === 'text') {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen, mode]);

  /* ── Voice handlers ─────────────────────────────────────────────── */
  const startVoice = useCallback(async () => {
    setIsConnecting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({ agentId: AGENT_ID });
    } catch (err) {
      console.error('Could not start voice session:', err);
      setIsConnecting(false);
    }
  }, [conversation]);

  const stopVoice = useCallback(async () => {
    if (conversation.status === 'connected') {
      await conversation.endSession();
    }
  }, [conversation]);

  /* ── Text handlers ──────────────────────────────────────────────── */
  const sendText = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSendingText) return;

    setMessages(prev => [...prev, { role: 'user', text }]);
    setInputText('');
    setIsSendingText(true);

    try {
      if (conversation.status !== 'connected') {
        // Start a text session first
        await conversation.startSession({ agentId: AGENT_ID });
      }
      await conversation.sendUserMessage(text);
    } catch (err) {
      console.error('sendUserMessage error:', err);
      setMessages(prev => [...prev, { role: 'assistant', text: '⚠️ Sorry, I could not send that. Please try again.' }]);
    } finally {
      setIsSendingText(false);
    }
  }, [inputText, isSendingText, conversation]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

  /* ── Open / close ───────────────────────────────────────────────── */
  const handleOpen = () => setIsOpen(true);
  const handleClose = async () => {
    setIsOpen(false);
    if (isVoiceActive) await stopVoice();
  };
  const handleToggle = () => { if (isOpen) handleClose(); else handleOpen(); };

  /* ── Suggested prompts ──────────────────────────────────────────── */
  const SUGGESTED = [
    'What does ROOT_MISMATCH mean?',
    'How do I verify a document?',
    'What is DOCUMENT_MODIFIED?',
  ];

  const handleSuggestion = (text) => {
    setInputText(text);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  /* ────────────────────────────────────────────────────────────────── */
  const S = {
    panel: {
      position: 'fixed', bottom: '90px', right: '24px', width: '340px', zIndex: 9998,
      borderRadius: '16px',
      background: 'linear-gradient(160deg,#0f172a 0%,#1a2236 100%)',
      border: '1px solid rgba(99,102,241,.3)',
      boxShadow: '0 28px 72px rgba(0,0,0,.55),0 0 0 1px rgba(99,102,241,.08)',
      display: 'flex', flexDirection: 'column',
      maxHeight: '520px', overflow: 'hidden', fontFamily: 'inherit',
    },
    header: {
      padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid rgba(99,102,241,.2)', background: 'rgba(99,102,241,.07)',
      flexShrink: 0,
    },
    msgArea: {
      flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex',
      flexDirection: 'column', gap: '10px',
    },
    msgBubbleUser: {
      alignSelf: 'flex-end', maxWidth: '82%',
      background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
      color: 'white', borderRadius: '14px 14px 4px 14px',
      padding: '9px 13px', fontSize: '13px', lineHeight: 1.45, wordBreak: 'break-word',
    },
    msgBubbleBot: {
      alignSelf: 'flex-start', maxWidth: '88%',
      background: 'rgba(255,255,255,.07)',
      color: 'rgba(226,232,240,1)', borderRadius: '4px 14px 14px 14px',
      padding: '9px 13px', fontSize: '13px', lineHeight: 1.5, wordBreak: 'break-word',
      border: '1px solid rgba(99,102,241,.15)',
    },
  };

  return (
    <>
      {/* ── Floating panel ────────────────────────────── */}
      {isOpen && (
        <div style={S.panel}>

          {/* Header */}
          <div style={S.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '8px',
                background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0,
              }}>
                <SparkleIcon />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '13px', lineHeight: 1.2 }}>ProofChain Assistant</div>
                <div style={{ color: 'rgba(148,163,184,1)', fontSize: '10px', marginTop: '1px' }}>Powered by ElevenLabs AI</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Mode toggle */}
              <div style={{
                display: 'flex', background: 'rgba(255,255,255,.07)',
                borderRadius: '8px', padding: '2px', border: '1px solid rgba(99,102,241,.2)',
              }}>
                {['text', 'voice'].map((m) => (
                  <button key={m} onClick={() => { setMode(m); if (m === 'voice' && !isVoiceActive) startVoice(); if (m === 'text' && isVoiceActive) stopVoice(); }}
                    style={{
                      padding: '3px 9px', borderRadius: '6px', border: 'none',
                      fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      background: mode === m ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                      color: mode === m ? 'white' : 'rgba(148,163,184,1)',
                      transition: 'all .2s',
                    }}>
                    {m === 'text' ? '💬' : '🎙️'} {m}
                  </button>
                ))}
              </div>
              <button onClick={handleClose} aria-label="Close" style={{
                background: 'rgba(255,255,255,.07)', border: 'none', borderRadius: '7px',
                color: 'rgba(148,163,184,1)', cursor: 'pointer', padding: '5px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* ── TEXT MODE ─────────────────────────────────── */}
          {mode === 'text' && (
            <>
              {/* Message area */}
              <div style={S.msgArea}>
                {messages.map((msg, i) => (
                  <div key={i} style={msg.role === 'user' ? S.msgBubbleUser : S.msgBubbleBot}>
                    {msg.text}
                  </div>
                ))}

                {/* Suggested prompts (only before user sends first message) */}
                {messages.length === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
                    <div style={{ color: 'rgba(100,116,139,1)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em' }}>
                      Try asking
                    </div>
                    {SUGGESTED.map((p) => (
                      <div key={p} onClick={() => handleSuggestion(p)} style={{
                        background: 'rgba(255,255,255,.04)', border: '1px solid rgba(99,102,241,.18)',
                        borderRadius: '8px', padding: '7px 11px', color: 'rgba(148,163,184,1)',
                        fontSize: '12px', cursor: 'pointer', transition: 'all .15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.15)'; e.currentTarget.style.color = 'white'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'rgba(148,163,184,1)'; }}
                      >
                        "{p}"
                      </div>
                    ))}
                  </div>
                )}

                {isSendingText && (
                  <div style={{ ...S.msgBubbleBot, fontStyle: 'italic', color: 'rgba(148,163,184,.7)' }}>
                    Thinking…
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div style={{
                padding: '10px 12px', borderTop: '1px solid rgba(99,102,241,.18)', flexShrink: 0,
                display: 'flex', gap: '7px', alignItems: 'flex-end',
              }}>
                <textarea ref={inputRef} value={inputText} onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown} placeholder="Ask anything about ProofChain…" rows={1}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(99,102,241,.25)',
                    borderRadius: '10px', padding: '9px 12px', color: 'white', fontSize: '13px',
                    resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4,
                    maxHeight: '90px', overflowY: 'auto',
                  }} />
                <button onClick={sendText} disabled={!inputText.trim() || isSendingText}
                  style={{
                    width: '36px', height: '36px', borderRadius: '10px', border: 'none', flexShrink: 0,
                    background: inputText.trim() && !isSendingText ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,.06)',
                    color: inputText.trim() && !isSendingText ? 'white' : 'rgba(100,116,139,1)',
                    cursor: inputText.trim() && !isSendingText ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .2s',
                  }}>
                  <SendIcon />
                </button>
              </div>
            </>
          )}

          {/* ── VOICE MODE ────────────────────────────────── */}
          {mode === 'voice' && (
            <div style={{ padding: '24px 18px', textAlign: 'center' }}>
              {/* Orb */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <div onClick={isVoiceActive ? stopVoice : startVoice} style={{
                  width: '92px', height: '92px', borderRadius: '50%', cursor: 'pointer',
                  background: isVoiceActive ? 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a78bfa 100%)' : 'rgba(30,41,59,1)',
                  border: isVoiceActive ? '3px solid rgba(139,92,246,.6)' : '3px solid rgba(99,102,241,.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isVoiceActive ? 'white' : 'rgba(99,102,241,.8)',
                  boxShadow: isVoiceActive ? '0 0 32px rgba(99,102,241,.5)' : '0 4px 20px rgba(0,0,0,.3)',
                  transition: 'all .4s ease',
                  animation: isSpeaking ? 'pc-pulse .8s ease-in-out infinite alternate'
                    : isVoiceActive ? 'pc-glow 2s ease-in-out infinite alternate' : 'none',
                }}>
                  <MicIcon size={26} />
                </div>
              </div>

              <div style={{
                color: isConnecting ? 'rgba(251,191,36,1)'
                  : isVoiceActive ? (isSpeaking ? 'rgba(167,139,250,1)' : 'rgba(52,211,153,1)')
                    : 'rgba(148,163,184,1)',
                fontWeight: 600, fontSize: '13px', marginBottom: '5px',
              }}>
                {isConnecting ? 'Connecting…'
                  : isVoiceActive ? (isSpeaking ? '🔊 Speaking…' : '🎙️ Listening — speak now')
                    : 'Tap to start speaking'}
              </div>
              <div style={{ color: 'rgba(100,116,139,1)', fontSize: '11px', lineHeight: 1.5, marginBottom: '18px' }}>
                The assistant will hear and respond with voice.
              </div>

              <button onClick={isVoiceActive ? stopVoice : startVoice} disabled={isConnecting} style={{
                width: '100%', padding: '10px 14px', borderRadius: '10px', border: 'none',
                background: isVoiceActive ? 'rgba(239,68,68,.15)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: isVoiceActive ? 'rgba(252,165,165,1)' : 'white',
                fontWeight: 600, fontSize: '13px',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                opacity: isConnecting ? .6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
              }}>
                {isConnecting ? 'Connecting…' : isVoiceActive ? '⏹ End Call' : '🎙️ Start Voice Chat'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── FAB ──────────────────────────────────────────── */}
      <button id="chatbot-toggle" onClick={handleToggle} aria-label="Toggle ProofChain assistant"
        title="ProofChain AI Assistant"
        style={{
          position: 'fixed', bottom: '24px', right: '24px',
          width: '56px', height: '56px', borderRadius: '50%', border: 'none',
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          cursor: 'pointer', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isVoiceActive
            ? '0 0 0 3px rgba(99,102,241,.4),0 8px 24px rgba(99,102,241,.5)'
            : '0 4px 20px rgba(99,102,241,.4)',
          zIndex: 9999, transition: 'transform .2s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {isOpen ? <CloseIcon /> : <SparkleIcon />}
        {isVoiceActive && (
          <span style={{
            position: 'absolute', top: '3px', right: '3px',
            width: '11px', height: '11px', background: '#10b981',
            borderRadius: '50%', border: '2px solid white',
            animation: 'pc-pulse 1s ease-in-out infinite alternate',
          }} />
        )}
      </button>

      <style>{`
        @keyframes pc-pulse { from{transform:scale(1);} to{transform:scale(1.07);} }
        @keyframes pc-glow  { from{box-shadow:0 0 24px rgba(99,102,241,.4);} to{box-shadow:0 0 44px rgba(99,102,241,.75);} }
      `}</style>
    </>
  );
}

/* ── Public export ──────────────────────────────────────────────────── */
export default function ChatbotWidget() {
  return (
    <ChatbotErrorBoundary>
      <ConversationProvider>
        <ChatbotInner />
      </ConversationProvider>
    </ChatbotErrorBoundary>
  );
}

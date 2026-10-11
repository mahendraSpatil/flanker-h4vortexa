// Owner: Neel | ElevenLabs Conversational AI floating chatbot widget
import { useState, useCallback, Component } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

const AGENT_ID = 'agent_5801m4ne6va6fqktrd7233c1yd4d';

/* ── Icons ─────────────────────────────────────────────────────────── */
const MicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
  </svg>
);

/* ── Error Boundary ─────────────────────────────────────────────────── */
class ChatbotErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null; // silently hide on error; don't crash the app
    return this.props.children;
  }
}

/* ── Inner widget — must live inside ConversationProvider ───────────── */
function ChatbotInner() {
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const conversation = useConversation({
    onConnect: () => setIsConnecting(false),
    onDisconnect: () => setIsConnecting(false),
    onError: (err) => {
      console.error('ElevenLabs error:', err);
      setIsConnecting(false);
    },
  });

  const isActive = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;

  const handleOpen = useCallback(async () => {
    setIsOpen(true);
    if (conversation.status !== 'connected') {
      setIsConnecting(true);
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        await conversation.startSession({ agentId: AGENT_ID });
      } catch (err) {
        console.error('Could not start session:', err);
        setIsConnecting(false);
      }
    }
  }, [conversation]);

  const handleClose = useCallback(async () => {
    setIsOpen(false);
    if (conversation.status === 'connected') {
      await conversation.endSession();
    }
  }, [conversation]);

  const handleToggle = useCallback(() => {
    if (isOpen) handleClose();
    else handleOpen();
  }, [isOpen, handleOpen, handleClose]);

  const SUGGESTED = [
    'What does ROOT_MISMATCH mean?',
    'How do I verify a document?',
    'Why is my document DOCUMENT_MODIFIED?',
  ];

  return (
    <>
      {/* ── Floating panel ──────────────────────────────────────────── */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '96px', right: '24px', width: '316px', zIndex: 9998,
          borderRadius: '16px',
          background: 'linear-gradient(145deg,#0f172a 0%,#1e293b 100%)',
          border: '1px solid rgba(99,102,241,.35)',
          boxShadow: '0 24px 64px rgba(0,0,0,.5),0 0 0 1px rgba(99,102,241,.1)',
          overflow: 'hidden', fontFamily: 'inherit',
        }}>

          {/* Header */}
          <div style={{
            padding: '13px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid rgba(99,102,241,.2)', background: 'rgba(99,102,241,.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px',
                background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', flexShrink: 0,
              }}>
                <SparkleIcon />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '14px', lineHeight: 1.2 }}>
                  ProofChain Assistant
                </div>
                <div style={{ color: 'rgba(148,163,184,1)', fontSize: '11px', marginTop: '1px' }}>
                  Powered by ElevenLabs AI
                </div>
              </div>
            </div>
            <button onClick={handleClose} aria-label="Close" style={{
              background: 'rgba(255,255,255,.07)', border: 'none', borderRadius: '8px',
              color: 'rgba(148,163,184,1)', cursor: 'pointer', padding: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CloseIcon />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 18px', textAlign: 'center' }}>
            {/* Orb */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
              <div onClick={handleToggle} style={{
                width: '96px', height: '96px', borderRadius: '50%', cursor: 'pointer',
                background: isActive
                  ? 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a78bfa 100%)'
                  : 'rgba(30,41,59,1)',
                border: isActive ? '3px solid rgba(139,92,246,.6)' : '3px solid rgba(99,102,241,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isActive ? 'white' : 'rgba(99,102,241,.8)',
                boxShadow: isActive ? '0 0 32px rgba(99,102,241,.5)' : '0 4px 20px rgba(0,0,0,.3)',
                transition: 'all .4s ease',
                animation: isSpeaking ? 'pc-pulse .8s ease-in-out infinite alternate'
                  : isActive ? 'pc-glow 2s ease-in-out infinite alternate' : 'none',
              }}>
                <MicIcon />
              </div>
            </div>

            {/* Status */}
            <div style={{
              color: isConnecting ? 'rgba(251,191,36,1)'
                : isActive ? (isSpeaking ? 'rgba(167,139,250,1)' : 'rgba(52,211,153,1)')
                  : 'rgba(148,163,184,1)',
              fontWeight: 600, fontSize: '13px', marginBottom: '5px', transition: 'color .3s',
            }}>
              {isConnecting ? 'Connecting…'
                : isActive ? (isSpeaking ? '🔊 Speaking…' : '🎙️ Listening — speak now')
                  : 'Tap the mic to start'}
            </div>
            <div style={{ color: 'rgba(100,116,139,1)', fontSize: '11px', lineHeight: 1.5 }}>
              {isActive ? 'Ask about verification results, errors, or how to register a document.'
                : 'Voice-powered AI assistant. Ask anything about ProofChain.'}
            </div>

            {/* Button */}
            <button onClick={handleToggle} disabled={isConnecting} style={{
              marginTop: '18px', width: '100%', padding: '10px 14px', borderRadius: '10px',
              border: 'none',
              background: isActive ? 'rgba(239,68,68,.15)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              color: isActive ? 'rgba(252,165,165,1)' : 'white',
              fontWeight: 600, fontSize: '13px', cursor: isConnecting ? 'not-allowed' : 'pointer',
              opacity: isConnecting ? .6 : 1, transition: 'all .2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            }}>
              {isConnecting ? 'Connecting…' : isActive ? '⏹ End Conversation' : '🎙️ Start Voice Chat'}
            </button>
          </div>

          {/* Suggested prompts */}
          {!isActive && !isConnecting && (
            <div style={{ padding: '0 15px 15px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ color: 'rgba(100,116,139,1)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '3px' }}>
                Try asking
              </div>
              {SUGGESTED.map((p) => (
                <div key={p} onClick={handleOpen} style={{
                  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(99,102,241,.18)',
                  borderRadius: '8px', padding: '7px 11px', color: 'rgba(148,163,184,1)',
                  fontSize: '12px', cursor: 'pointer', transition: 'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.12)'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = 'rgba(148,163,184,1)'; }}
                >
                  "{p}"
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── FAB ──────────────────────────────────────────────────────── */}
      <button id="chatbot-toggle" onClick={handleToggle} aria-label="Toggle ProofChain assistant" style={{
        position: 'fixed', bottom: '24px', right: '24px',
        width: '58px', height: '58px', borderRadius: '50%', border: 'none',
        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        cursor: 'pointer', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: isActive
          ? '0 0 0 3px rgba(99,102,241,.4),0 8px 24px rgba(99,102,241,.5)'
          : '0 4px 20px rgba(99,102,241,.4)',
        zIndex: 9999, transition: 'all .2s ease',
        animation: isActive && !isOpen ? 'pc-pulse 1.2s ease-in-out infinite alternate' : 'none',
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        title="ProofChain AI Assistant"
      >
        {isOpen ? <CloseIcon /> : <MicIcon />}
        {isActive && (
          <span style={{
            position: 'absolute', top: '3px', right: '3px',
            width: '12px', height: '12px', background: '#10b981',
            borderRadius: '50%', border: '2px solid white',
            animation: 'pc-pulse 1s ease-in-out infinite alternate',
          }} />
        )}
      </button>

      {/* Animations */}
      <style>{`
        @keyframes pc-pulse {
          from { transform: scale(1); }
          to   { transform: scale(1.07); }
        }
        @keyframes pc-glow {
          from { box-shadow: 0 0 24px rgba(99,102,241,.4); }
          to   { box-shadow: 0 0 44px rgba(99,102,241,.75); }
        }
      `}</style>
    </>
  );
}

/* ── Public export — wraps inner with required Provider + ErrorBoundary ─ */
export default function ChatbotWidget() {
  return (
    <ChatbotErrorBoundary>
      <ConversationProvider>
        <ChatbotInner />
      </ConversationProvider>
    </ChatbotErrorBoundary>
  );
}

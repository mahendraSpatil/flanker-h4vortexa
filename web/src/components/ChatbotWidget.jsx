// Owner: Neel | ElevenLabs Conversational AI floating chatbot widget
import { useState, useCallback } from 'react';
import { useConversation } from '@elevenlabs/react';

const AGENT_ID = 'agent_5801m4ne6va6fqktrd7233c1yd4d';

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
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.88 5.76a1 1 0 0 0 .95.69h6.06l-4.9 3.56a1 1 0 0 0-.36 1.12L17.51 20 12 16.44 6.49 20l1.88-5.87a1 1 0 0 0-.36-1.12L3.11 9.45h6.06a1 1 0 0 0 .95-.69z" />
  </svg>
);

export default function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const conversation = useConversation({
    onConnect: () => {
      setIsConnecting(false);
    },
    onDisconnect: () => {
      setIsConnecting(false);
    },
    onError: (error) => {
      console.error('ElevenLabs error:', error);
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

  const handleToggleMic = useCallback(async () => {
    if (isActive) {
      await handleClose();
    } else {
      await handleOpen();
    }
  }, [isActive, handleOpen, handleClose]);

  return (
    <>
      {/* Floating Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            width: '320px',
            zIndex: 9999,
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            border: '1px solid rgba(99,102,241,0.35)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(99,102,241,0.1)',
            overflow: 'hidden',
            fontFamily: 'inherit',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(99,102,241,0.2)',
              background: 'rgba(99,102,241,0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  flexShrink: 0,
                }}
              >
                <SparkleIcon />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: '700', fontSize: '14px', lineHeight: 1.2 }}>
                  ProofChain Assistant
                </div>
                <div style={{ color: 'rgba(148,163,184,1)', fontSize: '11px', marginTop: '1px' }}>
                  Powered by ElevenLabs AI
                </div>
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: 'none',
                borderRadius: '8px',
                color: 'rgba(148,163,184,1)',
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = 'white'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = 'rgba(148,163,184,1)'; }}
              aria-label="Close assistant"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            {/* Voice Orb */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
              <div
                style={{
                  width: '100px',
                  height: '100px',
                  borderRadius: '50%',
                  background: isActive
                    ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)'
                    : 'rgba(30,41,59,1)',
                  border: isActive
                    ? '3px solid rgba(139,92,246,0.6)'
                    : '3px solid rgba(99,102,241,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isActive ? 'white' : 'rgba(99,102,241,0.8)',
                  boxShadow: isActive
                    ? '0 0 32px rgba(99,102,241,0.5), 0 0 64px rgba(139,92,246,0.25)'
                    : '0 4px 20px rgba(0,0,0,0.3)',
                  animation: isSpeaking
                    ? 'proofchain-pulse 0.8s ease-in-out infinite alternate'
                    : isActive
                      ? 'proofchain-glow 2s ease-in-out infinite alternate'
                      : 'none',
                  transition: 'all 0.4s ease',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={handleToggleMic}
              >
                <MicIcon />
              </div>
            </div>

            {/* Status Text */}
            <div
              style={{
                color: isConnecting
                  ? 'rgba(251,191,36,1)'
                  : isActive
                    ? isSpeaking
                      ? 'rgba(167,139,250,1)'
                      : 'rgba(52,211,153,1)'
                    : 'rgba(148,163,184,1)',
                fontWeight: '600',
                fontSize: '13px',
                marginBottom: '6px',
                transition: 'color 0.3s',
              }}
            >
              {isConnecting
                ? 'Connecting...'
                : isActive
                  ? isSpeaking
                    ? '🔊 Assistant is speaking…'
                    : '🎙️ Listening — speak now'
                  : 'Tap the mic to start'}
            </div>

            <div style={{ color: 'rgba(100,116,139,1)', fontSize: '11px', lineHeight: 1.5 }}>
              {isActive
                ? 'Ask about verification results, how to upload, or what any error code means.'
                : 'Voice-powered AI assistant. Ask anything about ProofChain.'}
            </div>

            {/* Mic Toggle Button */}
            <button
              onClick={handleToggleMic}
              disabled={isConnecting}
              style={{
                marginTop: '20px',
                width: '100%',
                padding: '11px 16px',
                borderRadius: '10px',
                border: 'none',
                background: isActive
                  ? 'rgba(239,68,68,0.15)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: isActive ? 'rgba(252,165,165,1)' : 'white',
                fontWeight: '600',
                fontSize: '13px',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                opacity: isConnecting ? 0.6 : 1,
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                outline: 'none',
              }}
              onMouseEnter={e => { if (!isConnecting) e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              {isConnecting
                ? 'Connecting...'
                : isActive
                  ? '⏹ End Conversation'
                  : '🎙️ Start Voice Chat'}
            </button>
          </div>

          {/* Suggested prompts (only when not yet active) */}
          {!isActive && !isConnecting && (
            <div
              style={{
                padding: '0 16px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ color: 'rgba(100,116,139,1)', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
                Try asking
              </div>
              {[
                'What does ROOT_MISMATCH mean?',
                'How do I verify a document?',
                'Why is my document showing DOCUMENT_MODIFIED?',
              ].map((prompt) => (
                <div
                  key={prompt}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(99,102,241,0.18)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'rgba(148,163,184,1)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(148,163,184,1)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.18)'; }}
                  onClick={handleOpen}
                >
                  "{prompt}"
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating Action Button */}
      <button
        id="chatbot-toggle"
        onClick={isOpen ? handleClose : handleOpen}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: isActive
            ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
            : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none',
          cursor: 'pointer',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isActive
            ? '0 0 0 3px rgba(99,102,241,0.4), 0 8px 24px rgba(99,102,241,0.5)'
            : '0 4px 20px rgba(99,102,241,0.4)',
          zIndex: 9999,
          transition: 'all 0.2s ease',
          animation: isActive && !isOpen ? 'proofchain-pulse 1.2s ease-in-out infinite alternate' : 'none',
          outline: 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        aria-label={isOpen ? 'Close ProofChain assistant' : 'Open ProofChain assistant'}
        title="ProofChain AI Assistant"
      >
        {isOpen ? <CloseIcon /> : <MicIcon />}
        {/* Live indicator dot */}
        {isActive && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              width: '12px',
              height: '12px',
              background: '#10b981',
              borderRadius: '50%',
              border: '2px solid white',
              animation: 'proofchain-pulse 1s ease-in-out infinite alternate',
            }}
          />
        )}
      </button>

      {/* Keyframe animations */}
      <style>{`
        @keyframes proofchain-pulse {
          from { transform: scale(1); box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
          to   { transform: scale(1.06); box-shadow: 0 0 0 8px rgba(99,102,241,0); }
        }
        @keyframes proofchain-glow {
          from { box-shadow: 0 0 24px rgba(99,102,241,0.4), 0 0 48px rgba(139,92,246,0.2); }
          to   { box-shadow: 0 0 40px rgba(99,102,241,0.7), 0 0 80px rgba(139,92,246,0.35); }
        }
      `}</style>
    </>
  );
}

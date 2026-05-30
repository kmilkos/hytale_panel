// src/utils/errorModal.jsx
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function ErrorModalComponent({ message, title, details, onClose }) {
  const [active, setActive] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Trigger smooth fade/scale entrance animation
    const raf = requestAnimationFrame(() => {
      setActive(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = () => {
    setActive(false);
    setTimeout(onClose, 250); // Match CSS transition duration
  };

  const handleCopy = () => {
    if (details || message) {
      navigator.clipboard.writeText(details ? `Error: ${message}\n\nTrace/Details:\n${details}` : message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      id="error-modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(3, 4, 7, 0.75)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: active ? 1 : 0,
        transition: 'opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={handleClose}
    >
      <div
        id="error-modal-box"
        style={{
          background: 'linear-gradient(135deg, rgba(20, 22, 33, 0.95) 0%, rgba(13, 15, 23, 0.98) 100%)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(239, 68, 68, 0.15)',
          borderRadius: '20px',
          width: '90%',
          maxWidth: '540px',
          padding: '30px',
          transform: active ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
          opacity: active ? 1 : 0,
          transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease-out',
          fontFamily: 'var(--font-sans, "Inter", sans-serif)',
          color: 'var(--text-main, #e2e8f0)',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'left'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Decorative Ambient Glow */}
        <div style={{
          position: 'absolute',
          top: '-50px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '200px',
          height: '100px',
          background: 'radial-gradient(ellipse, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0) 70%)',
          pointerEvents: 'none',
        }} />

        {/* Header Icon + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '18px' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)',
            flexShrink: 0,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h4 style={{
              margin: 0,
              fontFamily: 'var(--font-heading, "Outfit", sans-serif)',
              fontSize: '20px',
              fontWeight: '700',
              letterSpacing: '-0.02em',
              color: '#f87171',
              textShadow: '0 0 10px rgba(239,68,68,0.1)',
            }}>{title}</h4>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
              System Exception Diagnostics
            </span>
          </div>
        </div>

        {/* Message */}
        <p style={{
          color: '#e2e8f0',
          fontSize: '14px',
          lineHeight: '1.6',
          margin: '0 0 20px 0',
          fontWeight: '450',
        }}>{message}</p>

        {/* Technical Details Terminal */}
        {details && (
          <div style={{
            backgroundColor: '#07080f',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '20px',
            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)',
          }}>
            {/* Terminal Top Bar */}
            <div style={{
              backgroundColor: '#0e1017',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block' }} />
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'inline-block' }} />
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
              </div>
              <span style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                color: 'rgba(255,255,255,0.3)',
                letterSpacing: '0.03em',
                fontWeight: '600',
              }}>trace_report.log</span>
              <button
                onClick={handleCopy}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  color: 'rgba(255,255,255,0.6)',
                  padding: '4px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  outline: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
              >
                {copied ? '✅ Copied!' : '📋 Copy Log'}
              </button>
            </div>
            {/* Terminal Content */}
            <pre style={{
              margin: 0,
              padding: '16px',
              color: '#fca5a5',
              overflowX: 'auto',
              maxHeight: '180px',
              fontFamily: 'var(--font-mono, "Fira Code", monospace)',
              fontSize: '12px',
              lineHeight: '1.5',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>{details}</pre>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            style={{
              padding: '10px 24px',
              fontSize: '13px',
              fontWeight: '600',
              borderRadius: '10px',
              background: 'linear-gradient(to right, #ef4444, #dc2626)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
            onClick={handleClose}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.03)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(239, 68, 68, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.25)';
            }}
          >
            Dismiss Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows an error modal with a title and detailed message.
 * The modal is rendered into a temporary DOM container and removed on close.
 *
 * @param {string} message - Short user‑friendly error message.
 * @param {object} [options] - Optional configuration.
 * @param {string} [options.title='Error'] - Modal title.
 * @param {string} [options.details] - Additional technical details (e.g., stack trace).
 */
export function showError(message, options = {}) {
  const {
    title = 'Error',
    details = null,
  } = options;

  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const handleClose = () => {
      root.unmount();
      document.body.removeChild(container);
      resolve();
    };

    root.render(
      <ErrorModalComponent
        message={message}
        title={title}
        details={details}
        onClose={handleClose}
      />
    );
  });
}

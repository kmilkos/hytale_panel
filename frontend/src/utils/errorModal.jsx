// src/utils/errorModal.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';

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

    const cleanup = () => {
      const modalEl = document.getElementById('error-modal-box');
      const overlayEl = document.getElementById('error-modal-overlay');
      if (modalEl && overlayEl) {
        modalEl.style.transform = 'scale(0.95)';
        modalEl.style.opacity = '0';
        overlayEl.style.opacity = '0';
      }
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve();
      }, 200);
    };

    root.render(
      <div
        id="error-modal-overlay"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(5, 6, 8, 0.75)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1,
          transition: 'opacity 0.2s ease-out',
        }}
        onClick={cleanup}
      >
        <div
          id="error-modal-box"
          style={{
            backgroundColor: '#11131c',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg), 0 0 30px rgba(255,0,0,0.5)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '480px',
            padding: '28px',
            transform: 'scale(1)',
            opacity: 1,
            transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out',
            fontFamily: 'var(--font-sans)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h4 style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '18px',
            fontWeight: '600',
            color: 'var(--error)',
            marginBottom: '14px',
          }}>{title}</h4>
          <p style={{
            color: 'var(--text-main)',
            fontSize: '14px',
            lineHeight: '1.6',
            marginBottom: details ? '16px' : '0',
          }}>{message}</p>
          {details && (
            <pre style={{
              backgroundColor: '#0a0b12',
              color: '#ff6b6b',
              padding: '12px',
              borderRadius: '8px',
              overflowX: 'auto',
              fontSize: '12px',
              marginBottom: '16px',
            }}>{details}</pre>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 20px', fontSize: '13px' }}
              onClick={cleanup}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  });
}

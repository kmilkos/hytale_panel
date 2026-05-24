import React from 'react';
import { createRoot } from 'react-dom/client';

export function showConfirm(message, options = {}) {
  const {
    title = 'Confirm Action',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false,
  } = options;

  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);

    const cleanup = (value) => {
      const modalEl = document.getElementById('confirm-modal-box');
      const overlayEl = document.getElementById('confirm-modal-overlay');
      if (modalEl && overlayEl) {
        modalEl.style.transform = 'scale(0.95)';
        modalEl.style.opacity = '0';
        overlayEl.style.opacity = '0';
      }

      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve(value);
      }, 200);
    };

    root.render(
      <div 
        id="confirm-modal-overlay"
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
          transition: 'opacity 0.2s ease-out'
        }}
        onClick={() => cleanup(false)}
      >
        <div 
          id="confirm-modal-box"
          style={{
            backgroundColor: '#11131c',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg), 0 0 30px rgba(0, 0, 0, 0.5)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '440px',
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
            color: isDanger ? 'var(--error)' : 'var(--primary)',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {isDanger ? '⚠️' : '❓'} {title}
          </h4>

          <p style={{ 
            color: 'var(--text-main)', 
            fontSize: '14px', 
            lineHeight: '1.6',
            marginBottom: '24px'
          }}>
            {message}
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button 
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '13px' }}
              onClick={() => cleanup(false)}
            >
              {cancelText}
            </button>
            <button 
              className={isDanger ? 'btn btn-danger' : 'btn btn-primary'}
              style={{ padding: '8px 18px', fontSize: '13px', fontWeight: '600' }}
              onClick={() => cleanup(true)}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  });
}

/**
 * Custom three-option choice modal specifically for deleting a Hytale mod file 
 * that has associated folders.
 * Returns a promise resolving to:
 *   - 'cancel' (cancel delete action)
 *   - 'keep' (delete mod file, keep folders)
 *   - 'delete' (delete mod file, delete folders)
 *   - 'backup' (delete mod file, backup folders)
 */
export function showModDeleteConfirm(fileName, folders = []) {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const root = createRoot(container);

    const cleanup = (choice) => {
      const modalEl = document.getElementById('mod-delete-modal-box');
      const overlayEl = document.getElementById('mod-delete-modal-overlay');
      if (modalEl && overlayEl) {
        modalEl.style.transform = 'scale(0.95)';
        modalEl.style.opacity = '0';
        overlayEl.style.opacity = '0';
      }

      setTimeout(() => {
        root.unmount();
        document.body.removeChild(container);
        resolve(choice);
      }, 200);
    };

    root.render(
      <div 
        id="mod-delete-modal-overlay"
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
          transition: 'opacity 0.2s ease-out'
        }}
        onClick={() => cleanup('cancel')}
      >
        <div 
          id="mod-delete-modal-box"
          style={{
            backgroundColor: '#11131c',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg), 0 0 40px rgba(0, 0, 0, 0.6)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '520px',
            padding: '32px',
            transform: 'scale(1)',
            opacity: 1,
            transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out',
            fontFamily: 'var(--font-sans)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <h4 style={{ 
            fontFamily: 'var(--font-heading)', 
            fontSize: '18px', 
            fontWeight: '600', 
            color: 'var(--error)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            ⚙️ Delete Mod & Data
          </h4>

          {/* Description */}
          <p style={{ color: 'var(--text-main)', fontSize: '14px', lineHeight: '1.6', marginBottom: '14px' }}>
            Are you sure you want to delete mod file <code style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)', fontSize: '13px', backgroundColor: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>{fileName}</code>?
          </p>

          <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }}>
            We detected the following associated configuration or data directories:
          </p>

          {/* Folders List */}
          <div style={{ 
            backgroundColor: '#090a0f', 
            border: '1px solid var(--border)', 
            borderRadius: '8px', 
            padding: '12px 16px', 
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {folders.map((folder, index) => (
              <div key={index} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--primary)' }}>📁</span> {folder}
              </div>
            ))}
          </div>

          <p style={{ color: 'var(--text-main)', fontSize: '13px', fontWeight: '500', marginBottom: '16px' }}>
            Choose how to handle the mod directories:
          </p>

          {/* Options Buttons Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            <button 
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', padding: '12px 18px', border: '1px solid rgba(244, 63, 94, 0.4)', backgroundColor: 'rgba(244, 63, 94, 0.05)' }}
              onClick={() => cleanup('delete')}
            >
              <span style={{ marginRight: '6px' }}>🗑️</span> Completely Delete Mod Directories
            </button>
            
            <button 
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', padding: '12px 18px', border: '1px solid rgba(59, 130, 246, 0.4)', backgroundColor: 'rgba(59, 130, 246, 0.05)' }}
              onClick={() => cleanup('backup')}
            >
              <span style={{ marginRight: '6px' }}>📦</span> Backup Mod Directories and Delete Jar
            </button>

            <button 
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', padding: '12px 18px' }}
              onClick={() => cleanup('keep')}
            >
              <span style={{ marginRight: '6px' }}>📂</span> Keep Mod Directories (Delete Jar Only)
            </button>
          </div>

          {/* Cancel button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <button 
              className="btn btn-secondary"
              style={{ padding: '8px 20px', fontSize: '13px' }}
              onClick={() => cleanup('cancel')}
            >
              Cancel Deletion
            </button>
          </div>
        </div>
      </div>
    );
  });
}

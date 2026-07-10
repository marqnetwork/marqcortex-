import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';

// ── Root element guard ────────────────────────────────────────────────────────
const rootElement = document.getElementById('root');

if (!rootElement) {
  // Can't use React here — write directly to DOM
  document.body.innerHTML =
    '<div style="color:white;background:#0A0A0F;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-size:18px;">Root element missing</div>';
  throw new Error('Root element #root not found in index.html');
}

// ── Global uncaught error → visible DOM fallback (prevents silent blank) ──────
window.addEventListener('error', (e) => {
  if (rootElement.children.length === 0) {
    rootElement.innerHTML = `
      <div style="min-height:100vh;background:#0A0A0F;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;padding:24px;">
        <div style="max-width:520px;background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px;text-align:center;">
          <div style="font-size:32px;margin-bottom:16px;">⚠️</div>
          <h2 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 8px;">App failed to start</h2>
          <p style="color:#9CA3AF;font-size:13px;margin:0 0 16px;line-height:1.6;">A JavaScript error prevented the app from loading. Check the browser console for the full error.</p>
          <pre style="background:#0D0D14;border:1px solid rgba(253,68,56,0.25);border-radius:8px;padding:12px;color:#FD4438;font-size:11px;text-align:left;white-space:pre-wrap;word-break:break-word;margin:0 0 20px;">${String(e.message ?? e.error ?? 'Unknown error').slice(0, 400)}</pre>
          <button onclick="location.reload()" style="padding:10px 24px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:10px;color:#8B5CF6;font-size:14px;font-weight:600;cursor:pointer;">Reload</button>
        </div>
      </div>`;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (rootElement.children.length === 0) {
    console.error('[MARQ Cortex] Unhandled promise rejection:', e.reason);
  }
});

// ── Mount app ─────────────────────────────────────────────────────────────────
async function mount() {
  try {
    const { default: App } = await import('@/app/App');
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    console.error('[MARQ Cortex] Fatal mount error:', err);
    if (rootElement.children.length === 0) {
      rootElement.innerHTML = `
        <div style="min-height:100vh;background:#0A0A0F;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;padding:24px;">
          <div style="max-width:520px;background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px;text-align:center;">
            <div style="font-size:32px;margin-bottom:16px;">🔧</div>
            <h2 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 8px;">MARQ Cortex</h2>
            <p style="color:#9CA3AF;font-size:13px;margin:0 0 16px;line-height:1.6;">A module failed to load. Check the browser console for details.</p>
            <pre style="background:#0D0D14;border:1px solid rgba(253,68,56,0.25);border-radius:8px;padding:12px;color:#FD4438;font-size:11px;text-align:left;white-space:pre-wrap;word-break:break-word;margin:0 0 20px;">${String(err instanceof Error ? err.message : err).slice(0, 400)}</pre>
            <button onclick="location.reload()" style="padding:10px 24px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:10px;color:#8B5CF6;font-size:14px;font-weight:600;cursor:pointer;">Reload</button>
          </div>
        </div>`;
    }
  }
}

mount();

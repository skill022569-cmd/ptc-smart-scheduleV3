'use client';
import { useEffect } from 'react';

// The UI is a framework-free module shared with the approved prototype; React only mounts it.
export default function App() {
  useEffect(() => {
    const pre = fetch('/api/bootstrap', { cache: 'no-store' }); // load data while the UI code downloads
    import('../lib/ui.js').then(m => m.start(pre));
  }, []);
  return (
    <>
      <div id="app"><p style={{ padding: 24 }}>กำลังโหลด…</p></div>
      <div id="bar" aria-hidden="true" />
      <div id="toast" role="status" aria-live="polite" hidden />
      <div id="cookie" hidden />
    </>
  );
}

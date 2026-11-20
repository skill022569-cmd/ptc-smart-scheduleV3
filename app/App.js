'use client';
import { useEffect } from 'react';

// The UI is a framework-free module shared with the approved prototype; React only mounts it.
export default function App() {
  useEffect(() => { import('../lib/ui.js').then(m => m.start()) }, []);
  return (
    <>
      <div id="app"><p style={{ padding: 24 }}>กำลังโหลด…</p></div>
      <div id="toast" role="status" aria-live="polite" hidden />
      <div id="cookie" hidden />
    </>
  );
}

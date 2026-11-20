import { getSession, clearSession, audit, json } from '../../../../lib/server.js';
export async function POST() {
  const me = await getSession();
  if (me) await audit(me.name, 'LOGOUT', '');
  clearSession();
  return json({ ok: true });
}

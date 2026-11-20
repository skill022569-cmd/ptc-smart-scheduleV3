import { prisma, getSession } from '../../../../lib/server.js';

// Profile photo: public only when the person consented; otherwise admins, executives and the person themself.
export async function GET(_req, { params }) {
  const id = String(params.id).slice(0, 40);
  const [p, me] = await Promise.all([prisma.personnel.findUnique({ where: { id }, select: { isPublicProfile: true } }), getSession()]);
  const priv = me && !me.mc && (me.role === 'ADMIN' || me.role === 'EXEC' || me.pid === id);
  const ph = p && (p.isPublicProfile || priv) ? await prisma.personnelPhoto.findUnique({ where: { personnelId: id } }) : null;
  const m = ph && ph.data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response('Not found', { status: 404 });
  // private: never cached by a CDN, so withdrawing consent takes effect for new visitors at once
  return new Response(Buffer.from(m[2], 'base64'), { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
}

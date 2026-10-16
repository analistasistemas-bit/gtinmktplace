const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function autorizarDesfazer(ctx: { isAdmin: boolean; support: unknown }): string | null {
  return ctx.isAdmin ? null : 'Só administradores da empresa podem desfazer ou cancelar uma importação.';
}
export function validarDesfazer(body: unknown):
  { ok: true; notaId: string; status: 'desfeita' | 'cancelada' } | { ok: false; erro: string } {
  const b = (body ?? {}) as { notaId?: unknown; status?: unknown };
  if (typeof b.notaId !== 'string' || !UUID.test(b.notaId)) return { ok: false, erro: 'notaId inválido.' };
  if (b.status !== 'desfeita' && b.status !== 'cancelada') return { ok: false, erro: 'status deve ser desfeita ou cancelada.' };
  return { ok: true, notaId: b.notaId, status: b.status };
}

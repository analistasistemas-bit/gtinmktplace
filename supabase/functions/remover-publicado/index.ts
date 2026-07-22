import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { removerPublicado, MENSAGEM_BLOQUEIO_UP } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: membro autenticado da operação (ADR-0047/0056) + org (E7). Remoção age
  // sobre qualquer anúncio da org do chamador, não só os do chamador individual.
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  // canal (E6/ADR-0061): default 'mercado_livre' — chamadas atuais (sem o campo) ficam idênticas.
  const { familia_id, canal = 'mercado_livre' } = await req.json().catch(() => ({}));
  if (!familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const r = await removerPublicado(admin, { familiaId: familia_id, orgId, canal });
  switch (r.tipo) {
    case 'nao_encontrada':
      return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
    case 'nao_publicada':
      return json({ erro: 'Família não publicada — nada a remover aqui.' }, 400);
    case 'em_voo':
      return json({ erro: 'Há uma publicação em andamento para este código. Aguarde terminar antes de remover.' }, 409);
    case 'bloqueio_up':
      return json({ erro: MENSAGEM_BLOQUEIO_UP }, 409);
    case 'ok':
      return json({ ok: true, familias_removidas: r.familiasRemovidas, lotes_removidos: r.lotesRemovidos });
  }
});

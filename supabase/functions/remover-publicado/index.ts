import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { removerPublicado } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: membro autenticado da operação (ADR-0047/0056) + org (E7). Remoção age
  // sobre qualquer anúncio da org do chamador, não só os do chamador individual.
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  // canal (E6/ADR-0061): default 'mercado_livre' — chamadas atuais (sem o campo) ficam idênticas.
  const { familia_id, canal = 'mercado_livre', preservar_familia = false } = await req.json().catch(() => ({}));
  if (!familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // ADR-0088: resolve sempre (SELECT barato, mesmo padrão de update-familia-ml/index.ts) — mas
  // quem DECIDE se precisa de token vivo é `processar.ts`: só exige ctx/conexao quando a família
  // realmente tem filhos User Products pra pausar (Legacy/UP-esvaziada seguem sem token).
  const conexao = await resolverConexao(admin, orgId, canal);
  const ctx = {
    getToken: () => conexao
      ? getValidAccessTokenConexao(conexao)
      : Promise.reject(new Error('Organização sem conexão com o Mercado Livre')),
  };

  const r = await removerPublicado(
    { admin, ctx, conexao: conexao ?? undefined },
    { familiaId: familia_id, orgId, canal, preservarFamilia: preservar_familia },
  );
  const target = { type: 'familia', id: familia_id as string };
  switch (r.tipo) {
    case 'nao_encontrada':
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
    case 'nao_publicada':
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({ erro: 'Família não publicada — nada a remover aqui.' }, 400);
    case 'em_voo':
      await auditarOperacaoSuporte(admin, context, target, 'denied');
      return json({ erro: 'Há uma publicação em andamento para este código. Aguarde terminar antes de remover.' }, 409);
    case 'remocao_pendente':
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({
        erro: `Algumas cores não confirmaram a pausa no Mercado Livre ainda (${r.pendentes.join(', ')}). `
          + 'Nada foi removido — tente de novo em instantes; se persistir, contate o suporte.',
        pendentes: r.pendentes,
      }, 409);
    case 'kit_vinculado_ativo': {
      await auditarOperacaoSuporte(admin, context, target, 'denied');
      const listaKits = r.kits.map((k) => `${k.multiplicador}un`).join(', ');
      // `preservar_familia=true` é o fluxo de Republicar: NUNCA apaga a base (devolve
      // status='pronto'). A instrução de "excluir o produto do kit" só faz sentido pra
      // remoção de verdade — servi-la aqui mandaria o operador apagar algo à toa.
      const erro = preservar_familia
        ? `Este produto tem ${r.kits.length} kit(s) vinculado(s) (${listaKits}). `
          + 'Remova/pause os kits no marketplace antes de republicar este produto.'
        // Remoção de verdade: `remover-publicado` devolve o kit para 'pronto' (processar.ts,
        // mini-saga de republicação), que continua em STATUS_KIT_VIVO — tirar o kit do ML
        // sozinho não solta o bloqueio. O operador precisa também excluir o produto do kit
        // (excluir-produto, ADR-0113) para o vínculo desaparecer de vez.
        : `Este produto tem ${r.kits.length} kit(s) vinculado(s) (${listaKits}). `
          + 'Remova cada kit do marketplace e depois exclua o produto do kit '
          + '(Estoque → ⋮ → Excluir) antes de remover este.';
      return json({ erro }, 409);
    }
    case 'preservada':
      await auditarOperacaoSuporte(admin, context, target, 'succeeded');
      return json({ ok: true, familia_id: r.familiaId, lote_id: r.loteId });
    case 'ok':
      await auditarOperacaoSuporte(admin, context, target, 'succeeded');
      return json({ ok: true, familias_removidas: r.familiasRemovidas, lotes_removidos: r.lotesRemovidos });
  }
});

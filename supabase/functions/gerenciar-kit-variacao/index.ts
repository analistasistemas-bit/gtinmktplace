// ADR-0197 (Task 13): edge da tela Gerenciar kit. Casca: autenticação, gate de admin (montar, desmontar e "Vender só
// em kit" pausam anúncios, ADR-0060), módulo `kit_variacao` e as portas reais de `processar.ts`. Cada operação é uma
// RPC (`kit_variacao_gerenciar`): CAS de versão e efeito na mesma transação.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarReposicao, enfileirarSaga } from '../_shared/queue.ts';
import { alvosDe } from '../_shared/kit-variacao/reposicao.ts';
import { gerenciarKit, type AcaoKit, type DepsGerenciarKit, type GerenciarKitInput, type RespostaRpcGerenciar } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<string, number> = {
  kit_nao_encontrado: 404, modulo_desligado: 403, versao: 409, up_ocupado: 409, alvos_invalidos: 409,
  sku_sem_anuncio: 409, so_em_kit_desligado: 409, pedido_diferente: 409,
};

function portas(admin: SupabaseClient, orgId: string): DepsGerenciarKit {
  return {
    orgId,
    async skusDoKit(kitId) {
      const { data, error } = await admin.from('kit_variacao_skus')
        .select('codigo, kit_variacao_componentes(codigo, quantidade)').eq('kit_id', kitId).eq('org_id', orgId);
      if (error) throw new Error(`kit_variacao_skus: ${error.message}`);
      return (data ?? []).map((s) => ({
        codigo: s.codigo as string,
        componentes: ((s as { kit_variacao_componentes?: Array<{ codigo: string; quantidade: number }> }).kit_variacao_componentes ?? []),
      }));
    },
    alvosDe: (codigos) => alvosDe(admin, orgId, codigos),
    async rpc(a) {
      const { data, error } = await admin.rpc('kit_variacao_gerenciar', {
        p_org: orgId, p_kit: a.kitId, p_acao: a.acao, p_versao: a.versao, p_chave: a.chave, p_hash: a.hash, p_meta: a.meta,
        p_itens: a.itens, p_alvos: a.alvos, p_desligar_so_em_kit: a.desligarSoEmKit,
      });
      if (error) throw new Error(`kit_variacao_gerenciar: ${error.message}`);
      return data as RespostaRpcGerenciar;
    },
    enfileirarSaga: (id) => enfileirarSaga(id, orgId),
    enfileirarReposicao: (kitId) => enfileirarReposicao(orgId, kitId),
  };
}

function parse(body: Record<string, unknown>): GerenciarKitInput | null {
  if (typeof body?.kit_id !== 'string' || typeof body.acao !== 'string') return null;
  return {
    kitId: body.kit_id, acao: body.acao as AcaoKit,
    ...(typeof body.versao === 'number' ? { versao: body.versao } : {}),
    ...(typeof body.meta === 'number' ? { meta: body.meta } : {}),
    ...(typeof body.chave === 'string' && body.chave ? { chave: body.chave } : {}),
    ...(body.desligar_so_em_kit === true ? { desligarSoEmKit: true } : {}),
    ...(Array.isArray(body.itens)
      ? { itens: (body.itens as Array<Record<string, unknown>>).map((i) => ({ codigo: String(i?.codigo ?? ''), quantidade: Number(i?.quantidade) })) }
      : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;
  const admin = adminClient();

  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'kit_variacao'))) {
    return json({ error: 'Kit com variação não habilitado para esta organização.' }, 403);
  }

  let input: GerenciarKitInput | null;
  try { input = parse(await req.json()); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!input) return json({ error: 'Payload inválido.' }, 400);
  const target = { type: 'kit_variacao', id: input.kitId };

  try {
    const r = await gerenciarKit(portas(admin, orgId), input);
    if (!r.ok) {
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({ error: r.mensagem ?? r.motivo, motivo: r.motivo }, STATUS_POR_MOTIVO[r.motivo] ?? 400);
    }
    await auditarOperacaoSuporte(admin, context, target, 'succeeded');
    return json(r);
  } catch (e) {
    console.error('gerenciar_kit_variacao_falhou', orgId, String(e));
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

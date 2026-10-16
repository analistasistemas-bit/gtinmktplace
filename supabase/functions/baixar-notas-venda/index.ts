// ADR-0181 Plano 2a — pacote do contador (vendas): repassa o zip de notas do mês do ML. JWT do app; gate estoque.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { redisSet, redisSetNX } from '../_shared/redis/client.ts';
import { baixarLoteMes } from './processar.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'read' }); }
  catch (resp) {
    if (resp instanceof Response) {   // corpo cru pode ser texto e vem sem CORS — responde JSON próprio
      return json({ error: 'Sessão expirada ou sem acesso — entre de novo.' }, resp.status);
    }
    throw resp;
  }
  const admin = adminClient();

  try {
    if (!(await exigirModulo(admin, ctx.orgId, 'estoque'))) return json({ error: 'Módulo de estoque não habilitado.' }, 403);
    const conexao = await resolverConexao(admin, ctx.orgId, 'mercado_livre');
    if (!conexao?.contaExternaId) return json({ error: 'Conecte a conta do Mercado Livre em Canais.' }, 409);

    const body: unknown = await req.json().catch(() => null);
    const mes = body && typeof body === 'object' && typeof (body as { mes?: unknown }).mes === 'string' ? (body as { mes: string }).mes : '';
    const alvo = { type: 'pacote_contador_mes', id: mes || 'invalido' };

    const saida = await baixarLoteMes({
      travar: (chave, ttl) => redisSetNX(chave, '1', ttl),
      liberar: (chave, s) => redisSet(chave, '1', s),
      token: () => getValidAccessTokenConexao(conexao),
      fetchMl: (url, token, signal) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }),
    }, { conexaoId: conexao.id, conta: conexao.contaExternaId, mes, agora: new Date(), signal: req.signal });

    if (saida.tipo === 'erro') {
      await auditarOperacaoSuporte(admin, ctx, alvo, 'failed').catch(() => {});
      return json({ error: saida.mensagem }, saida.status);
    }
    try {
      await auditarOperacaoSuporte(admin, ctx, alvo, 'succeeded');   // antes de liberar os bytes
    } catch {
      if (saida.tipo === 'zip') await saida.body.cancel('auditoria falhou').catch(() => {});
      return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.', codigo: 'auditoria' }, 502);
    }
    const ident = {
      'X-Org-Id': ctx.orgId, 'X-Conta-Ml': conexao.contaExternaId,
      'Access-Control-Expose-Headers': 'X-Org-Id, X-Conta-Ml',
    };
    if (saida.tipo === 'vazio') return json({ vazio: true }, 200, ident);
    return new Response(saida.body, { status: 200, headers: { ...corsHeaders, ...ident, 'Content-Type': 'application/octet-stream' } });
  } catch (e) {
    console.error('baixar_notas_venda_falhou', String(e));   // Redis, banco ou token fora do caminho previsto
    return json({ error: 'Falha interna ao preparar o download — o pacote não foi gerado.' }, 502);
  }
});

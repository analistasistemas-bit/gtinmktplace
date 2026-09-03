// E6b (ADR-0094, D-9/D-10/D-15): entrada de mercadoria. Escrita de estoque só passa por aqui
// (service_role), nunca do browser direto — o trigger de bloqueio do Bloco A recusa UPDATE
// direto em variacoes.estoque justamente para o ledger nunca ficar sem o movimento.
//
// Aceita uma cor (`codigo`+`quantidade`, o picker global) ou várias de um produto
// (`itens: [...]`, o diálogo aberto pelo card). O miolo vive em processar.ts, com dependências
// injetadas para ser testável sem Deno — mesmo arranjo de `ajustar-estoque`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarEntrada } from './validar.ts';
import { processarEntrada } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string;
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: {
    codigo?: string; quantidade?: number; custo?: number | null; itens?: unknown;
    documento?: string | null; observacao?: string | null; ref?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const validacao = validarEntrada(body);
  if (!validacao.ok) return json({ error: validacao.erro }, 400);

  // Idempotência: o cliente gera um uuid por submissão do formulário. Sem isso, duplo clique
  // ou retry de rede soma o saldo 2× e sobrescreve o custo 2× — e isto é caminho financeiro.
  const ref = body.ref?.trim();
  if (!ref) return json({ error: 'Referência de idempotência ausente.' }, 400);

  const r = await processarEntrada(
    {
      // `async` de propósito: o builder do supabase-js devolve PromiseLike, e o contrato de
      // DepsEntrada pede Promise (deno check reprova a atribuição direta).
      rpc: async (nome, args) => {
        const res = await admin.rpc(nome, args);
        return { data: res.data, error: res.error };
      },
      lerMovimento: async (org, refItem) => {
        const { data } = await admin.from('estoque_movimentos')
          .select('codigo_pai, estoque_resultante')
          .eq('org_id', org).eq('referencia_externa', refItem).maybeSingle();
        return (data as { codigo_pai: string | null; estoque_resultante: number | null } | null) ?? null;
      },
      enfileirar: enfileirarSincronizacaoEstoque,
    },
    {
      orgId, userId, itens: validacao.itens, unico: validacao.unico,
      documento: body.documento?.trim() || null,
      observacao: body.observacao?.trim() || null,
      ref,
    },
  );

  await auditarOperacaoSuporte(
    admin, context, { type: 'variacao', id: validacao.itens.map((i) => i.codigo).join(',') }, 'succeeded',
  );

  // Formato antigo preservado inteiro (uma cor): `estoque`/`duplicada` no topo E o 400 quando a
  // RPC recusa — o cliente antigo trata erro pelo status, não por um campo no corpo. Uma aba já
  // aberta durante o deploy continua funcionando.
  if (validacao.unico) {
    const primeiro = r.resultados[0];
    if (primeiro?.erro) return json({ error: primeiro.erro }, 400);
    return json({ estoque: primeiro?.estoque ?? null, duplicada: primeiro?.duplicada === true, pushOk: r.pushOk });
  }
  // Lote: erro é POR ITEM (o operador precisa ver o que não entrou), como no ajuste.
  return json(r);
});

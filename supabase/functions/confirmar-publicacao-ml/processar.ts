// ADR-0195: conferência pós-escrita. Relê o ML, compara com o valor enviado e fecha a linha. Só lê:
// nunca escreve no ML nem reenvia estoque. Um job cobre todos os itens da família.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ConexaoCanal, resolverConexao } from '../_shared/canais/conexao.ts';
import { avaliarConfirmacao, proximoPasso, type Divergente, type EnviadoSku } from '../_shared/confirmacao/avaliar.ts';
import type { lerEstoqueItens, EstoqueItem } from '../_shared/ml/ler-estoque-itens.ts';
import { montarMensagemConfirmacaoFalhou } from '../_shared/notificacoes/estoque.ts';
import type { notificarCategoria } from '../_shared/notificacoes/config.ts';
import type { ConfirmarJob, enfileirarConfirmacao } from '../_shared/queue.ts';

const TABELA = 'confirmacoes_ml';
// Movimento pouco antes do envio pode ainda não estar no saldo enviado (ledger e push em voo).
const FOLGA_MOVIMENTOS_MS = 5 * 60 * 1000;

export interface DepsConfirmacao {
  admin: SupabaseClient;
  resolverConexao: typeof resolverConexao;
  getToken: (conexao: ConexaoCanal) => Promise<string>;
  lerEstoqueItens: typeof lerEstoqueItens;
  enfileirarConfirmacao: typeof enfileirarConfirmacao;
  notificarCategoria: typeof notificarCategoria;
  agora: () => string;
}

interface LinhaConfirmacao {
  id: string;
  org_id: string;
  codigo_pai: string;
  item_externo_id: string;
  modelo: 'variacoes' | 'item';
  enviado: Record<string, EnviadoSku>;
}

/** Saldo vivo dos itens. Falha de conexão ou token vira leitura vazia, nunca veredito. */
async function lerItens(
  deps: DepsConfirmacao, orgId: string, ids: string[],
): Promise<Record<string, EstoqueItem | 'erro'>> {
  try {
    const conexao = await deps.resolverConexao(deps.admin, orgId, 'mercado_livre');
    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    return await deps.lerEstoqueItens(await deps.getToken(conexao), ids);
  } catch (e) {
    console.error(`conferência: leitura falhou (org ${orgId}):`, (e as Error).message);
    return {};
  }
}

/** Soma do ledger por SKU na janela. null quando a consulta falha: sem ela não dá para julgar. */
async function lerMovimentos(
  admin: SupabaseClient, orgId: string, skus: string[], versao: string,
): Promise<Record<string, number> | null> {
  const desde = new Date(Date.parse(versao) - FOLGA_MOVIMENTOS_MS).toISOString();
  const { data, error } = await admin.from('estoque_movimentos')
    .select('codigo, quantidade').eq('org_id', orgId).in('codigo', skus).gte('criado_em', desde);
  if (error) {
    console.error(`conferência: ledger falhou (org ${orgId}):`, error.message);
    return null;
  }
  const soma: Record<string, number> = {};
  for (const m of (data ?? []) as Array<{ codigo: string; quantidade: number }>) {
    soma[m.codigo] = (soma[m.codigo] ?? 0) + m.quantidade;
  }
  return soma;
}

function observadoDe(l: LinhaConfirmacao, lido: EstoqueItem): Record<string, number | null> {
  return Object.fromEntries(Object.entries(l.enviado).map(([sku, e]) => [
    sku,
    l.modelo === 'item' ? lido.total : (e.variacao_id == null ? null : lido.porVariacao[e.variacao_id] ?? null),
  ]));
}

export async function processarConfirmacao(
  deps: DepsConfirmacao, job: ConfirmarJob,
): Promise<{ status: number; body: unknown }> {
  const { admin } = deps;

  // Claim atômico: entrega dupla, reentrega e job de escrita antiga caem em zero linhas. Depois dele
  // a leitura está consumida; falha aqui embaixo fecha a linha ou deixa o teto de 20 min da tela agir.
  const { data, error } = await admin.from(TABELA).update({ tentativas: job.tentativa })
    .eq('familia_id', job.familia_id).eq('enviado_em', job.versao)
    .eq('status', 'aguardando').eq('tentativas', job.tentativa - 1)
    .select('*');
  if (error) return { status: 500, body: { erro: error.message } };
  const linhas = (data ?? []) as unknown as LinhaConfirmacao[];
  if (linhas.length === 0) return { status: 200, body: { skip: true } };

  const verificadoEm = deps.agora();
  const fechar = async (l: LinhaConfirmacao, campos: Record<string, unknown>): Promise<void> => {
    // Os filtros protegem contra upsert de uma escrita nova entre o claim e aqui.
    const { error: errFechar } = await admin.from(TABELA).update({ ...campos, verificado_em: verificadoEm })
      .eq('id', l.id).eq('enviado_em', job.versao).eq('status', 'aguardando');
    if (errFechar) console.error(`conferência: fechar ${l.id} falhou:`, errFechar.message);
  };

  // Outra família (lote mais novo) escreveu depois no mesmo item: a conferência é dela.
  const orgId = linhas[0].org_id;
  const { data: maisNovas } = await admin.from(TABELA).select('item_externo_id')
    .eq('org_id', orgId).in('item_externo_id', linhas.map((l) => l.item_externo_id))
    .neq('familia_id', job.familia_id).gt('enviado_em', job.versao);
  const superados = new Set(((maisNovas ?? []) as Array<{ item_externo_id: string }>).map((m) => m.item_externo_id));
  const aLer: LinhaConfirmacao[] = [];
  for (const l of linhas) {
    if (superados.has(l.item_externo_id)) await fechar(l, { status: 'inconclusivo' });
    else aLer.push(l);
  }
  if (aLer.length === 0) return { status: 200, body: { ok: true } };

  const estoque = await lerItens(deps, orgId, aLer.map((l) => l.item_externo_id));
  const skus = [...new Set(aLer.flatMap((l) => Object.keys(l.enviado)))];
  const movimentos = await lerMovimentos(admin, orgId, skus, job.versao);

  const pendentes: LinhaConfirmacao[] = [];
  const falhas: Divergente[] = [];
  let reler = 0;
  for (const l of aLer) {
    const lido = estoque[l.item_externo_id];
    if (!lido || lido === 'erro' || !movimentos) {
      const passo = proximoPasso({
        ok: false, naoAplicada: false, explicavelPorMovimento: false, leituraFalhou: true, tentativa: job.tentativa,
      });
      if ('reler' in passo) { reler = passo.reler; pendentes.push(l); } else await fechar(l, { status: passo.status });
      continue;
    }
    const observado = observadoDe(l, lido);
    const avaliacao = avaliarConfirmacao({ enviado: l.enviado, observado, movimentos });
    const passo = proximoPasso({ ...avaliacao, leituraFalhou: false, tentativa: job.tentativa });
    if ('reler' in passo) { reler = passo.reler; pendentes.push(l); continue; }
    await fechar(l, { status: passo.status, observado, divergentes: avaliacao.divergentes });
    if (passo.status === 'falhou') falhas.push(...avaliacao.divergentes);
  }

  if (pendentes.length > 0) {
    try {
      await deps.enfileirarConfirmacao({ familia_id: job.familia_id, tentativa: job.tentativa + 1, versao: job.versao }, reler);
    } catch (e) {
      console.error(`conferência: reagendar falhou (${job.familia_id}):`, (e as Error).message);
      for (const l of pendentes) await fechar(l, { status: 'inconclusivo' });
    }
  }

  if (falhas.length > 0) {
    try {
      const { data: familia } = await admin.from('familias').select('nome_pai').eq('id', job.familia_id).maybeSingle();
      const texto = montarMensagemConfirmacaoFalhou({
        produto: (familia?.nome_pai as string | null | undefined) ?? null,
        codigoPai: linhas[0].codigo_pai,
        divergentes: falhas,
      });
      await deps.notificarCategoria(admin, orgId, 'estoque', texto, {
        chave: `confirmacao-falhou:${job.familia_id}:${job.versao}`,
      });
    } catch (e) {
      console.error(`conferência: aviso falhou (${job.familia_id}):`, (e as Error).message);
    }
  }
  return { status: 200, body: { ok: true } };
}

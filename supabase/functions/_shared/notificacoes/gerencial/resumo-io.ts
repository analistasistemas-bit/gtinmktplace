// Resumo diário (ADR-0190 D-6): às 08:00 BRT o disparo publica um job por org com o dia anterior
// (calculado NO DISPARO); o job da org monta o "📊 Ontem" e notifica `resumo_diario` com chave
// idempotente por dia. Toda leitura de lista é paginada ou agregada (count/head).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../../queue.ts';
import { enfileirarEmBlocos } from '../../enfileirar-em-blocos.ts';
import { notificarCategoria } from '../config.ts';
import { exigirModulo } from '../../produto/modulo.ts';
import { selecionarAlertas, type PromoAlerta } from '../../promocoes/alertas.ts';
import { carregarContexto, lerPaginas, lerVendasJanela, type MetricsDb } from '../../platform-admin/metrics-repository.ts';
import { abertasComPrazoAte, estornadoNoPeriodo, lerDevolucoesDoResumo } from './devolucoes.ts';
import { diaBrt, horaBrt, janelaDia, janelasMesFechado } from './janelas.ts';
import { lerKpis } from './kpis.ts';
import { montarResumoDiario, type DadosResumo } from './mensagens.ts';
import { contarAtencao, lucroDoPeriodo, resultadoPorItem, topPorLucro } from './resultado.ts';

type Consulta = ReturnType<MetricsDb['from']>;
const LOTE = 200;
const MAX_FRETE = 5;
const PRAZO_DEVOLUCAO_MS = 48 * 3_600_000;
const DIA_MS = 86_400_000;

async function paginas(build: () => unknown, rotulo: string): Promise<Record<string, unknown>[]> {
  const { rows, error } = await lerPaginas(build as () => Consulta);
  if (error) throw new Error(`${rotulo}: ${error.message}`);
  return rows;
}

const lotes = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / LOTE) }, (_, i) => xs.slice(i * LOTE, (i + 1) * LOTE));

/** Orgs com algum profile ativo, admin, assinante de `resumo_diario`. Não olha `telegram_ativo`:
 *  o in-app vale com o Telegram desligado (D-7). */
export async function orgsDoResumo(admin: SupabaseClient): Promise<string[]> {
  const rows = await paginas(() => admin.from('profiles').select('org_id')
    .eq('is_active', true).eq('is_admin', true).contains('telegram_categorias', ['resumo_diario'])
    .order('id', { ascending: true }), 'assinantes do resumo');
  return [...new Set(rows.map((r) => r.org_id as string).filter(Boolean))];
}

/** Contagens de promoções do resumo. NÃO usa os leitores de `depsAlertas` (sem paginação / `.limit(500)`):
 *  `prejuizo` = count dos mesmos filtros de `lerParticipandoNoPrejuizo` restrito (`!inner`) a promoções
 *  da org nos filtros de `lerPromocoes` — o `porId.get` de `selecionarAlertas`; `prazo` = `selecionarAlertas`. */
export async function contarPromocoesDoResumo(
  admin: SupabaseClient, orgId: string, agoraMs: number,
): Promise<{ prejuizo: number; prazo: number }> {
  const [contagem, promos] = await Promise.all([
    admin.from('ml_promocao_itens').select('ml_item_id, ml_promocoes!inner(status)', { count: 'exact', head: true })
      .eq('org_id', orgId).in('status', ['started', 'pending']).eq('pior_semaforo', 'vermelho')
      .in('ml_promocoes.status', ['pending', 'started']),
    paginas(() => admin.from('ml_promocoes').select('promocao_id, nome, status, prazo_adesao, contagem')
      .eq('org_id', orgId).in('status', ['pending', 'started']).order('promocao_id', { ascending: true }), 'promoções'),
  ]);
  if (contagem.error) throw new Error(`promoções no prejuízo: ${contagem.error.message}`);
  return {
    prejuizo: contagem.count ?? 0,
    prazo: selecionarAlertas(promos as unknown as PromoAlerta[], [], agoraMs).prazo.length,
  };
}

/** Piso (`variacoes.preco`) por código; duplicata de re-importação → a mais recente (como montarMapasCusto). */
async function lerPisos(admin: SupabaseClient, orgId: string, codigos: string[]): Promise<Map<string, number>> {
  const piso = new Map<string, number>();
  for (const lote of lotes(codigos)) {
    const rows = await paginas(() => admin.from('variacoes').select('codigo, preco')
      .eq('org_id', orgId).in('codigo', lote)
      .order('atualizado_em', { ascending: true }).order('id', { ascending: true }), 'piso das variações');
    for (const r of rows) {
      const p = Number(r.preco);
      if (r.preco != null && Number.isFinite(p)) piso.set(r.codigo as string, p);
    }
  }
  return piso;
}

/** Títulos (distintos, até 5) das vendas cujo alerta `frete_subiu` saiu no dia. */
async function lerFreteSubiu(admin: SupabaseClient, orgId: string, dia: string): Promise<string[]> {
  const j = janelaDia(dia);
  const avisos = await paginas(() => admin.from('ml_notificacoes_enviadas').select('chave')
    .eq('org_id', orgId).eq('entidade', 'frete_subiu').gte('enviado_em', j.desde).lt('enviado_em', j.ate)
    .order('enviado_em', { ascending: true }).order('chave', { ascending: true }), 'avisos de frete');
  const ids = [...new Set(avisos.map((a) => Number(a.chave)).filter(Number.isSafeInteger))];
  const titulos = new Map<number, string[]>();
  for (const lote of lotes(ids)) {
    const { data, error } = await admin.from('ml_vendas').select('order_id, itens:ml_vendas_itens(titulo)')
      .eq('org_id', orgId).in('order_id', lote);
    if (error) throw new Error(`vendas do frete: ${error.message}`);
    for (const v of (data ?? []) as Array<{ order_id: number; itens: { titulo: string | null }[] | null }>) {
      titulos.set(Number(v.order_id), (v.itens ?? []).map((i) => i.titulo).filter((t): t is string => !!t));
    }
  }
  // na ordem dos avisos (enviado_em), sem repetir título
  return [...new Set(ids.flatMap((id) => titulos.get(id) ?? []))].slice(0, MAX_FRETE);
}

export async function montarDadosResumo(admin: SupabaseClient, orgId: string, dia: string, agora: Date): Promise<DadosResumo> {
  const db = admin as unknown as MetricsDb;
  const ontem = janelaDia(dia);
  const jm = janelasMesFechado(dia);
  const [kOntem, kMes, kAnterior, ctx, vendas, devs, freteSubiu, comPromocoes] = await Promise.all([
    lerKpis(admin, orgId, ontem), lerKpis(admin, orgId, jm.mes), lerKpis(admin, orgId, jm.anterior),
    carregarContexto(db, orgId, ontem.desde), lerVendasJanela(db, orgId, ontem),
    lerDevolucoesDoResumo(admin, orgId, ontem), lerFreteSubiu(admin, orgId, dia),
    exigirModulo(admin, orgId, 'promocoes'),
  ]);
  const itens = resultadoPorItem(vendas, ctx);
  const codigos = [...new Set(itens.map((it) => it.codigo).filter((c): c is string => !!c))];
  const [pisos, promocoes] = await Promise.all([
    lerPisos(admin, orgId, codigos),
    comPromocoes ? contarPromocoesDoResumo(admin, orgId, agora.getTime()) : null,
  ]);
  return {
    dia, ontem: kOntem, lucroOntem: lucroDoPeriodo(itens, ctx.configOk), mes: kMes, anterior: kAnterior,
    rotuloMes: jm.rotuloMes, rotuloAnterior: jm.rotuloAnterior,
    top: topPorLucro(itens, 3),
    atencao: contarAtencao(itens, pisos),
    devolucoes: {
      estornado: estornadoNoPeriodo(devs, ontem),
      prazoProximo: abertasComPrazoAte(devs, new Date(agora.getTime() + PRAZO_DEVOLUCAO_MS).toISOString()),
    },
    promocoes,
    freteSubiu,
    apuradoAte: horaBrt(agora),
  };
}

export interface JobResumo { orgId?: string; dia?: string }

/** Disparo (sem `orgId`): um job por org com `dia = ontem` fixado agora — retry tardio resume o mesmo dia.
 *  Job da org: monta e notifica com `chave 'resumo_diario:<dia>'` (idempotente por usuário/chat). */
export async function processarJobResumo(
  admin: SupabaseClient, job: JobResumo, agora: Date,
): Promise<{ publicados: number } | { enviados: number }> {
  if (!job.orgId) {
    const dia = diaBrt(new Date(agora.getTime() - DIA_MS));
    const orgs = await orgsDoResumo(admin);
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/resumo-diario`;
    await enfileirarEmBlocos(orgs, (orgId) => ({
      url, body: { orgId, dia }, retries: 3, deduplicationId: `resumo-diario-${orgId}-${dia}`,
    }), (msgs) => qstashClient().batchJSON(msgs));
    return { publicados: orgs.length };
  }
  const dia = job.dia!;
  const texto = montarResumoDiario(await montarDadosResumo(admin, job.orgId, dia, agora));
  return { enviados: await notificarCategoria(admin, job.orgId, 'resumo_diario', texto, { chave: `resumo_diario:${dia}` }) };
}

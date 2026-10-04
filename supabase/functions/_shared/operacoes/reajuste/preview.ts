// I5 — preview do reajuste no servidor (spec 2026-10-04: C1, C4, C5, D7, D10). Só leitura: monta os itens do
// rascunho; quem grava (ou não, se executaveis = 0) é a edge (Task 7).
import { pool } from '../../concorrencia/pool.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import { calcularAlvo, centavos, maxDuasCasas, reais, semAlteracao } from './alvo.ts';
import { motivoInelegivel } from './elegibilidade.ts';
import type { ClienteReajusteML } from './ml.ts';
import type { Ajuste, Avaliacao, EntradaRestauracao, EstadoVariacao } from './tipos.ts';

export interface PedidoPreview { familias: string[]; ml_item_ids: string[]; ajuste: Ajuste | null; precos?: Record<string, number>; origem_id?: string | null }
export interface AlvoExpandido { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; variacoes_ml_esperadas: string[] | null;
  sku: string | null; titulo: string | null; ehKit: boolean; temAtacado: boolean; promocaoBanco: boolean; familiaPublicando: boolean; migracaoPxv: boolean }
export interface ItemPreview { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; titulo: string | null; sku: string | null;
  preco_anterior: number; preco: number; avaliacao: Avaliacao | null; restaurar: EntradaRestauracao[] | null; variacoes_ml: string[] | null;
  situacao: 'elegivel' | 'fora' | 'sem_alteracao'; motivo: string | null; incluido: boolean; aviso: string | null }
// `restaurar` é o ÚNICO formato de estado: gravado na coluna `estado_anterior` (Task 7), lido pelo executor e enviado à RPC.
export interface DepsPreview {
  expandir(familias: string[], mlItemIds: string[]): Promise<AlvoExpandido[]>;
  /** Uma linha POR id pedido (plano/UP: `[]` → a variação única); sem casamento → `variacao_id: null`. Nunca omitir linhas. */
  variacoesDoMlb(codigoPai: string, mlItem: string, mlVariationIds: string[]): Promise<{ ml_variation_id: string; variacao_id: string | null }[]>;
  estadoVariacoes(variacaoIds: string[]): Promise<Map<string, EstadoVariacao>>;
  ml: ClienteReajusteML;
  avaliar(mlItemId: string, preco: number): Promise<Avaliacao>;
  /** Itens `aplicado` da origem; `restaurar` = o `estado_anterior` gravado nela (esperado = antes, novo = gravado). */
  origem(origemId: string): Promise<Map<string, Origem> | null>;
}

export const MAX_MLBS = 500;
const PARALELISMO = 5;
const SEM_CASAMENTO = 'Não foi possível casar todas as variações do anúncio com o cadastro';
const AVISO_AMARELO = '🟡 Abaixo do piso em alguma cor';
const AVISO_D10 = 'Reverter: o preço restaurado volta a divergir do banco/ML se já divergia; cores com marca desligada voltam a ser recalculadas no re-ingest.';

export type Origem = { codigo_pai: string; preco_anterior: number; preco: number; restaurar: EntradaRestauracao[] };
const mesmoEstado = (a: EstadoVariacao, b: EstadoVariacao) =>
  a.preco_editado_pelo_operador === b.preco_editado_pelo_operador &&
  (a.preco_publicacao === null || b.preco_publicacao === null
    ? a.preco_publicacao === b.preco_publicacao
    : centavos(a.preco_publicacao) === centavos(b.preco_publicacao));

export async function montarPreview(
  p: PedidoPreview, deps: DepsPreview,
): Promise<{ ok: true; itens: ItemPreview[]; executaveis: number } | { ok: false; erro: string }> {
  let origem: Map<string, Origem> | null = null;
  let alvos: AlvoExpandido[];
  if (p.origem_id) {
    // Reverter ignora ajuste/precos: o alvo é o preço anterior da origem.
    origem = await deps.origem(p.origem_id);
    if (!origem) return { ok: false, erro: 'Operação de origem não encontrada' };
    alvos = origem.size ? await deps.expandir([], [...origem.keys()]) : [];
  } else {
    const valores = [...(p.ajuste ? [p.ajuste.valor] : []), ...Object.values(p.precos ?? {})];
    if (!valores.every(maxDuasCasas)) return { ok: false, erro: 'Use no máximo 2 casas decimais' };
    if (p.ajuste && p.ajuste.valor < 0) return { ok: false, erro: 'Ajuste inválido' };
    alvos = await deps.expandir(p.familias, p.ml_item_ids);
  }
  // Dedup por MLB; flags de bloqueio somadas por OU (conservador: qualquer linha bloqueando bloqueia o MLB).
  const porMl = new Map<string, AlvoExpandido>();
  for (const a of alvos) {
    const b = porMl.get(a.ml_item_id);
    porMl.set(a.ml_item_id, !b ? a : {
      ...b, ehKit: b.ehKit || a.ehKit, temAtacado: b.temAtacado || a.temAtacado, promocaoBanco: b.promocaoBanco || a.promocaoBanco,
      familiaPublicando: b.familiaPublicando || a.familiaPublicando, migracaoPxv: b.migracaoPxv || a.migracaoPxv,
    });
  }
  const unicos = [...porMl.values()];
  if (unicos.length > MAX_MLBS) {
    return { ok: false, erro: `No máximo ${MAX_MLBS} anúncios por operação (a seleção expandiu para ${unicos.length}).` };
  }
  const itens = await pool(PARALELISMO, unicos, (a) => avaliarItem(a, p, deps, origem?.get(a.ml_item_id) ?? null));
  // Reverter: item da origem que sumiu do cadastro aparece como não revertível, não some em silêncio.
  for (const ml of origem?.keys() ?? []) {
    if (unicos.some((a) => a.ml_item_id === ml)) continue;
    const o = origem!.get(ml)!;
    itens.push({
      ml_item_id: ml, codigo_pai: o.codigo_pai, variacao_ids: [], titulo: null, sku: null, preco_anterior: o.preco, preco: o.preco_anterior,
      avaliacao: null, restaurar: null, variacoes_ml: null, situacao: 'fora', motivo: 'Anúncio não encontrado no cadastro', incluido: false, aviso: null,
    });
  }
  return { ok: true, itens, executaveis: itens.filter((i) => i.situacao === 'elegivel').length };
}

async function avaliarItem(a: AlvoExpandido, p: PedidoPreview, deps: DepsPreview, orig: Origem | null): Promise<ItemPreview> {
  const ml = a.ml_item_id;
  const item: ItemPreview = {
    ml_item_id: ml, codigo_pai: a.codigo_pai, variacao_ids: [], titulo: a.titulo, sku: a.sku, preco_anterior: 0, preco: 0,
    avaliacao: null, restaurar: null, variacoes_ml: null, situacao: 'fora', motivo: null, incluido: false, aviso: null,
  };
  const fora = (motivo: string): ItemPreview => ({ ...item, motivo });

  let vivo;
  try {
    vivo = await deps.ml.lerVivo(ml);
  } catch (e) {
    if (e instanceof SemAcessoStatusML) throw e; // conta sem acesso: o operador precisa reconectar, não 500 linhas "fora"
    return fora('Não foi possível ler o anúncio — tente de novo');
  }
  const precos = vivo.variacoes ? vivo.variacoes.map((v) => v.preco) : [vivo.preco];
  const base = precos[0];
  // ponytail: < 0,01 também barra o que `centavos` não representa (notação exponencial).
  if (base === null || !(base >= 0.01) || !Number.isFinite(base)) return fora('Não foi possível ler o anúncio — tente de novo');
  item.preco_anterior = item.preco = reais(centavos(base));
  item.variacoes_ml = vivo.variacoes ? vivo.variacoes.map((v) => v.id) : null;
  if (!precos.every((x) => x !== null && x >= 0.01 && Number.isFinite(x) && centavos(x) === centavos(base))) {
    return fora('Variações com preços diferentes no ML');
  }
  if (orig && centavos(base) !== centavos(orig.preco)) return fora('Não revertível: o preço mudou depois do reajuste');

  const motivo = motivoInelegivel({
    vivo, ehKit: a.ehKit, temAtacado: a.temAtacado, promocaoBanco: a.promocaoBanco,
    promocaoML: await deps.ml.participaPromocaoML(ml), familiaPublicando: a.familiaPublicando, migracaoPxv: a.migracaoPxv,
  });
  if (motivo) return fora(motivo);

  // Variações casadas pelo vivo. Reverter: o conjunto tem de ser exatamente o do restaurar da origem
  // (cor que entrou/saiu depois receberia o preço antigo sem ser restaurada no banco).
  const casadas = await deps.variacoesDoMlb(a.codigo_pai, ml, item.variacoes_ml ?? []);
  const semCasar = !casadas.length || casadas.some((c) => !c.variacao_id);
  let ids = [...new Set(casadas.map((c) => c.variacao_id as string))].sort();
  if (orig) {
    const daOrigem = [...new Set(orig.restaurar.map((r) => r.variacao_id))].sort();
    if (semCasar || ids.join('\u0000') !== daOrigem.join('\u0000')) {
      return fora('Não revertível: as variações do anúncio mudaram depois do reajuste');
    }
    ids = orig.restaurar.map((r) => r.variacao_id);
  } else if (semCasar) return fora(SEM_CASAMENTO);
  const estados = await deps.estadoVariacoes(ids);
  if (ids.some((id) => !estados.has(id))) return fora(SEM_CASAMENTO);
  item.variacao_ids = ids;

  let alvo: number | null;
  if (orig) {
    if (orig.restaurar.some((r) => !mesmoEstado(estados.get(r.variacao_id)!, r.novo))) {
      return fora('Não revertível: o preço foi editado depois do reajuste');
    }
    alvo = orig.preco_anterior;
  } else {
    const editado = p.precos?.[ml];
    alvo = editado !== undefined ? (editado > 0 ? reais(centavos(editado)) : null) : p.ajuste ? calcularAlvo(base, p.ajuste) : null;
  }
  if (alvo === null) return fora('Preço resultante inválido');
  item.preco = alvo;
  if (semAlteracao(base, alvo)) return { ...item, situacao: 'sem_alteracao' };

  const avaliacao = await deps.avaliar(ml, alvo);
  const avisos = [avaliacao.pior === 'amarelo' ? AVISO_AMARELO : null, orig ? AVISO_D10 : null].filter(Boolean);
  return {
    ...item, situacao: 'elegivel', avaliacao,
    restaurar: orig
      ? orig.restaurar.map((r) => ({ variacao_id: r.variacao_id, esperado: r.novo, novo: r.esperado }))
      : ids.map((id) => ({ variacao_id: id, esperado: estados.get(id)!, novo: { preco_publicacao: alvo, preco_editado_pelo_operador: true } })),
    incluido: !(avaliacao.tem_vermelho || avaliacao.tem_sem_dado), // D7: 🔴/⚪ entram desmarcados
    aviso: avisos.length ? avisos.join(' ') : null,
  };
}

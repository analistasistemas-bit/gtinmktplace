// I5 — preview do reajuste no servidor (spec 2026-10-04: C1, C4, C5, D7, D10). Só leitura: monta os itens do
// rascunho; quem grava (ou não, se executaveis = 0) é a edge (Task 7).
import type { FaixaAtacado } from '../../canais/contrato.ts';
import { pool } from '../../concorrencia/pool.ts';
import { mensagemDe } from '../laco.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import { calcularAlvo, centavos, maxDuasCasas, reais, semAlteracao } from './alvo.ts';
import { avaliarPassos, resumirPrecos } from './avaliacao.ts';
import { motivoInelegivel, motivoTravaOferta } from './elegibilidade.ts';
import { decidirFaixas, mesmaConfig, mesmasFaixas, MSG_ATACADO_ENTRE_CORES, MSG_ATACADO_ENTRE_LOTES, MSG_ATACADO_MUDOU, MSG_ATACADO_POR_COR, type ConfigMlb } from './faixas.ts';
import type { ClienteReajusteML } from './ml.ts';
import { unirOfertas } from './ofertas.ts';
import { ehFaixas, planejarPassos } from './passos.ts';
import type { Ajuste, Avaliacao, EntradaRestauracao, EstadoVariacao, FaixaPreco, OfertaVigente, Passo, PrecoAvaliado } from './tipos.ts';

export interface PedidoPreview { familias: string[]; ml_item_ids: string[]; ajuste: Ajuste | null; precos?: Record<string, number>;
  /** Novo % por família: vale para todos os MLBs dela. */
  atacado?: Record<string, FaixaAtacado[]>; origem_id?: string | null }
/** Entrada de `operacoes_massa.atacado_familias`. `esperado`: `familias.atacado` no preview, para o compare-and-set. */
export interface EntradaAtacado { familia_id: string; novo: FaixaAtacado[] | null; esperado: FaixaAtacado[] | null; status: 'pendente' | 'aplicado' | 'nao_aplicado'; motivo: string | null }
/** `porCor` e `lotesDivergentes` olham todas as linhas do produto. Lote sem configuração não diverge. */
export interface FamiliaAtacado { codigo_pai: string; atacado: FaixaAtacado[] | null; porCor: boolean; lotesDivergentes: boolean }
export interface AlvoExpandido { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; variacoes_ml_esperadas: string[] | null;
  sku: string | null; titulo: string | null; ehKit: boolean; familiaPublicando: boolean; migracaoPxv: boolean }
export interface ItemPreview { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; titulo: string | null; sku: string | null;
  preco_anterior: number; preco: number;
  /** Agregado de `precos_avaliados`. */
  avaliacao: Avaliacao | null; precos_avaliados: PrecoAvaliado[] | null; restaurar: EntradaRestauracao[] | null; variacoes_ml: string[] | null;
  situacao: 'elegivel' | 'fora' | 'sem_alteracao'; motivo: string | null; incluido: boolean; aviso: string | null;
  ofertas: OfertaVigente[] | null; passos: Passo[] | null;
  /** Faixas vivas; `faixas_alvo` null = não mudam. */
  faixas_anteriores: FaixaPreco[] | null; faixas_alvo: FaixaPreco[] | null }
// `restaurar` é o ÚNICO formato de estado: gravado na coluna `estado_anterior` (Task 7), lido pelo executor e enviado à RPC.
export interface DepsPreview {
  expandir(familias: string[], mlItemIds: string[]): Promise<AlvoExpandido[]>;
  /** Uma linha POR id pedido (plano/UP: `[]` → a variação única); sem casamento → `variacao_id: null`. Nunca omitir linhas. */
  variacoesDoMlb(codigoPai: string, mlItem: string, mlVariationIds: string[]): Promise<{ ml_variation_id: string; variacao_id: string | null }[]>;
  estadoVariacoes(variacaoIds: string[]): Promise<Map<string, EstadoVariacao>>;
  ml: ClienteReajusteML;
  avaliar(mlItemId: string, preco: number): Promise<Avaliacao>;
  /** Itens `aplicado` da origem; `restaurar` = o `estado_anterior` gravado nela (esperado = antes, novo = gravado). `passos` vazio = origem anterior ao ADR-0196. */
  origem(origemId: string): Promise<Map<string, Origem> | null>;
  /** Ofertas por MLB pedido segundo a Central e as escritas recentes do app; todo id pedido vem na resposta. */
  ofertasBanco(mlItemIds: string[]): Promise<Map<string, OfertaVigente[]>>;
  /** Configuração de atacado das variações casadas do MLB. */
  configAtacado(variacaoIds: string[]): Promise<ConfigMlb>;
  /** Todo id pedido vem na resposta. */
  familiasAtacado(familiaIds: string[]): Promise<Map<string, FamiliaAtacado>>;
  /** Edições de atacado da origem. */
  origemAtacado(origemId: string): Promise<EntradaAtacado[]>;
}

export const MAX_MLBS = 500;
const PARALELISMO = 5;
const SEM_CASAMENTO = 'Não foi possível casar todas as variações do anúncio com o cadastro';
const AVISO_AMARELO = '🟡 Abaixo do piso em alguma cor';
const AVISO_FAIXA = 'Atacado: o alerta considera o lucro por unidade.';
const AVISO_IRMAO = 'Atacado da família: neste anúncio mudam só as faixas.';
const AVISO_D10 = 'Reverter: o preço restaurado volta a divergir do banco/ML se já divergia; cores com marca desligada voltam a ser recalculadas no re-ingest.';

/** Edição de atacado que alcança um produto. `grava` false: Reverter de origem `nao_aplicado`, só confere a família. */
type Edicao = { familia_id: string; novo: FaixaAtacado[] | null; esperado: FaixaAtacado[] | null; porCor: boolean; lotesDivergentes: boolean; grava: boolean };
export type Origem = { codigo_pai: string; preco_anterior: number; preco: number; restaurar: EntradaRestauracao[]; passos: Passo[] };
const mesmoEstado = (a: EstadoVariacao, b: EstadoVariacao) =>
  a.preco_editado_pelo_operador === b.preco_editado_pelo_operador &&
  (a.preco_publicacao === null || b.preco_publicacao === null
    ? a.preco_publicacao === b.preco_publicacao
    : centavos(a.preco_publicacao) === centavos(b.preco_publicacao));

export async function montarPreview(
  p: PedidoPreview, deps: DepsPreview,
): Promise<{ ok: true; itens: ItemPreview[]; executaveis: number; atacado_familias: EntradaAtacado[] } | { ok: false; erro: string }> {
  let origem: Map<string, Origem> | null = null;
  let alvos: AlvoExpandido[];
  let pedidas: Edicao[];
  if (p.origem_id) {
    // Reverter ignora ajuste/precos: o alvo é o preço anterior da origem.
    origem = await deps.origem(p.origem_id);
    if (!origem) return { ok: false, erro: 'Operação de origem não encontrada' };
    alvos = origem.size ? await deps.expandir([], [...origem.keys()]) : [];
    const entradas = await deps.origemAtacado(p.origem_id);
    if (entradas.some((e) => e.status === 'pendente')) return { ok: false, erro: 'A operação de origem ainda está em andamento' };
    // `aplicado` troca os lados; `nao_aplicado` não mudou a família e só as faixas aplicadas voltam.
    pedidas = entradas.map((e) => (e.status === 'aplicado'
      ? { familia_id: e.familia_id, novo: e.esperado, esperado: e.novo, porCor: false, lotesDivergentes: false, grava: true }
      : { familia_id: e.familia_id, novo: null, esperado: e.esperado, porCor: false, lotesDivergentes: false, grava: false }));
  } else {
    const descontos = Object.values(p.atacado ?? {}).flat().map((f) => f.desconto_pct);
    const valores = [...(p.ajuste ? [p.ajuste.valor] : []), ...Object.values(p.precos ?? {}), ...descontos];
    if (!valores.every(maxDuasCasas)) return { ok: false, erro: 'Use no máximo 2 casas decimais' };
    if (p.ajuste && p.ajuste.valor < 0) return { ok: false, erro: 'Ajuste inválido' };
    alvos = p.familias.length || p.ml_item_ids.length ? await deps.expandir(p.familias, p.ml_item_ids) : [];
    pedidas = Object.entries(p.atacado ?? {}).map(([familia_id, novo]) => ({ familia_id, novo, esperado: null, porCor: false, lotesDivergentes: false, grava: true }));
  }

  // Por codigo_pai: é a identidade do item na reserva e na conclusão.
  const edicoes = new Map<string, Edicao>();
  const familias = pedidas.length ? await deps.familiasAtacado(pedidas.map((e) => e.familia_id)) : new Map<string, FamiliaAtacado>();
  for (const e of pedidas) {
    const f = familias.get(e.familia_id)!;
    if (edicoes.has(f.codigo_pai)) return { ok: false, erro: 'Edite o atacado de uma família por produto' };
    edicoes.set(f.codigo_pai, { ...e, esperado: p.origem_id ? e.esperado : f.atacado, porCor: f.porCor, lotesDivergentes: f.lotesDivergentes });
  }
  const selecionados = new Set(alvos.map((a) => a.ml_item_id));
  if (!p.origem_id && pedidas.length) alvos = [...alvos, ...await deps.expandir(pedidas.map((e) => e.familia_id), [])];
  for (const pai of edicoes.keys()) {
    if (!p.origem_id && !alvos.some((a) => a.codigo_pai === pai)) return { ok: false, erro: 'Família sem anúncio publicado' };
  }

  // Dedup por MLB; flags de bloqueio somadas por OU (conservador: qualquer linha bloqueando bloqueia o MLB).
  const porMl = new Map<string, AlvoExpandido>();
  for (const a of alvos) {
    const b = porMl.get(a.ml_item_id);
    porMl.set(a.ml_item_id, !b ? a : {
      ...b, ehKit: b.ehKit || a.ehKit,
      familiaPublicando: b.familiaPublicando || a.familiaPublicando, migracaoPxv: b.migracaoPxv || a.migracaoPxv,
    });
  }
  const unicos = [...porMl.values()];
  if (unicos.length > MAX_MLBS) {
    return { ok: false, erro: `No máximo ${MAX_MLBS} anúncios por operação (a seleção expandiu para ${unicos.length}).` };
  }
  const banco = await deps.ofertasBanco(unicos.map((a) => a.ml_item_id));
  const itens = await pool(PARALELISMO, unicos, (a) => avaliarItem(
    a, p, deps, origem?.get(a.ml_item_id) ?? null, banco.get(a.ml_item_id) ?? null, edicoes.get(a.codigo_pai) ?? null, selecionados.has(a.ml_item_id),
  ));
  // Reverter: item da origem que sumiu do cadastro aparece como não revertível, não some em silêncio.
  for (const ml of origem?.keys() ?? []) {
    if (unicos.some((a) => a.ml_item_id === ml)) continue;
    const o = origem!.get(ml)!;
    itens.push({
      ml_item_id: ml, codigo_pai: o.codigo_pai, variacao_ids: [], titulo: null, sku: null, preco_anterior: o.preco, preco: o.preco_anterior,
      avaliacao: null, precos_avaliados: null, restaurar: null, variacoes_ml: null, situacao: 'fora', motivo: 'Anúncio não encontrado no cadastro', incluido: false, aviso: null, ofertas: null, passos: null,
      faixas_anteriores: null, faixas_alvo: null,
    });
  }
  // A família é a unidade: um MLB fora recusa todos, sem rascunho parcial.
  const atacado_familias: EntradaAtacado[] = [];
  for (const [pai, e] of edicoes) {
    if (!e.grava) continue;
    const doPai = itens.filter((i) => i.codigo_pai === pai);
    const ruim = doPai.find((i) => i.situacao === 'fora');
    if (!ruim) {
      atacado_familias.push({ familia_id: e.familia_id, novo: e.novo, esperado: e.esperado, status: 'pendente', motivo: null });
      continue;
    }
    for (const i of doPai) {
      if (i.situacao === 'fora') continue;
      Object.assign(i, {
        situacao: 'fora', motivo: `Atacado da família recusado — ${ruim.ml_item_id}: ${ruim.motivo}`, incluido: false, aviso: null,
        avaliacao: null, precos_avaliados: null, restaurar: null, passos: null, faixas_alvo: null,
      });
    }
  }
  return { ok: true, itens, executaveis: itens.filter((i) => i.situacao === 'elegivel').length, atacado_familias };
}

async function avaliarItem(
  a: AlvoExpandido, p: PedidoPreview, deps: DepsPreview, orig: Origem | null, doBanco: OfertaVigente[] | null,
  ed: Edicao | null, selecionado: boolean,
): Promise<ItemPreview> {
  const ml = a.ml_item_id;
  const item: ItemPreview = {
    ml_item_id: ml, codigo_pai: a.codigo_pai, variacao_ids: [], titulo: a.titulo, sku: a.sku, preco_anterior: 0, preco: 0,
    avaliacao: null, precos_avaliados: null, restaurar: null, variacoes_ml: null, situacao: 'fora', motivo: null, incluido: false, aviso: null, ofertas: null, passos: null,
    faixas_anteriores: null, faixas_alvo: null,
  };
  const fora = (motivo: string): ItemPreview => ({ ...item, motivo });
  if (ed?.grava && (ed.porCor || ed.lotesDivergentes)) return fora(orig ? MSG_ATACADO_MUDOU : ed.porCor ? MSG_ATACADO_POR_COR : MSG_ATACADO_ENTRE_LOTES);
  // Reverter não redefine a configuração: desfaz o que a origem deixou.
  const editando = !!ed && !orig;
  const irmao = editando && !selecionado;
  // Faixa que a origem não confirmou não mudou: nada a desfazer.
  const faixasOrigem = orig?.passos.filter(ehFaixas).find((x) => x.estado === 'confirmado');
  // Só faixas não tocou preço nem marca: não há o que comparar em `restaurar`.
  const soFaixas = !!orig?.passos.length && !orig.passos.some((x) => x.tipo === 'base');

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

  const ofertas = item.ofertas = unirOfertas([await deps.ml.lerOfertas(ml), doBanco]);
  const motivo = motivoInelegivel({
    vivo, ehKit: a.ehKit, ofertas, familiaPublicando: a.familiaPublicando, migracaoPxv: a.migracaoPxv,
  });
  if (motivo) return fora(motivo);

  // Variações casadas pelo vivo. Reverter: o conjunto tem de ser exatamente o do restaurar da origem
  // (cor que entrou/saiu depois receberia o preço antigo sem ser restaurada no banco).
  const casadas = await deps.variacoesDoMlb(a.codigo_pai, ml, item.variacoes_ml ?? []);
  const semCasar = !casadas.length || casadas.some((c) => !c.variacao_id);
  let ids = [...new Set(casadas.map((c) => c.variacao_id as string))].sort();
  if (orig && !soFaixas) {
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
    if (!soFaixas && orig.restaurar.some((r) => !mesmoEstado(estados.get(r.variacao_id)!, r.novo))) {
      return fora('Não revertível: o preço foi editado depois do reajuste');
    }
    alvo = orig.preco_anterior;
  } else {
    const editado = p.precos?.[ml];
    alvo = editado !== undefined ? (editado > 0 ? reais(centavos(editado)) : null)
      : p.ajuste && !irmao ? calcularAlvo(base, p.ajuste) : editando ? item.preco_anterior : null;
  }
  if (alvo === null) return fora('Preço resultante inválido');
  item.preco = alvo;
  if (semAlteracao(base, alvo) && !faixasOrigem && !editando) return { ...item, situacao: 'sem_alteracao' };

  // Leituras fora do try abaixo: conta sem acesso sobe, não vira motivo do item.
  const vivas = item.faixas_anteriores = await deps.ml.lerFaixas(ml);
  if (vivas === null) return fora('Não foi possível ler o atacado — tente de novo');
  // Reverter não recalcula as faixas: volta às que a origem trocou, ou só não deixa o base restaurado passar por elas.
  const config = orig && !faixasOrigem && !ed ? null : await deps.configAtacado(ids);
  if (ed && (config!.divergente || config!.porCor || !mesmaConfig(config!.faixas, ed.esperado))) {
    return fora(orig ? MSG_ATACADO_MUDOU : config!.porCor ? MSG_ATACADO_POR_COR : config!.divergente ? MSG_ATACADO_ENTRE_CORES : MSG_ATACADO_ENTRE_LOTES);
  }
  // Com edição na origem vale a entrada: a config do passo é a de antes dela.
  if (faixasOrigem && (!mesmasFaixas(vivas, faixasOrigem.alvo) || config!.divergente || (!ed && !mesmaConfig(config!.faixas, faixasOrigem.config)))) {
    return fora(MSG_ATACADO_MUDOU);
  }

  let passos: Passo[];
  let faixas_alvo: FaixaPreco[] | null;
  try {
    const trava = motivoTravaOferta(alvo, ofertas!);
    if (trava) return fora(trava);
    if (faixasOrigem) faixas_alvo = faixasOrigem.anterior;
    else {
      const decisao = decidirFaixas(alvo, vivas, editando ? { faixas: ed!.novo, divergente: false } : orig ? null : config, editando);
      if (decisao.acao === 'fora') return fora(decisao.motivo);
      faixas_alvo = decisao.faixas_alvo;
    }
    passos = planejarPassos({
      base, alvo, ofertas: ofertas!, ofertasNovas: {}, sair: [], faixasAntes: vivas, faixasAlvo: faixas_alvo, faixasConfig: config?.faixas ?? null,
      faixasFamilia: ed?.familia_id, conferirConfig: !!orig && !!ed,
    });
  } catch (e) {
    return fora(mensagemDe(e));
  }

  const precos_avaliados = await avaliarPassos(passos, (preco) => deps.avaliar(ml, preco));
  const avaliacao = resumirPrecos(precos_avaliados);
  const faixaEmAlerta = precos_avaliados.some((x) => x.tipo === 'faixa' && x.avaliacao.pior !== 'verde');
  const avisos = [avaliacao.pior === 'amarelo' ? AVISO_AMARELO : null, faixaEmAlerta ? AVISO_FAIXA : null, orig && !soFaixas ? AVISO_D10 : null, irmao ? AVISO_IRMAO : null].filter(Boolean);
  return {
    ...item, situacao: 'elegivel', avaliacao, precos_avaliados, passos, faixas_alvo,
    // Sem passo de base o preço não muda: a marca do operador não pode ser fixada.
    restaurar: !passos.some((x) => x.tipo === 'base') ? [] : orig
      ? orig.restaurar.map((r) => ({ variacao_id: r.variacao_id, esperado: r.novo, novo: r.esperado }))
      : ids.map((id) => ({ variacao_id: id, esperado: estados.get(id)!, novo: { preco_publicacao: alvo, preco_editado_pelo_operador: true } })),
    incluido: !(avaliacao.tem_vermelho || avaliacao.tem_sem_dado), // D7: 🔴/⚪ entram desmarcados
    aviso: avisos.length ? avisos.join(' ') : null,
  };
}

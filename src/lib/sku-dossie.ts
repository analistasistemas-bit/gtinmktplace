// Dossiê do SKU (Vendas SKU, Fatia 2a): série temporal. Nenhuma conta própria de dinheiro —
// cada intervalo recorta as vendas por date_closed, agrupa em pedidos (mesmo rateio da aba Vendas)
// e reusa agregarPorSku/somarAcumuladores/metricas da Fatia 1.
import type { Venda } from './faturamento';
import type { Pedido } from './pedidos-faturamento';
import type { CatalogoSku } from './vendas-sku-catalogo';
import type { Intervalo } from './calendario-brt';
import {
  agregarPorSku, somarAcumuladores, metricas, dentroDaJanela, montarVendasSku, classificarTendencia, coberturaDias,
  alertasSku, SEM_CODIGO, type FonteCusto, type LinhaSku, type Tendencia, type Cobertura, type Alerta,
} from './vendas-sku';
import type { Janela } from './metricas';
import { orderIdsComDevolucaoReal, type Devolucao } from './devolucoes';
import type { Movimento, Moderacao, ItemCampanha, Pergunta } from './sku-dossie-dados';
import { round2, fmtBRL } from './formato';

export interface PontoSerie {
  intervalo: Intervalo;
  unidades: number;
  bruto: number;
  lucro: number | null;
  fonteCusto: FonteCusto;
  /** Média ponderada por quantidade dos itens faturáveis do SKU; null sem venda. */
  precoMedio: number | null;
  precoMin: number | null;
  precoMax: number | null;
}

export function serieDoSku(p: {
  vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; codigos: string[]; intervalos: Intervalo[];
  catalogo: Map<string, CatalogoSku>; ordensDevolvidas: Set<number>;
}): PontoSerie[] {
  const codigos = new Set(p.codigos);
  return p.intervalos.map((intervalo) => {
    const ini = Date.parse(intervalo.inicio);
    const fim = Date.parse(intervalo.fim);
    const vendasDoIv = p.vendas.filter((v) => {
      if (!v.date_closed) return false;
      const t = Date.parse(v.date_closed);
      return t >= ini && t < fim;
    });
    const pedidos = p.agrupar(vendasDoIv);
    const janela = { desde: intervalo.inicio, ate: new Date(fim - 1).toISOString() };
    const linhas = agregarPorSku(pedidos, janela, p.catalogo, p.ordensDevolvidas).filter((l) => codigos.has(l.codigo));
    const acc = somarAcumuladores(linhas.map((l) => l.acc));
    const m = metricas(acc);

    let qtd = 0; let valor = 0; let min: number | null = null; let max: number | null = null;
    for (const ped of pedidos) {
      if (!dentroDaJanela(ped.data, janela)) continue; // mesmo corte de agregarPorSku
      for (const it of ped.itens) {
        if (!it.faturavel || !codigos.has(it.codigo?.trim() || SEM_CODIGO)) continue;
        qtd += it.quantity;
        valor += it.unit_price * it.quantity;
        min = min == null ? it.unit_price : Math.min(min, it.unit_price);
        max = max == null ? it.unit_price : Math.max(max, it.unit_price);
      }
    }
    return {
      intervalo, unidades: acc.unidades, bruto: round2(acc.bruto), lucro: m.lucro, fonteCusto: m.fonteCusto,
      precoMedio: qtd > 0 ? round2(valor / qtd) : null, precoMin: min, precoMax: max,
    };
  });
}

// ---- Eventos com vínculo declarado ----

export type Vinculo = 'exato' | 'compartilhado' | 'nao_resolvido';

/** 1 código no MLB = exato; 2+ = compartilhado; MLB fora do mapa = não resolvido. */
export function vinculoDoMlb(mlb: string, mlbs: Map<string, string[]>): Vinculo {
  const codigos = mlbs.get(mlb);
  if (!codigos || codigos.length === 0) return 'nao_resolvido';
  return codigos.length === 1 ? 'exato' : 'compartilhado';
}

export type TipoEvento = 'entrada' | 'ruptura' | 'retorno_estoque' | 'moderacao_detectada'
  | 'moderacao_resolvida' | 'devolucao_aberta' | 'devolucao_estorno';

export interface Evento {
  id: string; tipo: TipoEvento; em: string; titulo: string; detalhe: string | null;
  vinculo: Vinculo | null; mlb: string | null;
}

/** Linha do tempo do SKU (ou da família). Movimentos e devoluções são do próprio código/order
 *  (`exato`); moderação herda o vínculo do MLB. Kit: os movimentos são os da base e o saldo do kit
 *  é floor(base/N). Dedupe pelo id do evento (a família junta os mesmos registros de vários códigos). */
export function montarEventos(p: {
  movimentos: Movimento[]; moderacoes: Moderacao[]; devolucoes: Devolucao[]; ordersDosCodigos: Set<number>;
  mlbs: Map<string, string[]>; kitMultiplicador: number | null;
}): Evento[] {
  const eventos = new Map<string, Evento>();
  const add = (e: Omit<Evento, 'vinculo' | 'mlb'> & Partial<Pick<Evento, 'vinculo' | 'mlb'>>) =>
    eventos.set(e.id, { vinculo: 'exato', mlb: null, ...e });
  const n = p.kitMultiplicador;
  const saldo = (s: number) => (n ? Math.floor(s / n) : s);

  for (const m of p.movimentos) {
    if (m.motivo === 'entrada') {
      const custo = m.custo_unitario != null ? ` a ${fmtBRL(m.custo_unitario)}` : ' (sem custo)';
      add({ id: `${m.id}:entrada`, tipo: 'entrada', em: m.criado_em,
        titulo: `Entrada registrada${n ? ' na base' : ''}: ${m.quantidade} un.${custo}`, detalhe: null });
    }
    if (m.estoque_anterior == null || m.estoque_resultante == null) continue; // sem saldo: ignora
    const antes = saldo(m.estoque_anterior);
    const depois = saldo(m.estoque_resultante);
    if (antes > 0 && depois === 0) {
      add({ id: `${m.id}:ruptura`, tipo: 'ruptura', em: m.criado_em, titulo: n ? 'Ruptura do kit' : 'Ruptura: estoque zerou', detalhe: null });
    } else if (antes === 0 && depois > 0) {
      add({ id: `${m.id}:retorno`, tipo: 'retorno_estoque', em: m.criado_em, titulo: `Estoque voltou: ${depois} ${n ? 'kits' : 'un.'}`, detalhe: null });
    }
  }

  for (const m of p.moderacoes) {
    const v = { vinculo: vinculoDoMlb(m.ml_item_id, p.mlbs), mlb: m.ml_item_id };
    add({ id: `${m.id}:detectada`, tipo: 'moderacao_detectada', em: m.detectado_em, titulo: 'Moderação detectada', detalhe: m.motivo, ...v });
    if (m.resolvido_em) add({ id: `${m.id}:resolvida`, tipo: 'moderacao_resolvida', em: m.resolvido_em, titulo: 'Resolução observada', detalhe: m.motivo, ...v });
  }

  for (const d of p.devolucoes) {
    if (d.type !== 'returns' || d.order_id == null || !p.ordersDosCodigos.has(d.order_id)) continue;
    const detalhe = `Motivo: ${d.reason_texto ?? d.reason_id ?? 'não informado'}`;
    if (d.aberto_em) add({ id: `${d.id}:abertura`, tipo: 'devolucao_aberta', em: d.aberto_em, titulo: 'Devolução aberta', detalhe });
    if (d.fechado_em) add({ id: `${d.id}:estorno`, tipo: 'devolucao_estorno', em: d.fechado_em,
      titulo: d.return_status_money === 'refunded' ? 'Devolução encerrada com estorno' : 'Devolução encerrada', detalhe });
  }

  return [...eventos.values()].sort((a, b) => Date.parse(a.em) - Date.parse(b.em) || a.id.localeCompare(b.id));
}

/** Contagem de perguntas por intervalo meio-aberto [inicio, fim). */
export function perguntasPorIntervalo(perguntas: { criada_em: string | null }[], intervalos: Intervalo[]): number[] {
  const ts = perguntas.flatMap((q) => (q.criada_em ? [Date.parse(q.criada_em)] : []));
  return intervalos.map((iv) => {
    const ini = Date.parse(iv.inicio); const fim = Date.parse(iv.fim);
    return ts.filter((t) => t >= ini && t < fim).length;
  });
}

/** Bruto dos itens faturáveis do SKU pela UF da order de cada item (nunca o bruto do pack). */
export function ufsDoSku(pedidos: Pedido[], codigos: string[]): { valores: Record<string, number>; semUf: number } {
  const cods = new Set(codigos);
  const valores: Record<string, number> = {};
  let semUf = 0;
  for (const ped of pedidos) for (const it of ped.itens) {
    if (!it.faturavel || !cods.has(it.codigo?.trim() || SEM_CODIGO)) continue;
    const v = it.unit_price * it.quantity;
    if (it.uf) valores[it.uf] = round2((valores[it.uf] ?? 0) + v);
    else semUf = round2(semUf + v);
  }
  return { valores, semUf };
}

export interface LinhaMix {
  codigo: string; titulo: string; unidades: number; participacaoUnidades: number;
  lucro: number | null; deltaLucro: number | null; semVendas: boolean;
}

/** Mix das irmãs: só a composição atual do catálogo (irmãs sem venda incluídas) — as linhas de
 *  outros produtos do mesmo pack e SEM_CODIGO ficam de fora, inclusive do total. Delta de lucro
 *  contra o período anterior; o lado sem venda conta 0 (a irmã que zerou mostra a queda). */
export function mixDaFamilia(linhas: LinhaSku[], anterior: LinhaSku[], catalogoFamilia: CatalogoSku[]): LinhaMix[] {
  const nomes = new Map(catalogoFamilia.map((c) => [c.codigo, c.nome]));
  const atual = new Map(linhas.filter((l) => nomes.has(l.codigo)).map((l) => [l.codigo, l]));
  const antes = new Map(anterior.filter((l) => nomes.has(l.codigo)).map((l) => [l.codigo, l]));
  let total = 0;
  for (const l of atual.values()) total += l.acc.unidades;
  return [...nomes.keys()].map((codigo) => {
    const l = atual.get(codigo);
    const a = antes.get(codigo);
    const unidades = l?.acc.unidades ?? 0;
    const lucro = l ? l.m.lucro : null;
    const lucroAgora = l ? l.m.lucro : 0;
    const lucroAntes = a ? a.m.lucro : 0;
    return {
      codigo, titulo: nomes.get(codigo) ?? l?.titulo ?? codigo, unidades,
      participacaoUnidades: total > 0 ? unidades / total : 0,
      lucro, deltaLucro: (l || a) && lucroAgora != null && lucroAntes != null ? round2(lucroAgora - lucroAntes) : null,
      semVendas: unidades === 0,
    };
  }).sort((a, b) => b.unidades - a.unidades || a.codigo.localeCompare(b.codigo));
}

/** Bloco "Situação atual nas campanhas": status + última sincronização, nunca data de adesão. */
export function situacaoCampanhas(itens: ItemCampanha[]) {
  return itens.map((i) => ({
    mlb: i.ml_item_id, nome: i.promocao?.nome ?? null, tipo: i.promocao?.tipo ?? null,
    statusItem: i.status, statusCampanha: i.promocao?.status ?? null, precoPromo: i.preco_promo,
    vigencia: { inicio: i.promocao?.inicio ?? null, fim: i.promocao?.fim ?? null }, sincronizadoEm: i.sincronizado_em,
  }));
}

// ---- Montagem do dossiê (o hook só busca e chama isto) ----

export type AlvoDossie = { tipo: 'sku'; codigo: string } | { tipo: 'familia'; codigoPai: string };
export type EstadoDossie = 'carregando' | 'erro' | 'nao_encontrado' | 'sem_vendas' | 'sem_cadastro' | 'ok';

export interface DossieSku {
  codigos: string[];
  titulo: string;
  /** Linhas do catálogo dos códigos; vazio em `sem_cadastro`. */
  catalogo: CatalogoSku[];
  historicoDesde: string | null;
  ultimaVenda: string | null;
  /** KPIs do período = linha do ranking (montarVendasSku); família numa chave só (pedidos por order). */
  linhaPeriodo: LinhaSku | null;
  linhaAnterior: LinhaSku | null;
  /** Posição de hoje (30 dias até agora); null sem venda nenhuma. */
  tendencia: Tendencia | null;
  cobertura: Cobertura;
  /** Kit: floor(base/N); família: soma; null = desconhecido (fora do catálogo), nunca zero. */
  estoque: number | null;
  alertas: Alerta[];
  serie: PontoSerie[];
  eventos: Evento[];
  perguntasPorIntervalo: number[];
  ufs: { valores: Record<string, number>; semUf: number };
  /** Só na família. */
  mix: LinhaMix[] | null;
  campanhas: ReturnType<typeof situacaoCampanhas>;
  mlbs: Map<string, string[]>;
  qualidade: { pctBrutoCustoReal: number | null; fontesParciais: string[] };
}

const extremo = (datas: (string | null | undefined)[], fim: 'min' | 'max'): string | null => {
  const ds = datas.filter((d): d is string => !!d).sort((a, b) => Date.parse(a) - Date.parse(b));
  return (fim === 'min' ? ds[0] : ds[ds.length - 1]) ?? null;
};

export function montarDossie(p: {
  alvo: AlvoDossie; codigos: string[]; vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[];
  catalogo: CatalogoSku[]; devolucoes: Devolucao[];
  janela: Janela; anterior: Janela; hoje: Janela; hojeAnterior: Janela; intervalos: Intervalo[];
  mlbs: Map<string, string[]>; movimentos: Movimento[]; moderacoes: Moderacao[]; perguntas: Pergunta[];
  campanhas: ItemCampanha[];
}): { estado: Exclude<EstadoDossie, 'carregando' | 'erro'>; dados: DossieSku | null } {
  const cods = new Set(p.codigos);
  const doAlvo = (codigo: string | null) => cods.has(codigo?.trim() || SEM_CODIGO);
  const catMap = new Map(p.catalogo.map((c) => [c.codigo, c]));
  const catalogo = p.codigos.flatMap((c) => catMap.get(c) ?? []);
  // Vendas (orders) que contêm o código — a RPC também traz os outros membros dos packs.
  const vendasDoAlvo = p.vendas.filter((v) => v.itens.some((it) => doAlvo(it.codigo)));
  if (!vendasDoAlvo.length && !catalogo.length) return { estado: 'nao_encontrado', dados: null };

  const familia = p.alvo.tipo === 'familia' ? p.alvo.codigoPai : null;
  const chave = familia != null ? `familia:${familia}` : p.codigos[0];
  // Família: os códigos viram uma chave só depois de agrupar — dinheiro igual à soma das irmãs,
  // mas pedidos e devoluções contam por order (a mesma order com 2 irmãs é 1 pedido).
  const agruparAlvo = familia == null ? p.agrupar : (vs: Venda[]) => p.agrupar(vs).map((ped) => ({
    ...ped, itens: ped.itens.map((it) => (doAlvo(it.codigo) ? { ...it, codigo: chave } : it)),
  }));
  const base = { vendas: p.vendas, catalogo: catMap, devolucoes: p.devolucoes, agrupar: agruparAlvo };
  const periodo = montarVendasSku({ ...base, janela: p.janela, anterior: p.anterior });
  const hoje = montarVendasSku({ ...base, janela: p.hoje, anterior: p.hojeAnterior });
  const daChave = (ls: LinhaSku[]) => ls.find((l) => l.codigo === chave) ?? null;

  const ehKit = catalogo.some((c) => c.ehKit);
  const estoque = catalogo.length ? catalogo.reduce((s, c) => s + (c.ehKit ? c.estoqueKit ?? 0 : c.estoque), 0) : null;
  const historicoDesde = extremo(catalogo.map((c) => c.primeiraVenda), 'min') ?? extremo(vendasDoAlvo.map((v) => v.date_closed), 'min');
  const ultimaVenda = extremo(catalogo.map((c) => c.ultimaVenda), 'max') ?? extremo(vendasDoAlvo.map((v) => v.date_closed), 'max');
  const titulo = familia != null
    ? catalogo[0]?.nomeFamilia ?? familia
    : catalogo[0]?.nome ?? vendasDoAlvo.flatMap((v) => v.itens).find((it) => doAlvo(it.codigo))?.titulo ?? p.codigos[0];
  const vestir = (l: LinhaSku | null): LinhaSku | null => (l && familia != null
    ? { ...l, titulo, codigoPai: familia, nomeFamilia: catalogo[0]?.nomeFamilia ?? null, ehKit, estoque, primeiraVenda: historicoDesde }
    : l);

  const u30 = daChave(hoje.linhas)?.acc.unidades ?? 0;
  const uAnt = daChave(hoje.linhasAnterior)?.acc.unidades ?? 0;
  const tendencia = vendasDoAlvo.length ? classificarTendencia(u30, uAnt, historicoDesde, Date.parse(p.hoje.ate)) : null;
  const cobertura = coberturaDias(estoque, u30, ehKit);
  const linhaPeriodo = vestir(daChave(periodo.linhas));

  const devolvidas = orderIdsComDevolucaoReal(p.devolucoes);
  // ponytail: % com custo real sobre todo o histórico carregado (bloco "Qualidade do histórico"),
  // agrupado de uma vez — só indicador de cobertura, não entra em KPI nenhum.
  const hist = daChave(agregarPorSku(agruparAlvo(p.vendas), { desde: new Date(0).toISOString(), ate: p.hoje.ate }, catMap, devolvidas));
  const kitsN = new Set(catalogo.map((c) => c.kitMultiplicador));
  const fontesParciais = ['Promoções: só a situação atual', 'Publicação: só vínculos registrados'];
  if (vendasDoAlvo.some((v) => v.kit_item_id != null)) fontesParciais.push('Kit Virtual: sem histórico antes de set/2026');
  const mixRaw = familia == null ? null : montarVendasSku({ ...base, agrupar: p.agrupar, janela: p.janela, anterior: p.anterior });

  const dados: DossieSku = {
    codigos: p.codigos, titulo, catalogo, historicoDesde, ultimaVenda,
    linhaPeriodo, linhaAnterior: vestir(daChave(periodo.linhasAnterior)),
    tendencia, cobertura, estoque,
    alertas: linhaPeriodo ? alertasSku(linhaPeriodo, cobertura) : [],
    serie: serieDoSku({ vendas: p.vendas, agrupar: p.agrupar, codigos: p.codigos, intervalos: p.intervalos, catalogo: catMap, ordensDevolvidas: devolvidas }),
    eventos: montarEventos({
      movimentos: p.movimentos, moderacoes: p.moderacoes, devolucoes: p.devolucoes, mlbs: p.mlbs,
      ordersDosCodigos: new Set(vendasDoAlvo.map((v) => v.order_id)),
      // ponytail: um N só; família de kits com N diferentes mostra o saldo da base sem dividir.
      kitMultiplicador: kitsN.size === 1 ? [...kitsN][0] : null,
    }),
    perguntasPorIntervalo: perguntasPorIntervalo(p.perguntas, p.intervalos),
    ufs: ufsDoSku(p.agrupar(p.vendas.filter((v) => dentroDaJanela(v.date_closed, p.janela))), p.codigos),
    mix: mixRaw ? mixDaFamilia(mixRaw.linhas, mixRaw.linhasAnterior, catalogo) : null,
    campanhas: situacaoCampanhas(p.campanhas),
    mlbs: p.mlbs,
    qualidade: { pctBrutoCustoReal: hist && hist.acc.bruto > 0 ? hist.acc.brutoCustoReal / hist.acc.bruto : null, fontesParciais },
  };
  return { estado: !vendasDoAlvo.length ? 'sem_vendas' : !catalogo.length ? 'sem_cadastro' : 'ok', dados };
}

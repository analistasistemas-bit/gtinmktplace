// Visão por PEDIDO do menu Faturamento (ADR-0039): agrupa os order_id por pack (pack_id ?? order_id)
// numa única linha — um carrinho do cliente vira um pedido, e os produtos vão para o detalhe.
// Reaproveita o rateio de frete (ratearLiquidoPorFrete) e o custo (CustoResolver). Pura e testável.
import type { Venda, VendaItem } from './faturamento';
import { ehFaturavel, ratearLiquidoPorFrete, impostoDoItem, type CustoResolver, type PesoResolver, type AliquotaResolver } from './resumo-vendas';
import type { FotoResolver } from './fotos-produto';
import type { CorResolver } from './cor-produto';
import { calcularMarkup } from './markup';
import { labelStatusEnvio } from './ml-status';
import { statusLiberacao } from './status-liberacao';
import { round2, fmtBRLSemSimbolo } from './formato';

export interface ItemPedido {
  id: string;
  ml_item_id: string | null;
  titulo: string | null;
  codigo: string | null;
  cor: string | null;
  ean: string | null;
  quantity: number;
  unit_price: number;
  /** Storage path da foto do produto (bucket `imagens`). null = sem foto cadastrada. */
  imagem_path: string | null;
  /** Custo total do item (custo unitário × qtd), em R$. null = sem custo cadastrado. */
  custo: number | null;
  /** Líquido atribuído ao item (rateio por valor bruto do item), já líquido do imposto — mesma base do markup (ADR-0055). */
  liquido: number;
  /** Imposto do item = valor de venda × alíquota(origem). 0 sem origem/alíquota (ADR-0055). */
  imposto: number;
  /** Alíquota (%) que gerou o imposto, direto do resolver (8/16 — ADR-0055). null sem origem/alíquota.
   *  Existe para a UI exibir o % SEM reconstruí-lo de `imposto`, que é arredondado a centavos. */
  aliquotaPct: number | null;
  /** (líquido − custo) ÷ custo, com líquido já líquido do imposto. null sem custo. */
  markup: number | null;
}

export interface Pedido {
  /** Chave do pedido: String(pack_id ?? order_id). */
  chave: string;
  /** Verdadeiro quando agrupa >1 order_id do mesmo pack. */
  isPack: boolean;
  orderIds: number[];
  /** IDs das linhas ml_vendas agrupadas neste pedido. */
  vendaIds: string[];
  data: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
  comprador_nome: string | null;
  /** Status de pagamento representativo do grupo (do membro mais antigo). Num pack misto ele NÃO
   *  decide se o pedido conta: use `faturavel`. */
  status: string;
  /** Algum membro é faturável (ADR-0038). false = pedido totalmente cancelado/devolvido. */
  faturavel: boolean;
  statusDetail: string | null;
  shipping_status: string | null;
  /** Substatus do envio (desmembra ready_to_ship: aguardando NF / a caminho). */
  shipping_substatus: string | null;
  /** UF do destinatário do envio (coluna ml_vendas.uf, sem prefixo "BR-"). */
  uf: string | null;
  /** Cidade do destinatário do envio (coluna ml_vendas.cidade). */
  cidade: string | null;
  /** Soma das quantidades dos itens. */
  unidades: number;
  /** Valor do checkout: soma de total_amount dos orders do pedido, faturáveis ou não. */
  bruto: number;
  /** Bruto que conta como faturamento (ADR-0038): só os membros `paid/partially_refunded/refunded`.
   *  Difere de `bruto` quando o pack mistura orders canceladas com pagas, e é 0 no pedido totalmente
   *  cancelado/devolvido — é ele, não `bruto`, que fecha com o líquido e com os KPIs. */
  brutoFaturavel: number;
  /** Frete do envio (uma vez por pack). null = sem frete. */
  frete: number | null;
  /** Líquido do pedido (soma do líquido rateado dos membros), já líquido do imposto — mesma base do markup (ADR-0055). Use `retidoDoPedido` para o retido real do ML (sem imposto). */
  liquido: number;
  /** money_release_date — quando o ML libera o recebimento (representativo do grupo). null = MP não informou. */
  money_release_date: string | null;
  /** Há venda ainda não sacada sem money_release_date no grupo. */
  temMembrosSemDataLiberacao: boolean;
  /** Quando todas as vendas do pedido foram marcadas como sacadas. null se nenhuma/parte não sacada. */
  sacado_em: string | null;
  /** Usuário da primeira marcação de saque do grupo, quando o pedido inteiro está sacado. */
  sacado_por: string | null;
  /** Total estornado no pedido (Σ estorno dos membros), em R$. */
  estorno: number;
  /** Custo total dos produtos do pedido. null = nenhum item com custo. */
  custo: number | null;
  /** Imposto total do pedido (Σ imposto dos itens), em R$ (ADR-0055). */
  imposto: number;
  markup: number | null;
  comissao: number;
  rastreio: string | null;
  is_publiai: boolean;
  tem_devolucao: boolean;
  itens: ItemPedido[];
}

/** Custo total (R$) de um item: custo unitário × qtd. null se sem custo. */
function custoDoItem(it: VendaItem, resolver?: CustoResolver): number | null {
  const unit = resolver?.(it) ?? null;
  return unit != null && unit > 0 ? round2(unit * it.quantity) : null;
}

/**
 * Agrupa as vendas (linhas de ml_vendas, 1 por order_id) em PEDIDOS por `pack_id ?? order_id`.
 * Totais por pedido: bruto = Σ total_amount; líquido = Σ líquido rateado; frete = max (uma vez);
 * custo = Σ custo dos itens. Markup do pedido = (líquido − custo) ÷ custo. Por item, o líquido é
 * rateado pelo valor bruto do item e o markup recalculado. Ordena do mais recente ao mais antigo.
 */
export function agruparPorPedido(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
  fotoResolver?: FotoResolver, aliquotaResolver?: AliquotaResolver,
  corResolver?: CorResolver,
): Pedido[] {
  const rateio = ratearLiquidoPorFrete(vendas, pesoResolver);
  // Venda cancelada não gera líquido (ADR-0038: só faturável entra nos KPIs monetários). Sem essa
  // trava, o líquido cru (ratearLiquidoPorFrete pula não-faturáveis) duplicava o frete de pack e o
  // markup do pedido/item ficava absurdamente negativo em vez de "—".
  const liquidoMembro = (v: Venda) => (ehFaturavel(v.status) ? rateio.get(v.id)?.liquido ?? v.liquido ?? 0 : 0);

  const grupos = new Map<string, Venda[]>();
  for (const v of vendas) {
    const chave = String(v.pack_id ?? v.order_id);
    const g = grupos.get(chave);
    if (g) g.push(v); else grupos.set(chave, [v]);
  }

  const pedidos: Pedido[] = [];
  for (const [chave, membros] of grupos) {
    membros.sort((a, b) => a.order_id - b.order_id);
    const bruto = round2(membros.reduce((s, v) => s + v.total_amount, 0));
    const brutoFaturavel = round2(
      membros.reduce((s, v) => s + (ehFaturavel(v.status) ? v.total_amount : 0), 0),
    );
    const liquido = round2(membros.reduce((s, v) => s + liquidoMembro(v), 0));
    const freteMax = Math.max(0, ...membros.map((v) => v.frete_vendedor ?? 0));
    const frete = freteMax > 0 ? round2(freteMax) : null;
    const comissao = round2(membros.reduce((s, v) => s + v.sale_fee_total, 0));

    const itensFlat = membros.flatMap((v) => {
      const faturavel = ehFaturavel(v.status);
      // A UF vem da venda, não do pedido: um pack pode agrupar order_ids, e o imposto é resolvido
      // por venda (ADR-0112).
      return v.itens.map((it) => ({ it, faturavel, uf: v.uf }));
    });
    const unidades = itensFlat.reduce((s, { it }) => s + it.quantity, 0);
    // Base do rateio: só o valor dos itens faturáveis — um item cancelado não "rouba" fatia do
    // líquido (que também só soma membros faturáveis; ver liquidoMembro acima).
    const valorItensFaturaveis = itensFlat
      .filter(({ faturavel }) => faturavel)
      .reduce((s, { it }) => s + it.unit_price * it.quantity, 0);

    let custoTotal = 0;
    let temCusto = false;
    let impostoTotal = 0;
    const itens: ItemPedido[] = itensFlat.map(({ it, faturavel, uf }) => {
      const custo = custoDoItem(it, custoResolver);
      if (faturavel && custo != null) { custoTotal += custo; temCusto = true; }
      const imposto = faturavel ? impostoDoItem(it, aliquotaResolver, uf) : 0;
      const aliquotaPct = imposto > 0 ? aliquotaResolver?.(it, uf) ?? null : null;
      impostoTotal += imposto;
      const valorItem = it.unit_price * it.quantity;
      const liqItem = faturavel && valorItensFaturaveis > 0
        ? round2((liquido * valorItem) / valorItensFaturaveis)
        : 0;
      const liqItemComImposto = round2(liqItem - imposto);
      const markup = faturavel && custo != null && custo > 0
        ? calcularMarkup(liqItemComImposto, custo).markup
        : null;
      return {
        id: it.id, ml_item_id: it.ml_item_id, titulo: it.titulo, codigo: it.codigo,
        // Item plano (filho User Products, família de 1 variação) vende sem variação, então o ML
        // não manda `variation_attributes` e `it.cor` vem nula — resolve pelo catálogo.
        cor: it.cor ?? corResolver?.(it) ?? null,
        ean: it.ean, quantity: it.quantity, unit_price: it.unit_price,
        imagem_path: fotoResolver?.(it) ?? null,
        custo, liquido: liqItemComImposto, imposto, aliquotaPct, markup,
      };
    });
    const custo = temCusto ? round2(custoTotal) : null;
    const imposto = round2(impostoTotal);
    const liquidoComImposto = round2(liquido - imposto);
    const markup = custo != null && custo > 0 ? calcularMarkup(liquidoComImposto, custo).markup : null;

    const primeiro = membros[0];
    const grupoSacado = membros.every((v) => v.sacado_em != null);
    const pendentes = membros.filter((v) => v.sacado_em == null);
    const baseLiberacao = grupoSacado ? membros : pendentes;
    const datasLiberacaoPendentes = baseLiberacao
      .map((v) => v.money_release_date)
      .filter((data): data is string => data != null);
    const money_release_date = datasLiberacaoPendentes.length > 0
      ? datasLiberacaoPendentes.reduce((maisRecente, data) => (
        Date.parse(data) > Date.parse(maisRecente) ? data : maisRecente
      ))
      : null;
    const temMembrosSemDataLiberacao = pendentes.some((v) => v.money_release_date == null);
    const sacado_em = grupoSacado ? membros[0].sacado_em : null;
    const sacado_por = grupoSacado ? membros[0].sacado_por : null;
    pedidos.push({
      chave,
      isPack: primeiro.pack_id != null && membros.length > 1,
      orderIds: membros.map((v) => v.order_id),
      vendaIds: membros.map((v) => v.id),
      data: primeiro.date_closed ?? primeiro.date_created,
      comprador_id: primeiro.comprador_id ?? null,
      comprador_nick: primeiro.comprador_nick,
      comprador_nome: primeiro.comprador_nome ?? null,
      status: primeiro.status,
      faturavel: membros.some((v) => ehFaturavel(v.status)),
      statusDetail: primeiro.status_detail,
      shipping_status: primeiro.shipping_status,
      shipping_substatus: primeiro.shipping_substatus,
      money_release_date,
      temMembrosSemDataLiberacao,
      sacado_em,
      sacado_por,
      estorno: round2(membros.reduce((s, v) => s + (v.estorno ?? 0), 0)),
      unidades, bruto, brutoFaturavel, frete, liquido: liquidoComImposto, custo, imposto, markup, comissao,
      rastreio: primeiro.tracking_number,
      uf: primeiro.uf ?? null,
      cidade: primeiro.cidade ?? null,
      is_publiai: membros.some((v) => v.is_publiai),
      tem_devolucao: membros.some((v) => v.tem_devolucao),
      itens,
    });
  }
  pedidos.sort((a, b) => Date.parse(b.data ?? '') - Date.parse(a.data ?? ''));
  return pedidos;
}

/** Retido real do ML (comissão + frete) de um pedido: bruto faturável − líquido − imposto — já que
 *  `liquido` aqui é líquido do imposto (ADR-0055), diferente do dinheiro que efetivamente sai na
 *  venda. A base é `brutoFaturavel` e não `bruto` porque o líquido só soma membros faturáveis: com o
 *  bruto cheio, um pedido devolvido apareceria com o ML retendo 100% — mas o dinheiro voltou ao
 *  comprador (estorno), e a conta dá 0 naturalmente. */
export function retidoDoPedido(p: Pick<Pedido, 'brutoFaturavel' | 'liquido' | 'imposto'>): number {
  return round2(p.brutoFaturavel - p.liquido - p.imposto);
}

/** Motivo de o pedido ficar fora dos totais monetários, para a tela e o PDF marcarem a linha.
 *  null = pedido com alguma venda faturável (inclusive pack misto, que conta a parte paga). */
export function rotuloNaoFaturavel(p: Pick<Pedido, 'faturavel' | 'tem_devolucao'>): string | null {
  if (p.faturavel) return null;
  return p.tem_devolucao ? 'devolvido' : 'cancelado';
}

export type FiltroFinanceiro = 'todos' | 'liberado' | 'aliberar' | 'sacado' | 'devolvidos';

/**
 * Pedidos visíveis no Detalhe do líquido. Esta tela é de RECEBIMENTO: pedido sem dinheiro a
 * receber (cancelado/devolvido) fica fora por padrão e só aparece no filtro `devolvidos` — o que
 * não está na lista não pode ser selecionado nem marcado como sacado (ADR-0038).
 *
 * Pack misto conta como faturável: ainda há a parte paga para receber.
 */
export function filtrarPedidosFinanceiro(
  pedidos: Pedido[], filtro: FiltroFinanceiro, agoraMs: number = Date.now(),
): Pedido[] {
  return pedidos.filter((p) => {
    if (filtro === 'devolvidos') return !p.faturavel;
    if (!p.faturavel) return false;
    if (filtro === 'todos') return true;
    return statusLiberacao({
      money_release_date: p.money_release_date,
      sacado_em: p.sacado_em,
      temMembrosSemDataLiberacao: p.temMembrosSemDataLiberacao,
    }, agoraMs) === filtro;
  });
}

export interface TotaisFinanceiro {
  bruto: number;
  retido: number;
  /** Líquido SEM descontar imposto (bate com o Mercado Pago), como a tela exibe. */
  liquido: number;
  /** Markup líquido de imposto (ADR-0055). null sem custo. */
  markup: number | null;
}

/** Totais do rodapé do Detalhe Financeiro sobre os pedidos visíveis. Conta só o que é faturável
 *  (ADR-0038), igual ao banner de KPIs — sem isso uma devolução somava o bruto dela no rodapé e os
 *  dois números da mesma tela divergiam. Não precisa descartar o pedido: as parcelas não faturáveis
 *  já entram zeradas (`brutoFaturavel`/`liquido`/`custo`), então o pack misto contribui com a parte
 *  paga em vez de sumir inteiro. */
export function totaisFinanceiro(pedidos: Pedido[]): TotaisFinanceiro {
  let bruto = 0, retido = 0, liquido = 0, liqMk = 0, cstMk = 0;
  for (const p of pedidos) {
    bruto += p.brutoFaturavel;
    retido += retidoDoPedido(p);
    liquido += p.liquido + p.imposto;
    if (p.custo != null && p.custo > 0) { liqMk += p.liquido; cstMk += p.custo; }
  }
  return {
    bruto: round2(bruto),
    retido: round2(retido),
    liquido: round2(liquido),
    markup: cstMk > 0 ? calcularMarkup(liqMk, cstMk).markup : null,
  };
}

export interface KpisPedidos {
  /** Nº de pedidos faturáveis (packs contam 1). */
  pedidos: number;
  unidades: number;
  /** Faturamento bruto das vendas faturáveis no período. */
  bruto: number;
  /** Soma do líquido exibido nos pedidos faturáveis. */
  liquido: number;
  /** Bruto ÷ pedidos. */
  ticket: number;
  /** Unidades ÷ pedidos. */
  itensPorPedido: number;
  /** Markup agregado: (Σ líquido com custo − Σ custo) ÷ Σ custo. null sem custo. */
  markup: number | null;
  compradoresUnicos: number;
  /** % dos pedidos feitos por compradores com >1 pedido no período. */
  pctRecompra: number;
  /** Contagem de pedidos por status de envio (TODOS os pedidos, indep. de pagamento). */
  porStatusEnvio: Record<string, number>;
}

/** Agrega KPIs operacionais a partir dos pedidos. Monetários só sobre faturáveis (ADR-0038). */
export function calcularKpisPedidos(pedidos: Pedido[]): KpisPedidos {
  let bruto = 0, liquido = 0, unidades = 0, faturaveis = 0, liqComCusto = 0, custoTotal = 0;
  const porStatusEnvio: Record<string, number> = {};
  const pedidosPorComprador = new Map<number, number>();

  for (const p of pedidos) {
    const st = labelStatusEnvio(p.shipping_status, p.shipping_substatus).label;
    porStatusEnvio[st] = (porStatusEnvio[st] ?? 0) + 1;
    // `p.faturavel` e não `ehFaturavel(p.status)`: o status é o do membro mais antigo, então um pack
    // com a order mais antiga cancelada e outra paga sumiria dos KPIs junto com a venda boa.
    if (!p.faturavel) continue;
    faturaveis += 1;
    bruto += p.brutoFaturavel;
    liquido += p.liquido;
    unidades += p.unidades;
    if (p.custo != null && p.custo > 0) { liqComCusto += p.liquido; custoTotal += p.custo; }
    if (p.comprador_id != null) {
      pedidosPorComprador.set(p.comprador_id, (pedidosPorComprador.get(p.comprador_id) ?? 0) + 1);
    }
  }

  const compradoresUnicos = pedidosPorComprador.size;
  let pedidosRecorrentes = 0;
  for (const n of pedidosPorComprador.values()) if (n > 1) pedidosRecorrentes += n;
  const pctRecompra = faturaveis > 0 ? round2((pedidosRecorrentes / faturaveis) * 100) : 0;

  return {
    pedidos: faturaveis,
    unidades,
    bruto: round2(bruto),
    liquido: round2(liquido),
    ticket: faturaveis > 0 ? round2(bruto / faturaveis) : 0,
    itensPorPedido: faturaveis > 0 ? round2(unidades / faturaveis) : 0,
    markup: custoTotal > 0 ? (liqComCusto - custoTotal) / custoTotal : null,
    compradoresUnicos,
    pctRecompra,
    porStatusEnvio,
  };
}

const PREPOSICOES_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Padroniza uma palavra para "Primeira Maiúscula" (resto minúsculo), respeitando acentos. */
function capitalizarNome(palavra: string): string {
  if (!palavra) return palavra;
  return palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * Encurta o nome do comprador para "primeiro + segundo nome", pulando preposições
 * (de/da/do/das/dos/e) na escolha do segundo. Ex.: "Maria de Fatima Braga" → "Maria Fatima";
 * "Patricia Neves Moreira Leite" → "Patricia Neves". Padroniza o casing para Primeira Maiúscula
 * ("PATRICIA C" → "Patricia C"; "sueli gonzaga" → "Sueli Gonzaga"). null/vazio → null.
 */
export function nomeCurtoComprador(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return null;
  const primeiro = capitalizarNome(partes[0]);
  const segundoRaw = partes.slice(1).find((p) => !PREPOSICOES_NOME.has(p.toLowerCase()));
  const segundo = segundoRaw ? capitalizarNome(segundoRaw) : undefined;
  return segundo ? `${primeiro} ${segundo}` : primeiro;
}

export function nomeExibicaoComprador(p: Pick<Pedido, 'comprador_nome' | 'comprador_nick'>): string {
  return p.comprador_nome ?? p.comprador_nick ?? '—';
}

/** Busca livre (aba Vendas): casa comprador, produto (título/código), nº do pedido e valores. */
export function pedidoCasaBusca(p: Pedido, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const campos = [
    nomeExibicaoComprador(p),
    p.chave,
    ...p.orderIds.map(String),
    fmtBRLSemSimbolo(p.bruto),
    fmtBRLSemSimbolo(p.liquido),
    ...p.itens.flatMap((it) => [it.titulo, it.codigo, it.ean]),
  ];
  return campos.some((c) => c?.toLowerCase().includes(q));
}

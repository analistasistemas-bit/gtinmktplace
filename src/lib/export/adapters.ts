import { fmtBRL, fmtInt } from '@/lib/formato';
import { fmtDataCurta, labelStatusPedido, labelStatusEnvio } from '@/lib/ml-status';
import { rotuloTipo, type PublicadoItem, type FiltroPublicados } from '@/lib/publicados';
import { calcularResumoPublicados } from '@/lib/resumo-publicados';
import type { Periodo } from '@/lib/metricas';
import type { ResumoViabilidade } from '@/lib/analise-viabilidade';
import type { Pedido, KpisPedidos } from '@/lib/pedidos-faturamento';
import type { Devolucao } from '@/lib/devolucoes';
import { labelTipoDevolucao } from '@/lib/devolucoes';
import type { Pergunta } from '@/lib/perguntas';
import type { GeografiaVendas } from '@/lib/geografia-vendas';
import type { ResumoVendas, PontoSerie } from '@/lib/resumo-vendas';
import type { ReportData, ExportConfig, Coluna, Kpi, BlocoResumo } from './tipos';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtMarkupNum(m: number | null | undefined): string {
  if (m == null) return '—';
  const pct = Math.round(m * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** Rótulo legível do período para o cabeçalho do relatório. */
export function rotuloPeriodo(p: Periodo): string {
  return p.tipo === 'preset' ? `Últimos ${p.dias} dias` : `${fmtData(p.desde)} – ${fmtData(p.ate)}`;
}

const DIR = 'right' as const;

// ---------------------------------------------------------------------------
// Publicados
// ---------------------------------------------------------------------------

const COLS_PUBLICADOS: Coluna[] = [
  { chave: 'titulo', titulo: 'Título' },
  { chave: 'codigo', titulo: 'Código' },
  { chave: 'fornecedor', titulo: 'Fornecedor' },
  { chave: 'tipo', titulo: 'Tipo' },
  { chave: 'precoPub', titulo: 'Preço publicado', alinhamento: DIR },
  { chave: 'estoque', titulo: 'Estoque atual', alinhamento: DIR },
  { chave: 'precoAtual', titulo: 'Preço atual', alinhamento: DIR },
  { chave: 'unidades', titulo: 'Unid. vendidas', alinhamento: DIR },
  { chave: 'valorVendido', titulo: 'Valor vendido', alinhamento: DIR },
  { chave: 'status', titulo: 'Status' },
  { chave: 'publicadoEm', titulo: 'Publicado em' },
];

const COLS_VIABILIDADE: Coluna[] = [
  { chave: 'precoPub', titulo: 'Preço publicação', alinhamento: DIR },
  { chave: 'custo', titulo: 'Custo', alinhamento: DIR },
  { chave: 'markup', titulo: 'Markup s/ custo', alinhamento: DIR },
  { chave: 'vendedores', titulo: 'Concorrentes', alinhamento: DIR },
  { chave: 'menorConc', titulo: 'Menor preço conc.', alinhamento: DIR },
  { chave: 'mercado', titulo: 'Faixa de mercado' },
];

const STATUS_LABEL_PUB: Record<string, string> = {
  ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado',
  moderado: 'Moderado', inativo: 'Inativo', indisponivel: 'Indisponível',
};

interface PublicadosArgs {
  /** Itens exibidos (filtrados/ordenados) — viram as linhas da tabela. */
  itens: PublicadoItem[];
  /** TODOS os itens publicados — base de Saúde/Encalhados/Top, igual à tela. */
  todosItens: PublicadoItem[];
  totais: { faturamento: number; unidades: number; pedidos: number };
  /** Líquido recebido no período (banner "você recebe" na tela). */
  liquido: number;
  markupPct: number | null;
  lucro: number;
  filtro: FiltroPublicados;
  periodo: Periodo;
  config: ExportConfig;
  /** familiaId → resumo de viabilidade (só quando expandido; prefetch na página). */
  viabilidades?: Map<string, ResumoViabilidade>;
}

function filtrosPublicados(f: FiltroPublicados): string[] {
  const out: string[] = [];
  if (f.busca) out.push(`Busca: "${f.busca}"`);
  if (f.fornecedor) out.push(`Fornecedor: ${f.fornecedor}`);
  if (f.status) out.push(`Status: ${STATUS_LABEL_PUB[f.status] ?? f.status}`);
  if (f.tipo) out.push(`Tipo: ${f.tipo}`);
  if (f.somenteEncalhados) out.push('Somente encalhados');
  return out;
}

export function buildPublicadosReport(args: PublicadosArgs): ReportData {
  const { itens, todosItens, totais, liquido, markupPct, lucro, filtro, periodo, config, viabilidades } = args;
  // KPIs idênticos ao DashboardPublicados: Markup/Lucro só existem quando há custo cadastrado.
  const ticket = totais.pedidos > 0 ? totais.faturamento / totais.pedidos : 0;
  const temCusto = markupPct != null;
  // Saúde/Encalhados/Top usam a base completa (todosItens), como na tela.
  const saude = calcularResumoPublicados(todosItens);
  const kpis: Kpi[] = [];
  // Banner "Líquido das vendas (você recebe)": só aparece com pedidos no período (igual à tela).
  if (totais.pedidos > 0) kpis.push({ label: 'Líquido das vendas (você recebe)', valor: fmtBRL(liquido) });
  kpis.push(
    { label: 'Faturamento', valor: fmtBRL(totais.faturamento) },
    { label: 'Unidades vendidas', valor: String(totais.unidades) },
    { label: 'Pedidos', valor: String(totais.pedidos) },
    { label: 'Ticket médio', valor: fmtBRL(ticket) },
  );
  if (temCusto) kpis.push({ label: 'Markup no período', valor: fmtMarkupNum(markupPct) });
  if (temCusto && lucro != null) kpis.push({ label: 'Lucro no período', valor: fmtBRL(lucro) });
  // Cards de saúde (espelham "Saúde dos anúncios" + "Encalhados" da tela).
  kpis.push(
    { label: 'Ativos', valor: `${saude.ativos}/${saude.total}` },
    { label: 'Com problema', valor: String(saude.comProblema) },
    { label: 'Encalhados (sem venda no período)', valor: String(saude.encalhados) },
  );
  // Bloco "Top produtos (faturamento)" — top 5, mesmo card da tela.
  const blocos: BlocoResumo[] = [];
  if (saude.topFat.length > 0) {
    blocos.push({
      titulo: 'Top produtos (faturamento)',
      itens: saude.topFat.map((i) => ({ label: i.titulo, valor: fmtBRL(i.valorVendido ?? 0) })),
    });
  }
  return {
    titulo: 'Publicados',
    periodo: rotuloPeriodo(periodo),
    filtros: filtrosPublicados(filtro),
    kpis: config.incluirKpis ? kpis : undefined,
    blocos: config.incluirKpis && blocos.length > 0 ? blocos : undefined,
    colunas: COLS_PUBLICADOS,
    linhas: itens.map((it) => {
      const via = config.expandido ? viabilidades?.get(it.familiaId) : undefined;
      return {
        celulas: {
          titulo: it.titulo,
          codigo: it.codigoPai,
          fornecedor: it.fornecedor ?? '—',
          tipo: rotuloTipo(it),
          precoPub: it.precoPublicacao > 0 ? fmtBRL(it.precoPublicacao) : '—',
          estoque: it.estoque ?? '—',
          precoAtual: it.precoAtual != null ? fmtBRL(it.precoAtual) : '—',
          unidades: it.unidadesVendidas ?? '—',
          valorVendido: it.valorVendido != null && it.valorVendido > 0 ? fmtBRL(it.valorVendido) : '—',
          status: STATUS_LABEL_PUB[it.status ?? 'indisponivel'] ?? '—',
          publicadoEm: fmtData(it.publicadoEm),
        },
        sublinhas: via
          ? {
              colunas: COLS_VIABILIDADE,
              linhas: [
                {
                  precoPub: fmtBRL(via.precoPublicacao),
                  custo: via.custo != null ? fmtBRL(via.custo) : '—',
                  markup: fmtMarkupNum(via.markup),
                  vendedores: via.concorrenciaVendedores,
                  menorConc: via.concorrenciaPrecoMin != null ? fmtBRL(via.concorrenciaPrecoMin) : '—',
                  mercado:
                    via.concorrenciaPrecoMin != null && via.mercadoMax != null
                      ? `${fmtBRL(via.concorrenciaPrecoMin)} – ${fmtBRL(via.mercadoMax)}`
                      : '—',
                },
              ],
            }
          : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Faturamento · Vendas
// ---------------------------------------------------------------------------

const COLS_VENDAS: Coluna[] = [
  { chave: 'data', titulo: 'Data' },
  { chave: 'comprador', titulo: 'Comprador' },
  // A tela mostra miniaturas dos produtos; no export, os códigos dos itens (texto equivalente).
  { chave: 'produtos', titulo: 'Produtos' },
  { chave: 'unidades', titulo: 'Un.', alinhamento: DIR },
  { chave: 'valor', titulo: 'Valor', alinhamento: DIR },
  { chave: 'liquido', titulo: 'Líquido', alinhamento: DIR },
  { chave: 'markup', titulo: 'Markup', alinhamento: DIR },
  { chave: 'pagamento', titulo: 'Pagamento' },
  { chave: 'envio', titulo: 'Envio' },
  { chave: 'origem', titulo: 'Origem' },
];

const COLS_ITENS_PEDIDO: Coluna[] = [
  { chave: 'item', titulo: 'Item' },
  { chave: 'cor', titulo: 'Cor' },
  { chave: 'codigo', titulo: 'Código' },
  { chave: 'ean', titulo: 'EAN' },
  { chave: 'qtd', titulo: 'Qtd', alinhamento: DIR },
  { chave: 'preco', titulo: 'Preço un.', alinhamento: DIR },
  { chave: 'custo', titulo: 'Custo', alinhamento: DIR },
  { chave: 'liquido', titulo: 'Líquido', alinhamento: DIR },
  { chave: 'markup', titulo: 'Markup', alinhamento: DIR },
];

const ORIGEM_LABEL: Record<string, string> = { todos: 'Todos', publiai: 'PubliAI', fora: 'Fora' };

interface VendasArgs {
  pedidos: Pedido[];
  kpis: KpisPedidos;
  periodo: Periodo;
  origem: string;
  filtroEnvio: string | null;
  config: ExportConfig;
}

export function buildVendasReport(args: VendasArgs): ReportData {
  const { pedidos, kpis, periodo, origem, filtroEnvio, config } = args;
  const filtros = [`Origem: ${ORIGEM_LABEL[origem] ?? origem}`];
  if (filtroEnvio) filtros.push(`Envio: ${filtroEnvio}`);
  return {
    titulo: 'Faturamento · Vendas',
    periodo: rotuloPeriodo(periodo),
    filtros,
    kpis: config.incluirKpis
      ? [
          { label: 'Faturamento', valor: fmtBRL(kpis.bruto) },
          { label: 'Pedidos', valor: fmtInt(kpis.pedidos) },
          { label: 'Unidades', valor: fmtInt(kpis.unidades) },
          { label: 'Ticket médio', valor: fmtBRL(kpis.ticket) },
          { label: 'Itens / pedido', valor: kpis.itensPorPedido.toFixed(1).replace('.', ',') },
          { label: 'Markup', valor: fmtMarkupNum(kpis.markup) },
          { label: 'Compradores', valor: fmtInt(kpis.compradoresUnicos) },
          { label: '% recompra', valor: `${kpis.pctRecompra.toFixed(1).replace('.', ',')}%` },
          // "Pedidos por status de envio" — mesma distribuição mostrada na tela.
          ...Object.entries(kpis.porStatusEnvio)
            .sort((a, b) => b[1] - a[1])
            .map(([status, n]) => ({ label: `Envio · ${status}`, valor: String(n) })),
        ]
      : undefined,
    colunas: COLS_VENDAS,
    linhas: pedidos.map((p) => ({
      celulas: {
        data: fmtDataCurta(p.data),
        comprador: p.comprador_nome ?? p.comprador_nick ?? '—',
        produtos: p.itens.map((it) => it.codigo ?? it.titulo ?? '?').join(', '),
        unidades: fmtInt(p.unidades),
        valor: fmtBRL(p.bruto),
        liquido: fmtBRL(p.liquido),
        markup: fmtMarkupNum(p.markup),
        pagamento: labelStatusPedido(p.status).label,
        envio: labelStatusEnvio(p.shipping_status, p.shipping_substatus).label,
        origem: p.is_publiai ? 'PubliAI' : 'Fora',
      },
      sublinhas: config.expandido
        ? {
            colunas: COLS_ITENS_PEDIDO,
            linhas: p.itens.map((it) => ({
              item: it.titulo ?? '—',
              cor: it.cor ?? '—',
              codigo: it.codigo ?? '—',
              ean: it.ean ?? '—',
              qtd: it.quantity,
              preco: fmtBRL(it.unit_price),
              custo: it.custo != null ? fmtBRL(it.custo) : '—',
              liquido: fmtBRL(it.liquido),
              markup: fmtMarkupNum(it.markup),
            })),
          }
        : undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Faturamento · Devoluções
// ---------------------------------------------------------------------------

const COLS_DEVOLUCOES: Coluna[] = [
  { chave: 'aberta', titulo: 'Aberta' },
  { chave: 'pedido', titulo: 'Pedido' },
  { chave: 'motivo', titulo: 'Motivo' },
  { chave: 'tipo', titulo: 'Tipo' },
  { chave: 'status', titulo: 'Status' },
  { chave: 'valor', titulo: 'Valor', alinhamento: DIR },
  { chave: 'acoes', titulo: 'Ações pendentes' },
];

// Mesmos rótulos de ação exibidos na aba Devoluções.
const ACAO_DEVOLUCAO_LABEL: Record<string, string> = {
  send_money_back: 'Devolver dinheiro',
  review_return: 'Revisar devolução',
  open_dispute: 'Abrir disputa',
  allow_return: 'Autorizar devolução',
  ship_product: 'Enviar produto',
};

export function buildDevolucoesReport(lista: Devolucao[]): ReportData {
  return {
    titulo: 'Faturamento · Devoluções',
    colunas: COLS_DEVOLUCOES,
    linhas: lista.map((d) => ({
      celulas: {
        aberta: fmtDataCurta(d.aberto_em),
        pedido: d.order_id ?? '—',
        motivo: d.reason_texto ?? '—',
        tipo: labelTipoDevolucao(d.type),
        status: d.status === 'opened' ? 'Aberta' : 'Fechada',
        valor: d.valor_em_jogo != null ? fmtBRL(d.valor_em_jogo) : '—',
        acoes: d.acoes_pendentes?.length
          ? d.acoes_pendentes.map((a) => ACAO_DEVOLUCAO_LABEL[a.action] ?? a.action.replace(/_/g, ' ')).join(', ')
          : '—',
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Faturamento · Perguntas
// ---------------------------------------------------------------------------

const COLS_PERGUNTAS: Coluna[] = [
  { chave: 'item', titulo: 'Item' },
  { chave: 'criada', titulo: 'Criada em' },
  { chave: 'pergunta', titulo: 'Pergunta' },
  { chave: 'status', titulo: 'Status' },
  { chave: 'resposta', titulo: 'Resposta' },
];

export function buildPerguntasReport(lista: Pergunta[]): ReportData {
  return {
    titulo: 'Faturamento · Perguntas',
    colunas: COLS_PERGUNTAS,
    linhas: lista.map((p) => ({
      celulas: {
        item: p.item_titulo ?? p.item_id ?? '—',
        criada: fmtDataCurta(p.criada_em),
        pergunta: p.texto,
        status: p.status !== 'UNANSWERED' ? 'Respondida' : 'Pendente',
        resposta: p.resposta ?? '—',
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Faturamento · Geografia (cidades aninhadas sob cada UF)
// ---------------------------------------------------------------------------

const COLS_GEO_UF: Coluna[] = [
  { chave: 'uf', titulo: 'UF' },
  { chave: 'pedidos', titulo: 'Pedidos', alinhamento: DIR },
  { chave: 'pct', titulo: '%', alinhamento: DIR },
  { chave: 'valor', titulo: 'Valor', alinhamento: DIR },
];

const COLS_GEO_CIDADE: Coluna[] = [
  { chave: 'cidade', titulo: 'Cidade' },
  { chave: 'pedidos', titulo: 'Pedidos', alinhamento: DIR },
  { chave: 'valor', titulo: 'Valor', alinhamento: DIR },
];

interface GeografiaArgs {
  geo: GeografiaVendas;
  periodo: Periodo;
  config: ExportConfig;
}

export function buildGeografiaReport(args: GeografiaArgs): ReportData {
  const { geo, periodo, config } = args;
  const topUf = geo.porUf[0];
  const kpis: Kpi[] = [
    { label: 'Estados atingidos', valor: fmtInt(geo.estadosAtingidos) },
    { label: 'Top estado', valor: topUf ? `${topUf.uf} · ${topUf.pctPedidos}% dos pedidos` : '—' },
    { label: 'Cidades', valor: fmtInt(geo.porCidade.length) },
  ];
  if (geo.semGeo > 0) kpis.push({ label: 'Sem localização', valor: fmtInt(geo.semGeo) });
  return {
    titulo: 'Faturamento · Geografia',
    periodo: rotuloPeriodo(periodo),
    kpis: config.incluirKpis ? kpis : undefined,
    colunas: COLS_GEO_UF,
    linhas: geo.porUf.map((u) => ({
      celulas: {
        uf: u.uf,
        pedidos: fmtInt(u.pedidos),
        pct: `${u.pctPedidos}%`,
        valor: fmtBRL(u.valor),
      },
      sublinhas: {
        colunas: COLS_GEO_CIDADE,
        linhas: geo.porCidade
          .filter((c) => c.uf === u.uf)
          .map((c) => ({ cidade: c.cidade, pedidos: fmtInt(c.pedidos), valor: fmtBRL(c.valor) })),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Financeiro (principal) — KPIs + série do gráfico
// ---------------------------------------------------------------------------

const COLS_FIN_SERIE: Coluna[] = [
  { chave: 'periodo', titulo: 'Período' },
  { chave: 'bruto', titulo: 'Bruto', alinhamento: DIR },
  { chave: 'liquido', titulo: 'Líquido', alinhamento: DIR },
];

interface FinanceiroArgs {
  r: ResumoVendas;
  ticketLiquido: number;
  serie: PontoSerie[];
  periodo: Periodo;
  config: ExportConfig;
}

export function buildFinanceiroReport(args: FinanceiroArgs): ReportData {
  const { r, ticketLiquido, serie, periodo, config } = args;
  return {
    titulo: 'Financeiro',
    periodo: rotuloPeriodo(periodo),
    kpis: config.incluirKpis
      ? [
          { label: 'Líquido das vendas', valor: fmtBRL(r.liquido) },
          { label: 'Faturamento bruto', valor: fmtBRL(r.bruto) },
          { label: 'Taxas e frete (ML)', valor: fmtBRL(r.descontos) },
          { label: 'Estornos', valor: fmtBRL(r.estornos) },
          { label: 'Ticket médio líquido', valor: fmtBRL(ticketLiquido) },
          { label: 'Já liberado', valor: fmtBRL(r.liberado) },
          { label: 'A liberar', valor: fmtBRL(r.aLiberar) },
          { label: 'Vendas no período', valor: fmtInt(r.pedidos) },
          { label: 'Markup no período', valor: r.markup != null ? fmtMarkupNum(r.markup) : '—' },
          { label: 'Lucro líquido no período', valor: r.margem != null ? fmtBRL(r.lucro) : '—' },
        ]
      : undefined,
    colunas: COLS_FIN_SERIE,
    linhas: serie.map((pt) => ({
      celulas: { periodo: pt.rotulo, bruto: fmtBRL(pt.bruto), liquido: fmtBRL(pt.liquido) },
    })),
  };
}

// ---------------------------------------------------------------------------
// Financeiro · Detalhe
// ---------------------------------------------------------------------------

const COLS_FIN_DETALHE: Coluna[] = [
  { chave: 'data', titulo: 'Data' },
  { chave: 'comprador', titulo: 'Comprador' },
  // A tela mostra miniaturas dos produtos; no export, os títulos dos itens (texto).
  { chave: 'produtos', titulo: 'Produtos' },
  { chave: 'unidades', titulo: 'Un.', alinhamento: DIR },
  { chave: 'liberacao', titulo: 'Liberação' },
  { chave: 'bruto', titulo: 'Bruto', alinhamento: DIR },
  { chave: 'retido', titulo: 'Retido (ML)', alinhamento: DIR },
  { chave: 'liquido', titulo: 'Líquido', alinhamento: DIR },
  { chave: 'markup', titulo: 'Markup', alinhamento: DIR },
];

const FILTRO_LIB_LABEL: Record<string, string> = {
  todos: 'Todos', liberado: 'Liberado', aliberar: 'A liberar',
};

interface FinanceiroDetalheArgs {
  pedidos: Pedido[];
  totais: { bruto: number; retido: number; liquido: number; markup: number | null };
  filtroLib: string;
  periodo: Periodo;
  config: ExportConfig;
}

export function buildFinanceiroDetalheReport(args: FinanceiroDetalheArgs): ReportData {
  const { pedidos, totais, filtroLib, periodo, config } = args;
  return {
    titulo: 'Financeiro · Detalhe',
    periodo: rotuloPeriodo(periodo),
    filtros: [`Situação: ${FILTRO_LIB_LABEL[filtroLib] ?? filtroLib}`],
    kpis: config.incluirKpis
      ? [
          { label: 'Bruto', valor: fmtBRL(totais.bruto) },
          { label: 'Retido (ML)', valor: fmtBRL(totais.retido) },
          { label: 'Líquido', valor: fmtBRL(totais.liquido) },
          { label: 'Markup', valor: fmtMarkupNum(totais.markup) },
        ]
      : undefined,
    colunas: COLS_FIN_DETALHE,
    linhas: pedidos.map((p) => ({
      celulas: {
        data: fmtData(p.data),
        comprador: p.comprador_nome ?? p.comprador_nick ?? '—',
        produtos: p.itens.map((it) => it.codigo ?? it.titulo ?? '?').join(', '),
        unidades: fmtInt(p.unidades),
        // Liberação = data + status (liberado/a liberar) na mesma coluna, como na tela.
        liberacao: p.money_release_date
          ? `${fmtData(p.money_release_date)} · ${new Date(p.money_release_date).getTime() <= Date.now() ? 'liberado' : 'a liberar'}`
          : '—',
        bruto: fmtBRL(p.bruto),
        retido: fmtBRL(Math.round((p.bruto - p.liquido) * 100) / 100),
        liquido: fmtBRL(p.liquido),
        markup: fmtMarkupNum(p.markup),
      },
      sublinhas: config.expandido
        ? {
            colunas: COLS_ITENS_PEDIDO,
            linhas: p.itens.map((it) => ({
              item: it.titulo ?? '—',
              cor: it.cor ?? '—',
              codigo: it.codigo ?? '—',
              ean: it.ean ?? '—',
              qtd: it.quantity,
              preco: fmtBRL(it.unit_price),
              custo: it.custo != null ? fmtBRL(it.custo) : '—',
              liquido: fmtBRL(it.liquido),
              markup: fmtMarkupNum(it.markup),
            })),
          }
        : undefined,
    })),
  };
}

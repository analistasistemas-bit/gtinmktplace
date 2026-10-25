// Textos das mensagens gerenciais do Telegram (ADR-0190). Só formatação — sem acesso a banco.
// Texto puro (sem parse_mode); dinheiro `R$ 1.234,56`; nunca traz nome de comprador.
import type { Kpis } from './kpis.ts';
import type { LucroPeriodo, ResultadoCarrinho } from './resultado.ts';
import { urlVendaML } from '../telegram.ts';

export const brl = (n: number): string => {
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 && Number(`${int}.${dec}`) > 0 ? '−' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};

/** Título curto para o Telegram: corta no último espaço antes de `max` (ou seco) e põe `…`. */
export function encurtar(titulo: string, max = 40): string {
  const t = titulo.trim();
  if (t.length <= max) return t;
  const corte = t.lastIndexOf(' ', max);
  return `${t.slice(0, corte > 0 ? corte : max)}…`;
}

const pct1 = (frac: number): string => {
  const t = Math.abs(frac * 100).toFixed(1).replace('.', ',');
  return `${frac < 0 && Number(t.replace(',', '.')) > 0 ? '−' : ''}${t}`;
};

export function linhaCrescimento(mes: number, anterior: number, rotuloAnterior: string): string {
  if (!(anterior > 0)) return 'sem base de comparação';
  const v = Number((((mes - anterior) / anterior) * 100).toFixed(1));
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')}% vs ${rotuloAnterior}`;
}

export interface KpisPeriodo { hoje: Kpis; mes: Kpis; anterior: Kpis; rotuloMes: string; rotuloAnterior: string }

type Linha = string | null | false | undefined;
/** Layout para celular: uma informação por linha, blocos separados por linha em branco; bloco vazio some. */
const blocos = (...bs: Linha[][]): string =>
  bs.map((b) => b.filter((l): l is string => !!l)).filter((b) => b.length).map((b) => b.join('\n')).join('\n\n');

const linhasKpis = (x: Kpis): string[] =>
  [`💰 Faturamento: ${brl(x.faturamento)}`, `🧾 Pedidos: ${x.pedidos}`, `🎟️ Ticket médio: ${brl(x.ticket)}`];

const linhaVariacao = (k: KpisPeriodo): string => {
  const t = linhaCrescimento(k.mes.faturamento, k.anterior.faturamento, k.rotuloAnterior);
  return k.anterior.faturamento > 0 ? `${k.mes.faturamento < k.anterior.faturamento ? '📉' : '📈'} ${t}` : t;
};

/** Período resumido (contexto): faturamento e pedidos numa linha curta, ticket na seguinte. */
const blocoPeriodo = (titulo: string, x: Kpis, variacao?: string): string[] =>
  [titulo, `${brl(x.faturamento)} · ${x.pedidos} pedidos`, `Ticket médio: ${brl(x.ticket)}`, ...(variacao ? [variacao] : [])];

export function montarMensagemCarrinho(
  c: ResultadoCarrinho, k: KpisPeriodo, chaveNumerica: number,
  estado: { parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean },
): string {
  const sufixo = estado.parcial ? ` (parcial: ${estado.parcial.recebidos} de ${estado.parcial.total} itens)`
    : estado.composicaoIncerta ? ' (composição do carrinho não confirmada)' : '';
  let lucro: string[];
  // Carrinho incompleto: o líquido gravado já descontou o frete do envio inteiro → lucro pessimista.
  if (estado.parcial || estado.composicaoIncerta) {
    lucro = ['💵 Lucro: — (carrinho incompleto)'];
  } else if (c.lucro != null) {
    lucro = [
      `💵 Lucro: ${brl(c.lucro)}`,
      ...(c.margemSobreVenda != null ? [`📊 Margem s/ venda: ${pct1(c.margemSobreVenda)}%`] : []),
      ...(c.markup != null ? [`📈 Markup: ${pct1(c.markup)}%`] : []),
    ];
  } else {
    lucro = [`💵 Lucro: — (${c.motivo === 'sem_custo' ? `sem custo em ${c.semCusto.length} ${c.semCusto.length === 1 ? 'item' : 'itens'}`
      : c.motivo === 'frete_nao_lido' ? 'frete não lido no ML' : 'alíquotas de imposto não confirmadas'})`];
  }
  return blocos(
    [`💼 Venda ${brl(c.venda)} — ${c.itens} ${c.itens === 1 ? 'item' : 'itens'}${sufixo}`, ...lucro],
    [
      ...c.semCusto.map((t) => `⚠️ ${encurtar(t)}: sem custo cadastrado`),
      // Prejuízo por item usa o mesmo líquido pessimista: some quando o carrinho está incompleto.
      ...(estado.parcial || estado.composicaoIncerta ? [] : c.prejuizos).map((p) => `⚠️ ${encurtar(p.titulo)}: prejuízo de ${brl(Math.abs(p.valor))}`),
    ],
    blocoPeriodo('📅 Hoje', k.hoje),
    blocoPeriodo(`📆 ${k.rotuloMes}`, k.mes, linhaVariacao(k)),
    [`🔗 Pedido ${chaveNumerica}`, urlVendaML(chaveNumerica)],
  );
}

const linhasLucro = (l: LucroPeriodo): string[] =>
  l.motivo === 'aliquota_nao_confirmada' ? ['💵 Lucro: — (alíquotas de imposto não confirmadas)']
    : l.lucro != null ? [`💵 Lucro: ${brl(l.lucro)}`, ...(l.markup != null ? [`📈 Markup: ${pct1(l.markup)}%`] : [])] : [];

const linhasCobertura = (l: LucroPeriodo): string[] => {
  const partes = [
    l.vendaSemCusto > 0 ? `${brl(l.vendaSemCusto)} sem custo` : '',
    l.vendaCustoEstimado > 0 ? `${brl(l.vendaCustoEstimado)} com custo estimado` : '',
    l.vendaSemImposto > 0 ? `${brl(l.vendaSemImposto)} sem alíquota de imposto` : '',
    l.pedidosFreteNaoLido > 0 ? `${l.pedidosFreteNaoLido} ${l.pedidosFreteNaoLido === 1 ? 'pedido' : 'pedidos'} sem frete lido` : '',
  ].filter(Boolean);
  if (l.pctVendaComLucro <= 0 && !partes.length) return [];
  return [`Lucro calculado em ${Math.round(l.pctVendaComLucro * 100)}% das vendas`, ...partes.map((p) => `• ${p}`)];
};

const secao = (titulo: string, itens: string[]): string[] => (itens.length ? [titulo, ...itens] : []);

export interface DadosResumo {
  /** `YYYY-MM-DD` (diaBrt); impresso como `dd/mm`. */
  dia: string; ontem: Kpis; lucroOntem: LucroPeriodo; mes: Kpis; anterior: Kpis;
  rotuloMes: string; rotuloAnterior: string;
  top: { titulo: string; lucro: number }[];
  atencao: { abaixoMinimo: number; prejuizo: number; semCusto: number };
  devolucoes: { estornado: number; prazoProximo: number };
  promocoes: { prejuizo: number; prazo: number } | null;
  freteSubiu: string[];
  apuradoAte: string;
}

const itens = (xs: (string | null)[]): string[] => xs.filter((x): x is string => !!x).map((x) => `• ${x}`);

export function montarResumoDiario(d: DadosResumo): string {
  const { atencao: a, devolucoes: dv, promocoes: p } = d;
  const k: KpisPeriodo = { hoje: d.ontem, mes: d.mes, anterior: d.anterior, rotuloMes: d.rotuloMes, rotuloAnterior: d.rotuloAnterior };
  return blocos(
    [`📊 Ontem · ${d.dia.replace(/^\d{4}-(\d{2})-(\d{2})$/, '$2/$1')}`],
    [...linhasKpis(d.ontem), ...linhasLucro(d.lucroOntem)],
    blocoPeriodo(`📆 ${d.rotuloMes}`, d.mes, linhaVariacao(k)),
    secao('🏆 Top lucro', d.top.map((t, i) => `${i + 1}. ${encurtar(t.titulo)} — ${brl(t.lucro)}`)),
    secao('⚠️ Atenção', itens([
      a.abaixoMinimo > 0 ? `${a.abaixoMinimo} abaixo do mínimo` : null,
      a.prejuizo > 0 ? `${a.prejuizo} com prejuízo` : null,
      a.semCusto > 0 ? `${a.semCusto} sem custo` : null,
    ])),
    secao('↩️ Devoluções', itens([
      dv.estornado > 0 ? `${brl(dv.estornado)} estornados` : null,
      dv.prazoProximo > 0 ? `${dv.prazoProximo} ${dv.prazoProximo === 1 ? 'reclamação' : 'reclamações'} com prazo em até 48 h` : null,
    ])),
    secao('🏷️ Promoções', p ? itens([
      p.prejuizo > 0 ? `${p.prejuizo} com prejuízo` : null,
      p.prazo > 0 ? `${p.prazo} ${p.prazo === 1 ? 'oportunidade' : 'oportunidades'} com adesão vencendo` : null,
    ]) : []),
    secao('🚚 Frete subiu', itens(d.freteSubiu.map((t) => encurtar(t)))),
    [...linhasCobertura(d.lucroOntem), `Apurado às ${d.apuradoAte}`],
  );
}

export function montarHoje(k: KpisPeriodo, l: LucroPeriodo): string {
  return blocos(['📅 Hoje'], [...linhasKpis(k.hoje), ...linhasLucro(l)], linhasCobertura(l));
}

export function montarMes(k: KpisPeriodo, l: LucroPeriodo): string {
  return blocos([`📆 ${k.rotuloMes}`], [...linhasKpis(k.mes), linhaVariacao(k), ...linhasLucro(l)], linhasCobertura(l));
}

export function montarTop(top: { titulo: string; lucro: number }[], rotuloMes: string, cobertura: LucroPeriodo): string {
  if (cobertura.motivo === 'aliquota_nao_confirmada') return blocos([`🏆 Top lucro — ${rotuloMes}`], linhasLucro(cobertura));
  if (!top.length) return `Sem lucro calculado em ${rotuloMes} até agora.`;
  return blocos(
    [`🏆 Top lucro — ${rotuloMes}`],
    top.map((t, i) => `${i + 1}. ${encurtar(t.titulo)} — ${brl(t.lucro)}`),
    linhasCobertura(cobertura),
  );
}

export const TEXTO_AJUDA = [
  '🤖 Comandos do PubliAI',
  '',
  '/hoje — vendas e lucro de hoje',
  '/ontem — vendas e lucro de ontem',
  '/mes — vendas e lucro do mês',
  '/top — produtos de maior lucro do mês',
  '/ajuda — esta lista',
].join('\n');
export const TEXTO_SEM_ACESSO = 'Este chat não tem acesso. Peça a um administrador para vincular o seu Telegram no PubliAI.';
export const TEXTO_SO_PRIVADO = 'Os comandos só funcionam em conversa privada com o bot.';
export const TEXTO_ERRO = 'Não consegui buscar os números agora. Tente de novo em instantes.';
export const TEXTO_VOLUME = 'O volume do mês passou do limite do bot. Veja os números no PubliAI.';

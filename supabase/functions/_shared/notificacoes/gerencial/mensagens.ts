// Textos das mensagens gerenciais do Telegram (ADR-0190). Só formatação — sem acesso a banco.
// Texto puro (sem parse_mode); dinheiro `R$ 1.234,56`; nunca traz nome de comprador.
import type { Kpis } from './kpis.ts';
import type { LucroPeriodo, ResultadoCarrinho } from './resultado.ts';
import { urlVendaML } from '../telegram.ts';

export const brl = (n: number): string => {
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 && Number(`${int}.${dec}`) > 0 ? '−' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};

const pct1 = (frac: number): string => (frac * 100).toFixed(1).replace('.', ',');

export function linhaCrescimento(mes: number, anterior: number, rotuloAnterior: string): string {
  if (!(anterior > 0)) return 'sem base de comparação';
  const v = Number((((mes - anterior) / anterior) * 100).toFixed(1));
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')}% vs ${rotuloAnterior}`;
}

export interface KpisPeriodo { hoje: Kpis; mes: Kpis; anterior: Kpis; rotuloMes: string; rotuloAnterior: string }

const linhaKpis = (x: Kpis): string => `${brl(x.faturamento)} · ${x.pedidos} pedidos · ticket ${brl(x.ticket)}`;
const linhaMes = (k: KpisPeriodo): string =>
  `${k.rotuloMes}: ${linhaKpis(k.mes)} · ${linhaCrescimento(k.mes.faturamento, k.anterior.faturamento, k.rotuloAnterior)}`;

export function montarMensagemCarrinho(
  c: ResultadoCarrinho, k: KpisPeriodo, chaveNumerica: number,
  estado: { parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean },
): string {
  const sufixo = estado.parcial ? ` (parcial: ${estado.parcial.recebidos} de ${estado.parcial.total} itens)`
    : estado.composicaoIncerta ? ' (composição do carrinho não confirmada)' : '';
  let lucro: string;
  if (c.lucro != null) {
    const margem = c.margemSobreVenda != null ? ` · Margem s/ venda ${pct1(c.margemSobreVenda)}%` : '';
    const markup = c.markup != null ? ` · Markup ${pct1(c.markup)}%` : '';
    lucro = `Lucro ${brl(c.lucro)}${margem}${markup}`;
  } else {
    lucro = `Lucro: — (${c.motivo === 'sem_custo' ? `sem custo em ${c.semCusto.length} ${c.semCusto.length === 1 ? 'item' : 'itens'}`
      : c.motivo === 'frete_nao_lido' ? 'frete não lido no ML' : 'alíquotas de imposto não confirmadas'})`;
  }
  return [
    `💼 Venda ${brl(c.venda)} — ${c.itens} ${c.itens === 1 ? 'item' : 'itens'}${sufixo}`,
    lucro,
    ...c.semCusto.map((t) => `⚠️ ${t}: sem custo cadastrado`),
    ...c.prejuizos.map((p) => `⚠️ ${p.titulo}: prejuízo de ${brl(Math.abs(p.valor))}`),
    `Hoje: ${linhaKpis(k.hoje)}`,
    linhaMes(k),
    `Pedido ${chaveNumerica}`,
    urlVendaML(chaveNumerica),
  ].join('\n');
}

const linhaLucro = (l: LucroPeriodo): string | null =>
  l.motivo === 'aliquota_nao_confirmada' ? 'Lucro: — (alíquotas de imposto não confirmadas)'
    : l.lucro != null ? `Lucro ${brl(l.lucro)}${l.markup != null ? ` · Markup ${pct1(l.markup)}%` : ''}` : null;

const linhaCobertura = (l: LucroPeriodo): string | null => {
  const partes = [
    l.vendaSemCusto > 0 ? `${brl(l.vendaSemCusto)} sem custo` : '',
    l.vendaCustoEstimado > 0 ? `${brl(l.vendaCustoEstimado)} com custo estimado` : '',
    l.vendaSemImposto > 0 ? `${brl(l.vendaSemImposto)} sem alíquota de imposto` : '',
    l.pedidosFreteNaoLido > 0 ? `${l.pedidosFreteNaoLido} ${l.pedidosFreteNaoLido === 1 ? 'pedido' : 'pedidos'} sem frete lido` : '',
  ].filter(Boolean);
  if (l.pctVendaComLucro <= 0 && !partes.length) return null;
  return [`Custo: ${Math.round(l.pctVendaComLucro * 100)}% das vendas com lucro calculado`, ...partes].join(' · ');
};

export interface DadosResumo {
  dia: string; ontem: Kpis; lucroOntem: LucroPeriodo; mes: Kpis; anterior: Kpis;
  rotuloMes: string; rotuloAnterior: string;
  top: { titulo: string; lucro: number }[];
  atencao: { abaixoMinimo: number; prejuizo: number; semCusto: number };
  devolucoes: { estornado: number; prazoProximo: number };
  promocoes: { prejuizo: number; prazo: number } | null;
  freteSubiu: string[];
  apuradoAte: string;
}

const unidas = (xs: (string | null)[]): string => xs.filter(Boolean).join(' · ');

export function montarResumoDiario(d: DadosResumo): string {
  const { atencao: a, devolucoes: dv, promocoes: p } = d;
  const atencao = unidas([
    a.abaixoMinimo > 0 ? `${a.abaixoMinimo} abaixo do mínimo` : null,
    a.prejuizo > 0 ? `${a.prejuizo} com prejuízo` : null,
    a.semCusto > 0 ? `${a.semCusto} sem custo` : null,
  ]);
  const devolucoes = unidas([
    dv.estornado > 0 ? `${brl(dv.estornado)} estornados` : null,
    dv.prazoProximo > 0 ? `${dv.prazoProximo} ${dv.prazoProximo === 1 ? 'reclamação' : 'reclamações'} com prazo em até 48 h` : null,
  ]);
  const promocoes = p ? unidas([
    p.prejuizo > 0 ? `${p.prejuizo} com prejuízo` : null,
    p.prazo > 0 ? `${p.prazo} ${p.prazo === 1 ? 'oportunidade' : 'oportunidades'} com adesão vencendo` : null,
  ]) : '';
  return [
    `📊 Ontem (${d.dia})`,
    linhaKpis(d.ontem),
    linhaLucro(d.lucroOntem),
    `${d.rotuloMes}: ${linhaKpis(d.mes)} · ${linhaCrescimento(d.mes.faturamento, d.anterior.faturamento, d.rotuloAnterior)}`,
    linhaCobertura(d.lucroOntem),
    d.top.length ? `🏆 Top lucro: ${d.top.map((t) => `${t.titulo} (${brl(t.lucro)})`).join(', ')}` : null,
    atencao && `⚠️ ${atencao}`,
    devolucoes && `↩️ Devoluções: ${devolucoes}`,
    promocoes && `🏷️ Promoções: ${promocoes}`,
    d.freteSubiu.length ? `🚚 Frete subiu: ${d.freteSubiu.join(', ')}` : null,
    `Dados apurados até ${d.apuradoAte}`,
  ].filter((l): l is string => !!l).join('\n');
}

export function montarHoje(k: KpisPeriodo, l: LucroPeriodo): string {
  return ['📅 Hoje', linhaKpis(k.hoje), linhaLucro(l), linhaCobertura(l)].filter(Boolean).join('\n');
}

export function montarMes(k: KpisPeriodo, l: LucroPeriodo): string {
  return [
    `📅 ${k.rotuloMes}`,
    `${linhaKpis(k.mes)} · ${linhaCrescimento(k.mes.faturamento, k.anterior.faturamento, k.rotuloAnterior)}`,
    linhaLucro(l),
    linhaCobertura(l),
  ].filter(Boolean).join('\n');
}

export function montarTop(top: { titulo: string; lucro: number }[], rotuloMes: string): string {
  if (!top.length) return `Sem lucro calculado em ${rotuloMes} até agora.`;
  return [`🏆 Top lucro — ${rotuloMes}`, ...top.map((t, i) => `${i + 1}. ${t.titulo} — ${brl(t.lucro)}`)].join('\n');
}

export const TEXTO_AJUDA = [
  'Comandos do PubliAI:',
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

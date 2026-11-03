// ADR-0193: Relatório mensal do cliente (PDF A4 retrato, 3 páginas). Renderer puro: recebe o
// contrato `MonthlyReport` + snapshot do demonstrativo fechado + dados de recebimento e devolve o
// jsPDF. Nada é recalculado aqui além de razões de exibição; desconhecido vira "—" com motivo,
// nunca zero. Fonte base é a Helvetica embutida (WinAnsi): sem "−" U+2212 nem glifos de seta, os
// triângulos de variação são desenhados.
import { jsPDF } from 'jspdf';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { vencimentoDaCompetencia } from '@/lib/platform-admin';
import type {
  AdsKpis,
  BillingStatement,
  MonthlyReport,
  PaymentProfile,
  PeriodKpis,
  SeriesPoint,
} from '@/lib/platform-admin';

type Rgb = [number, number, number];

// Tokens do DS (src/index.css): índigo/violeta de marca e chart-1..5, convertidos para sRGB.
const INK: Rgb = [24, 27, 46];
const MUTED: Rgb = [102, 108, 132];
const HAIR: Rgb = [225, 228, 240];
const PANEL: Rgb = [246, 246, 252];
const INDIGO: Rgb = [85, 77, 214];
const VIOLET: Rgb = [146, 72, 214];
const TEAL: Rgb = [38, 160, 156];
const AMBER: Rgb = [214, 142, 22];
const ROSE: Rgb = [208, 58, 92];
const GOOD: Rgb = [20, 134, 88];
const BAD: Rgb = [196, 46, 72];
const WHITE: Rgb = [255, 255, 255];

const W = 210;
const M = 14;
const CW = W - 2 * M;
const TOTAL_PAGES = 3;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export type RelatorioMensalArgs = {
  report: MonthlyReport;
  statementSnapshot: BillingStatement;
  paymentProfile: PaymentProfile | null;
  /** PNG data URL do QR do Pix (valor exato). Ausente = sem QR. */
  qrDataUrl?: string | null;
  /** Payload "copia e cola" do mesmo Pix. */
  pixPayload?: string | null;
};

// ---------------------------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------------------------
const brl = (cents: number) => fmtBRL(cents / 100).replace(/\u00a0/g, ' ');
const brlOuTraco = (cents: number | null | undefined) => (cents == null ? '—' : brl(cents));
const pct = (fracao: number | null | undefined, casas = 1) =>
  fracao == null ? '—' : `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export function mesPorExtenso(month: string): string {
  const [ano, mes] = month.split('-').map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)).replace(',', '');
}

function documentoBr(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

const MOTIVO_APOS_ADS: Record<string, string> = {
  lucro_indisponivel: 'lucro não calculável no mês',
  lucro_parcial: 'há itens sem lucro calculável',
  ads_indisponivel: 'dados de Ads indisponíveis',
  ads_cobertura_parcial: 'Ads sem cobertura completa do mês',
};

// ---------------------------------------------------------------------------------------------
// Variações
// ---------------------------------------------------------------------------------------------
type Delta = { texto: string; tom: 'up' | 'down' | 'flat'; bom: boolean } | null;

/** Variação relativa. Base anterior zero/ausente → sem % (nunca "∞"). `inverso`: subir é ruim. */
function deltaRel(atual: number | null, anterior: number | null | undefined, inverso = false): Delta {
  if (atual == null || anterior == null || anterior === 0) return null;
  const v = (atual - anterior) / Math.abs(anterior);
  const arred = Math.round(Math.abs(v) * 1000) / 10;
  if (arred === 0) return { texto: '0,0% vs mês anterior', tom: 'flat', bom: true };
  const sobe = v > 0;
  return {
    texto: `${arred.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs mês anterior`,
    tom: sobe ? 'up' : 'down',
    bom: inverso ? !sobe : sobe,
  };
}

/** Margens: diferença em pontos percentuais. */
function deltaPp(atual: number | null, anterior: number | null | undefined): Delta {
  if (atual == null || anterior == null) return null;
  const pp = Math.round((atual - anterior) * 1000) / 10;
  if (pp === 0) return { texto: '0,0 p.p. vs mês anterior', tom: 'flat', bom: true };
  return {
    texto: `${Math.abs(pp).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p. vs mês anterior`,
    tom: pp > 0 ? 'up' : 'down',
    bom: pp > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------------------------
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

function faixaMarca(doc: jsPDF, x: number, y: number, w: number, h: number) {
  const n = 48;
  const passo = w / n;
  for (let i = 0; i < n; i++) {
    doc.setFillColor(...mix(INDIGO, VIOLET, i / (n - 1)));
    doc.rect(x + i * passo, y, passo + 0.15, h, 'F');
  }
}

function texto(doc: jsPDF, s: string, x: number, y: number, o: { max?: number; size?: number; bold?: boolean; color?: Rgb; align?: 'left' | 'right' | 'center'; font?: string; spacing?: number } = {}) {
  doc.setFont(o.font ?? 'helvetica', o.bold ? 'bold' : 'normal').setFontSize(o.size ?? 8).setTextColor(...(o.color ?? INK));
  if (o.max) s = ajustar(doc, s, o.max);
  doc.text(s, x, y, { align: o.align ?? 'left', ...(o.spacing ? { charSpace: o.spacing } : {}) });
}

function ajustar(doc: jsPDF, s: string, largura: number): string {
  if (doc.getTextWidth(s) <= largura) return s;
  let c = s;
  while (c.length > 1 && doc.getTextWidth(`${c}…`) > largura) c = c.slice(0, -1);
  return `${c.trimEnd()}…`;
}

function paineis(doc: jsPDF, x: number, y: number, w: number, h: number, fill: Rgb = PANEL) {
  doc.setFillColor(...fill).setDrawColor(...HAIR).setLineWidth(0.25).roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
}

function secao(doc: jsPDF, titulo: string, y: number, nota?: string) {
  doc.setFillColor(...INDIGO).rect(M, y - 3.4, 1.1, 4.6, 'F');
  texto(doc, titulo, M + 3.2, y, { size: 10.5, bold: true });
  if (nota) texto(doc, nota, W - M, y, { size: 7, color: MUTED, align: 'right' });
}

function seta(doc: jsPDF, x: number, y: number, tom: 'up' | 'down' | 'flat', cor: Rgb) {
  doc.setFillColor(...cor);
  if (tom === 'up') doc.triangle(x, y + 0.8, x + 2.4, y + 0.8, x + 1.2, y - 1.4, 'F');
  else if (tom === 'down') doc.triangle(x, y - 1.4, x + 2.4, y - 1.4, x + 1.2, y + 0.8, 'F');
  else doc.rect(x, y - 0.3, 2.4, 0.7, 'F');
}

function linhaDelta(doc: jsPDF, d: Delta, x: number, y: number, vazio = 'sem comparação', curto = false) {
  if (!d) {
    texto(doc, vazio, x, y, { size: 6.8, color: MUTED });
    return;
  }
  const cor = d.tom === 'flat' ? MUTED : d.bom ? GOOD : BAD;
  seta(doc, x, y - 0.4, d.tom, cor);
  texto(doc, curto ? d.texto.replace('mês anterior', 'mês ant.') : d.texto, x + 3.6, y, { size: 6.8, bold: true, color: cor });
}

/** Cabeçalho comum das páginas 2 e 3 e rodapé de todas. */
function moldura(doc: jsPDF, report: MonthlyReport, pagina: number, titulo: string) {
  faixaMarca(doc, 0, 0, W, 2.4);
  texto(doc, 'DALUDI', M, 11, { size: 7.5, bold: true, color: INDIGO });
  texto(doc, 'Relatório mensal', M + 13.5, 11, { size: 7, color: MUTED });
  texto(doc, `${report.org.nome}  ·  ${mesPorExtenso(report.month)}`, W - M, 11, { size: 7, color: MUTED, align: 'right' });
  doc.setDrawColor(...HAIR).setLineWidth(0.25).line(M, 14, W - M, 14);
  if (titulo) texto(doc, titulo, M, 24, { size: 17, bold: true });
  doc.setDrawColor(...HAIR).line(M, 285, W - M, 285);
  texto(doc, `Daludi  ·  gerado em ${dataHora(report.generated_at)}`, M, 290, { size: 6.8, color: MUTED });
  texto(doc, `Página ${pagina}/${TOTAL_PAGES}`, W - M, 290, { size: 6.8, color: MUTED, align: 'right' });
}

// ---------------------------------------------------------------------------------------------
// Página 1: Seu mês em números
// ---------------------------------------------------------------------------------------------
function destaque(doc: jsPDF, x: number, y: number, w: number, h: number, o: {
  rotulo: string; valor: string; delta: Delta; legenda?: string; marca?: boolean; vazio?: string;
}) {
  paineis(doc, x, y, w, h, o.marca ? [243, 241, 253] : WHITE);
  if (o.marca) doc.setFillColor(...INDIGO).rect(x, y + 3, 1.2, h - 6, 'F');
  texto(doc, o.rotulo, x + 5, y + 7, { size: 7.4, bold: true, color: MUTED, spacing: 0.3 });
  texto(doc, o.valor, x + 5, y + 18.5, { size: 21, bold: true, color: o.valor === '—' ? MUTED : INK });
  linhaDelta(doc, o.delta, x + 5, y + 25, o.vazio);
  if (o.legenda) texto(doc, o.legenda, x + 5, y + h - 3.4, { max: w - 10, size: 6.6, color: MUTED });
}

function compacto(doc: jsPDF, x: number, y: number, w: number, h: number, rotulo: string, valor: string, delta: Delta) {
  paineis(doc, x, y, w, h, WHITE);
  texto(doc, rotulo, x + 3, y + 5.6, { max: w - 6, size: 6.6, bold: true, color: MUTED });
  texto(doc, valor, x + 3, y + 12.6, { size: 11.5, bold: true, color: valor === '—' ? MUTED : INK });
  linhaDelta(doc, delta, x + 3, y + 17.4, '', true);
}

function cascata(doc: jsPDF, k: PeriodKpis, y0: number): number {
  secao(doc, 'Do faturamento ao lucro', y0, k.profit_partial ? `parcial · cobertura ${pct(k.profit_coverage, 0)} do faturamento` : undefined);
  const gross = Math.max(k.gross_cents, 1);
  const semImposto = k.tax_cents == null;
  const liquido = k.tax_cents == null ? null : k.net_cents - k.tax_cents;
  type Linha = { rotulo: string; valor: number | null; sub?: string; tipo: 'total' | 'menos' | 'final'; ate: number | null };
  const linhas: Linha[] = [
    { rotulo: 'Faturamento da loja', valor: k.gross_cents, tipo: 'total', ate: k.gross_cents },
    { rotulo: '– Comissão e frete do ML', valor: k.gross_cents - k.net_cents, tipo: 'menos', ate: k.net_cents },
    { rotulo: '– Imposto', valor: k.tax_cents, sub: semImposto ? 'alíquota não confirmada' : undefined, tipo: 'menos', ate: liquido },
    { rotulo: '= Líquido', valor: liquido, tipo: 'total', ate: liquido },
    { rotulo: '– Custo dos produtos', valor: k.cost_cents, tipo: 'menos', ate: k.profit_cents != null && liquido != null && !k.profit_partial ? k.profit_cents : null },
    { rotulo: k.profit_partial ? '= Lucro (parcial)' : '= Lucro', valor: k.profit_cents, tipo: 'total', ate: k.profit_cents },
    { rotulo: '– Ads da conta', valor: k.ads_cost_cents, sub: k.ads_cost_cents == null ? 'indisponível' : undefined, tipo: 'menos', ate: k.profit_after_ads_cents },
    { rotulo: '= Lucro após Ads', valor: k.profit_after_ads_cents, sub: k.profit_after_ads_cents == null ? (MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] ?? 'indisponível') : undefined, tipo: 'final', ate: k.profit_after_ads_cents },
  ];
  const barX = M + 52;
  const barW = 82;
  const valX = W - M;
  const rh = 8.2;
  let y = y0 + 6;
  let anterior = k.gross_cents;
  linhas.forEach((l, i) => {
    if (i % 2 === 0) doc.setFillColor(251, 251, 254).rect(M, y, CW, rh, 'F');
    const final = l.tipo === 'final';
    texto(doc, l.rotulo, M + 2, y + 5.4, { size: 8, bold: l.tipo !== 'menos', color: l.tipo === 'menos' ? MUTED : INK });
    if (l.valor == null) {
      texto(doc, '—', valX - 2, y + 5.4, { size: 8.5, bold: true, color: MUTED, align: 'right' });
      if (l.sub) texto(doc, l.sub, barX, y + 5.2, { size: 6.8, color: MUTED });
    } else {
      const cor: Rgb = final ? VIOLET : l.tipo === 'total' ? INDIGO : ROSE;
      const negativo = l.valor < 0;
      let ini: number;
      let fim: number;
      if (l.tipo === 'menos') {
        fim = Math.max(0, Math.min(anterior, gross));
        ini = Math.max(0, fim - Math.abs(l.valor));
      } else {
        ini = 0;
        fim = Math.max(0, Math.min(l.valor, gross));
      }
      const bx = barX + (ini / gross) * barW;
      const bw = Math.max(((fim - ini) / gross) * barW, l.valor === 0 ? 0 : 0.8);
      if (bw > 0) doc.setFillColor(...(negativo ? BAD : cor)).roundedRect(bx, y + 1.9, bw, 4.4, 0.8, 0.8, 'F');
      const txt = l.tipo === 'menos' ? `– ${brl(Math.abs(l.valor))}` : brl(l.valor);
      texto(doc, txt, valX - 2, y + 5.4, { size: final ? 10 : 8.5, bold: l.tipo !== 'menos', color: final ? VIOLET : INK, align: 'right' });
    }
    if (l.tipo !== 'menos' && l.valor != null) anterior = l.valor;
    y += rh;
  });
  if (k.profit_partial || k.excluded_items > 0) {
    y += 1.5;
    texto(doc, `Itens sem lucro calculável: ${fmtInt(k.excluded_items)} (${brl(k.gross_cents - k.covered_gross_cents)} de faturamento fora do lucro).`, M + 2, y + 2.5, { size: 7, color: AMBER, bold: true });
    texto(doc, 'Líquido considera todos os itens; custo, lucro e margens consideram só os itens com lucro calculável.', M + 2, y + 6.4, { size: 6.6, color: MUTED });
    y += 7;
  }
  return y + 2;
}

function abreviar(cents: number): string {
  const v = Math.abs(cents) / 100;
  const sinal = cents < 0 ? '-' : '';
  if (v >= 1_000_000) return `${sinal}${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (v >= 1_000) return `${sinal}${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1).replace('.', ',').replace(/,0$/, '')} mil`;
  return `${sinal}${Math.round(v)}`;
}

function rotuloMes(month: string): string {
  const [a, m] = month.split('-').map(Number);
  return `${MES_CURTO[m - 1]}/${String(a).slice(2)}`;
}

function evolucao(doc: jsPDF, series: SeriesPoint[], y0: number, usaAposAds: boolean) {
  const pts = series.slice(-12);
  secao(doc, 'Evolução dos últimos meses', y0);
  const val = (p: SeriesPoint) => (usaAposAds ? p.profit_after_ads_cents : p.profit_cents);
  const rotuloLucro = usaAposAds ? 'Lucro após Ads' : 'Lucro (antes de Ads, pode ser parcial)';
  // Painel de barras
  const px = M;
  const py = y0 + 4;
  const pw = 118;
  const ph = 70;
  paineis(doc, px, py, pw, ph, WHITE);
  // legenda
  doc.setFillColor(...INDIGO).rect(px + 4, py + 4.2, 3, 3, 'F');
  texto(doc, 'Faturamento', px + 8.5, py + 6.7, { size: 6.8, color: MUTED });
  doc.setFillColor(...TEAL).rect(px + 28, py + 4.2, 3, 3, 'F');
  texto(doc, rotuloLucro, px + 32.5, py + 6.7, { size: 6.8, color: MUTED });
  const gx = px + 15;
  const gy = py + 12;
  const gw = pw - 19;
  const gh = ph - 12 - 9;
  const maxV = Math.max(1, ...pts.flatMap((p) => [p.gross_cents ?? 0, Math.max(val(p) ?? 0, 0)]));
  const minV = Math.min(0, ...pts.map((p) => val(p) ?? 0));
  const faixa = maxV - minV;
  const yDe = (v: number) => gy + gh - ((v - minV) / faixa) * gh;
  [0, 0.5, 1].forEach((t) => {
    const v = minV + faixa * t;
    doc.setDrawColor(...HAIR).setLineWidth(0.2).line(gx, yDe(v), gx + gw, yDe(v));
    texto(doc, abreviar(v), gx - 1.5, yDe(v) + 1, { size: 6, color: MUTED, align: 'right' });
  });
  const slot = gw / pts.length;
  const bw = Math.min(slot * 0.34, 4.6);
  let idxMax = -1;
  pts.forEach((p, i) => { if (p.gross_cents != null && (idxMax < 0 || p.gross_cents > (pts[idxMax].gross_cents ?? 0))) idxMax = i; });
  pts.forEach((p, i) => {
    const cx = gx + slot * i + slot / 2;
    const base = yDe(Math.max(minV, 0));
    if (p.gross_cents != null) {
      doc.setFillColor(...INDIGO).rect(cx - bw - 0.3, yDe(p.gross_cents), bw, base - yDe(p.gross_cents), 'F');
    } else {
      texto(doc, '—', cx - bw / 2 - 0.3, base - 1, { size: 7, color: MUTED, align: 'center' });
    }
    const l = val(p);
    if (l != null) {
      const topo = yDe(Math.max(l, 0));
      const bas = yDe(Math.min(l, 0));
      doc.setFillColor(...(l < 0 ? BAD : TEAL)).rect(cx + 0.3, topo, bw, Math.max(bas - topo, 0.3), 'F');
    }
    if (i === idxMax || i === pts.length - 1) {
      const alt = yDe(Math.max(p.gross_cents ?? 0, 0));
      texto(doc, abreviar(p.gross_cents ?? 0), cx - 0.3, alt - 1.2, { size: 6, bold: true, color: INDIGO, align: 'center' });
    }
    texto(doc, rotuloMes(p.month), cx, gy + gh + 4.6, { size: 5.8, color: MUTED, align: 'center' });
    if (p.partial) texto(doc, '*', cx, gy + gh + 7.6, { size: 6, color: AMBER, align: 'center' });
  });
  // Painel de margem
  const mx = px + pw + 4;
  const mw = CW - pw - 4;
  paineis(doc, mx, py, mw, ph, WHITE);
  texto(doc, usaAposAds ? 'Margem s/ venda após Ads' : 'Margem s/ venda', mx + 4, py + 6.7, { size: 6.8, bold: true, color: MUTED });
  const mpts = pts.map((p) => (usaAposAds ? p.margin_after_ads : (p.gross_cents && p.profit_cents != null ? p.profit_cents / p.gross_cents : null)));
  const validos = mpts.filter((v): v is number => v != null);
  const lx = mx + 10;
  const lw = mw - 14;
  const ly = py + 14;
  const lh = ph - 14 - 12;
  if (validos.length === 0) {
    texto(doc, 'indisponível nos meses exibidos', mx + mw / 2, py + ph / 2, { size: 7, color: MUTED, align: 'center' });
  } else {
    const lo = Math.min(0, ...validos);
    const hi = Math.max(...validos, lo + 0.01);
    const yy = (v: number) => ly + lh - ((v - lo) / (hi - lo)) * lh;
    [lo, (lo + hi) / 2, hi].forEach((v) => {
      doc.setDrawColor(...HAIR).setLineWidth(0.2).line(lx, yy(v), lx + lw, yy(v));
      texto(doc, pct(v, 0), lx - 1.5, yy(v) + 1, { size: 6, color: MUTED, align: 'right' });
    });
    const passo = lw / Math.max(pts.length - 1, 1);
    let ant: [number, number] | null = null;
    doc.setDrawColor(...VIOLET).setLineWidth(0.7);
    mpts.forEach((v, i) => {
      if (v == null) { ant = null; return; }
      const cur: [number, number] = [lx + passo * i, yy(v)];
      if (ant) doc.line(ant[0], ant[1], cur[0], cur[1]);
      ant = cur;
    });
    mpts.forEach((v, i) => {
      if (v == null) return;
      doc.setFillColor(...WHITE).setDrawColor(...VIOLET).setLineWidth(0.5).circle(lx + passo * i, yy(v), 0.9, 'FD');
    });
    const ultimo = mpts.length - 1;
    const vu = mpts[ultimo];
    if (vu != null) texto(doc, pct(vu, 1), lx + passo * ultimo, yy(vu) - 2.2, { size: 6.6, bold: true, color: VIOLET, align: 'right' });
    [0, ultimo].forEach((i) => texto(doc, rotuloMes(pts[i].month), lx + passo * i, ly + lh + 5, { size: 5.8, color: MUTED, align: i === 0 ? 'left' : 'right' }));
  }
  if (pts.some((p) => p.partial)) texto(doc, '* mês com lucro parcial (itens sem lucro calculável).', px, py + ph + 4, { size: 6.4, color: MUTED });
}

function pagina1(doc: jsPDF, report: MonthlyReport) {
  const k = report.summary.current;
  const p = report.summary.previous;
  faixaMarca(doc, 0, 0, W, 2.4);
  texto(doc, 'DALUDI', M, 11, { size: 7.5, bold: true, color: INDIGO });
  texto(doc, 'Relatório mensal', M + 13.5, 11, { size: 7, color: MUTED });
  texto(doc, `Emitido em ${dataHora(report.generated_at).slice(0, 10)}`, W - M, 11, { size: 7, color: MUTED, align: 'right' });
  doc.setDrawColor(...HAIR).setLineWidth(0.25).line(M, 14, W - M, 14);
  texto(doc, report.org.nome, M, 26, { max: CW, size: 21, bold: true });
  texto(doc, mesPorExtenso(report.month), M, 33.5, { size: 12, bold: true, color: INDIGO });
  texto(doc, 'Seu mês em números', W - M, 33.5, { size: 9, color: MUTED, align: 'right' });

  // Destaques
  const hy = 40;
  const hw = (CW - 4) / 2;
  destaque(doc, M, hy, hw, 33, {
    rotulo: 'FATURAMENTO DA LOJA', valor: brl(k.gross_cents), delta: deltaRel(k.gross_cents, p?.gross_cents),
    legenda: 'Vendas faturáveis do mês, já sem cupons do vendedor', vazio: p ? 'sem base de comparação' : 'sem mês anterior',
  });
  const apos = k.profit_after_ads_cents != null;
  const parcial = k.profit_partial;
  destaque(doc, M + hw + 4, hy, hw, 33, apos ? {
    rotulo: 'LUCRO APÓS ADS', valor: brl(k.profit_after_ads_cents!), delta: deltaRel(k.profit_after_ads_cents, p?.profit_after_ads_cents),
    legenda: 'Depois de comissão, frete, imposto, custo e Ads', marca: true, vazio: 'sem comparação',
  } : {
    rotulo: parcial ? 'LUCRO ANTES DE ADS (PARCIAL)' : 'LUCRO ANTES DE ADS',
    valor: brlOuTraco(k.profit_cents), delta: deltaRel(k.profit_cents, p?.profit_cents),
    legenda: `Após Ads indisponível: ${MOTIVO_APOS_ADS[k.unavailable_reason ?? ''] ?? 'dado ausente'}`, marca: true, vazio: 'sem comparação',
  });

  // Faixa compacta
  const cy = hy + 37;
  const cw = (CW - 4 * 3) / 5;
  const margem = apos ? k.margin_after_ads : k.margin;
  const margemAnt = apos ? p?.margin_after_ads : p?.margin;
  const mk = apos ? k.markup_after_ads : k.markup;
  const mkAnt = apos ? p?.markup_after_ads : p?.markup;
  const sufixo = apos ? ' após Ads' : ' (antes de Ads)';
  const celulas: Array<[string, string, Delta]> = [
    ['PEDIDOS', fmtInt(k.orders), deltaRel(k.orders, p?.orders)],
    ['UNIDADES', fmtInt(k.units), deltaRel(k.units, p?.units)],
    ['TICKET MÉDIO', brl(k.ticket_cents), deltaRel(k.ticket_cents, p?.ticket_cents)],
    // Glossário: margem/markup sobre o lucro após Ads levam "após Ads" no nome — aqui via nota (*).
    ['MARGEM S/ VENDA*', pct(margem), deltaPp(margem, margemAnt)],
    ['MARKUP*', mk == null ? '—' : pct(mk, 0), deltaPp(mk, mkAnt)],
  ];
  celulas.forEach(([r, v, d], i) => compacto(doc, M + i * (cw + 3), cy, cw, 21, r, v, d));
  texto(doc, `* Margem s/ venda e markup${sufixo}${parcial ? ', calculados só sobre os itens com lucro calculável' : ''}.`, M, cy + 25, { size: 6.4, color: MUTED });

  const y = cascata(doc, k, cy + 33);
  const comVenda = report.series.filter((s) => (s.gross_cents ?? 0) > 0).length;
  if (comVenda > 1) evolucao(doc, report.series, y + 8, apos);
  doc.setDrawColor(...HAIR).setLineWidth(0.25).line(M, 285, W - M, 285);
  texto(doc, `Daludi  ·  gerado em ${dataHora(report.generated_at)}`, M, 290, { size: 6.8, color: MUTED });
  texto(doc, `Página 1/${TOTAL_PAGES}`, W - M, 290, { size: 6.8, color: MUTED, align: 'right' });
}

// ---------------------------------------------------------------------------------------------
// Página 2: Desempenho da loja
// ---------------------------------------------------------------------------------------------
function tile(doc: jsPDF, x: number, y: number, w: number, h: number, rotulo: string, valor: string, delta: Delta, aux?: string, vazioDelta = '') {
  paineis(doc, x, y, w, h, WHITE);
  texto(doc, rotulo, x + 3.5, y + 5.6, { max: w - 6, size: 6.3, bold: true, color: MUTED });
  texto(doc, valor, x + 3.5, y + 13, { size: 13, bold: true, color: valor === '—' ? MUTED : INK });
  if (aux) texto(doc, aux, x + 3.5, y + h - 2.6, { max: w - 7, size: 6.4, color: MUTED });
  else linhaDelta(doc, delta, x + 3.5, y + h - 2.6, vazioDelta);
}

function desempenho(doc: jsPDF, report: MonthlyReport, y0: number): number {
  const k = report.summary.current;
  const p = report.summary.previous;
  const t = report.traffic;
  const colW = (CW - 2 * 3) / 3;
  const rh = 21;
  const naoComparavel = p ? '' : 'sem mês anterior';
  const itens: Array<[string, string, Delta, string?]> = [
    ['FATURAMENTO', brl(k.gross_cents), deltaRel(k.gross_cents, p?.gross_cents)],
    ['PEDIDOS', fmtInt(k.orders), deltaRel(k.orders, p?.orders)],
    ['UNIDADES', fmtInt(k.units), deltaRel(k.units, p?.units)],
    ['PREÇO MÉDIO POR UNIDADE', brlOuTraco(k.unit_price_cents), deltaRel(k.unit_price_cents, p?.unit_price_cents)],
    ['TICKET MÉDIO', brl(k.ticket_cents), deltaRel(k.ticket_cents, p?.ticket_cents)],
    ['VISITAS DOS ANÚNCIOS ACOMPANHADOS', t ? fmtInt(t.visits) : '—', null, t ? `${fmtInt(t.listings)} anúncio${t.listings === 1 ? '' : 's'} · ${t.days_covered}/${t.days_in_month} dias` : 'dado indisponível'],
    ['CONVERSÃO DOS ANÚNCIOS ACOMPANHADOS', t ? pct(t.conversion, 2) : '—', null, t ? (t.conversion == null ? 'sem visitas no período' : `${fmtInt(t.orders)} pedido${t.orders === 1 ? '' : 's'} nesses anúncios`) : 'dado indisponível'],
    ['VENDAS CANCELADAS', fmtInt(k.cancelled_orders), deltaRel(k.cancelled_orders, p?.cancelled_orders, true)],
    ['ESTORNOS', brlOuTraco(k.refunds_cents), deltaRel(k.refunds_cents, p?.refunds_cents, true), k.refunds_cents == null ? 'indisponível' : undefined],
  ];
  itens.forEach(([r, v, d, aux], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    tile(doc, M + col * (colW + 3), y0 + row * (rh + 3), colW, rh, r, v, d, aux, naoComparavel);
  });
  return y0 + 3 * (rh + 3);
}

function produtos(doc: jsPDF, report: MonthlyReport, y0: number): number {
  secao(doc, 'Principais produtos do mês', y0, 'por família · ordenado por faturamento');
  const tf = report.top_families;
  let y = y0 + 4;
  if (!tf) {
    paineis(doc, M, y, CW, 14, [253, 247, 232]);
    texto(doc, 'Indisponível: o catálogo de famílias não pôde ser lido neste momento.', M + 4, y + 8.4, { size: 8, color: AMBER, bold: true });
    return y + 16;
  }
  const rows = tf.rows.slice(0, 5);
  const cols = [
    { t: '#', w: 7, a: 'left' as const }, { t: 'Produto', w: 53, a: 'left' as const }, { t: 'Un.', w: 11, a: 'right' as const },
    { t: 'Faturamento', w: 25, a: 'right' as const }, { t: '% mês', w: 13, a: 'right' as const }, { t: 'Lucro', w: 25, a: 'right' as const },
    { t: 'Margem', w: 15, a: 'right' as const }, { t: 'Markup', w: 15, a: 'right' as const }, { t: 'Classe', w: 14, a: 'center' as const },
  ];
  const total = cols.reduce((s, c) => s + c.w, 0);
  const esc = CW / total;
  const xs: number[] = [];
  let acc = M;
  cols.forEach((c) => { xs.push(acc); acc += c.w * esc; });
  const ancora = (i: number) => (cols[i].a === 'right' ? xs[i] + cols[i].w * esc - 2 : cols[i].a === 'center' ? xs[i] + (cols[i].w * esc) / 2 : xs[i] + 2);
  doc.setFillColor(...PANEL).rect(M, y, CW, 7, 'F');
  cols.forEach((c, i) => texto(doc, c.t, ancora(i), y + 4.7, { size: 6.8, bold: true, color: MUTED, align: c.a }));
  y += 7;
  if (rows.length === 0) {
    texto(doc, 'Sem vendas de produtos com código no mês.', M + 2, y + 6, { size: 8, color: MUTED });
    y += 10;
  }
  const corClasse: Record<string, Rgb> = { A: INDIGO, B: TEAL, C: AMBER };
  rows.forEach((r, n) => {
    const ry = y + n * 9;
    doc.setDrawColor(...HAIR).setLineWidth(0.2).line(M, ry + 9, M + CW, ry + 9);
    const marca = r.partial ? '*' : '';
    const cel = [String(n + 1), r.name ?? `Código ${r.key}`, fmtInt(r.units), brl(r.gross_cents), pct(r.share), r.profit_cents == null ? '—' : `${brl(r.profit_cents)}${marca}`, pct(r.margin), r.markup == null ? '—' : pct(r.markup, 0), ''];
    cel.forEach((c, i) => {
      if (i === 8) return;
      const txt = i === 1 ? (doc.setFont('helvetica', 'bold').setFontSize(7.6), ajustar(doc, c, cols[1].w * esc - 4)) : c;
      texto(doc, txt, ancora(i), ry + 5.9, { size: 7.6, bold: i === 1 || i === 3, color: c === '—' ? MUTED : INK, align: cols[i].a });
    });
    if (r.class) {
      const cx = ancora(8);
      doc.setFillColor(...corClasse[r.class]).circle(cx, ry + 4.6, 2.3, 'F');
      texto(doc, r.class, cx, ry + 5.6, { size: 6.8, bold: true, color: WHITE, align: 'center' });
    } else texto(doc, '—', ancora(8), ry + 5.9, { size: 7.6, color: MUTED, align: 'center' });
  });
  y += rows.length * 9 + 4.5;
  texto(doc, `Top 5 = ${pct(tf.top_share, 0)} do faturamento`, M + 2, y, { size: 7.6, bold: true });
  if (rows.some((r) => r.partial)) texto(doc, '* lucro parcial: só itens com lucro calculável. Margem e markup antes de Ads.', W - M, y, { size: 6.4, color: MUTED, align: 'right' });
  else texto(doc, 'Margem s/ venda e markup antes de Ads.', W - M, y, { size: 6.4, color: MUTED, align: 'right' });
  if (tf.without_code_gross_cents > 0) { y += 4.4; texto(doc, `Vendas sem código de produto (fora do ranking): ${brl(tf.without_code_gross_cents)}`, M + 2, y, { size: 6.8, color: MUTED }); }
  if (tf.unknown_family_gross_cents > 0) { y += 4.4; texto(doc, `Família desconhecida (fora do ranking): ${brl(tf.unknown_family_gross_cents)}`, M + 2, y, { size: 6.8, color: MUTED }); }
  return y + 4;
}

function motivoAds(ads: AdsKpis | null): string {
  if (!ads) return 'Dados de Ads indisponíveis neste momento.';
  if (ads.coverage === 'none') return 'Sem coleta de Ads para este período.';
  return `Cobertura parcial do mês (${ads.days_covered} de ${ads.days_expected} dias): métricas de Ads não são exibidas para não induzir a erro.`;
}

function blocoAds(doc: jsPDF, ads: AdsKpis | null, y0: number) {
  secao(doc, 'Anúncios patrocinados (Mercado Ads)', y0);
  let y = y0 + 4;
  if (!ads || ads.coverage !== 'complete') {
    paineis(doc, M, y, CW, 14, [253, 247, 232]);
    texto(doc, motivoAds(ads), M + 4, y + 8.4, { max: CW - 8, size: 8, bold: true, color: AMBER });
    return;
  }
  if (ads.attribution === 'open') {
    const ate = ads.attribution_expected_final_on ? dataBr(ads.attribution_expected_final_on).slice(0, 5) : null;
    doc.setFillColor(253, 247, 232).setDrawColor(240, 214, 150).setLineWidth(0.25).roundedRect(M, y, CW, 7.2, 1.6, 1.6, 'FD');
    texto(doc, `Atribuição do ML em fechamento${ate ? ` até ${ate}` : ''} — valores podem variar levemente`, M + 4, y + 4.8, { size: 7.4, bold: true, color: AMBER });
    y += 10;
  }
  const colW = (CW - 2 * 3) / 3;
  const h = 15.5;
  const itens: Array<[string, string]> = [
    ['INVESTIMENTO', brlOuTraco(ads.cost_cents)], ['RECEITA ATRIBUÍDA', brlOuTraco(ads.revenue_cents)], ['ROAS', ads.roas == null ? '—' : `${ads.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`],
    ['ACOS', pct(ads.acos)], ['TACOS', pct(ads.tacos)], ['IMPRESSÕES', ads.prints == null ? '—' : fmtInt(ads.prints)],
    ['CLIQUES', ads.clicks == null ? '—' : fmtInt(ads.clicks)], ['CTR', pct(ads.ctr, 2)], ['CPC', brlOuTraco(ads.cpc_cents)],
  ];
  itens.forEach(([r, v], i) => {
    const x = M + (i % 3) * (colW + 3);
    const yy = y + Math.floor(i / 3) * (h + 2.5);
    paineis(doc, x, yy, colW, h, WHITE);
    texto(doc, r, x + 3.5, yy + 5.2, { size: 6.6, bold: true, color: MUTED });
    texto(doc, v, x + 3.5, yy + 12, { size: 12, bold: true, color: v === '—' ? MUTED : INK });
  });
}

function pagina2(doc: jsPDF, report: MonthlyReport) {
  moldura(doc, report, 2, 'Desempenho da loja');
  let y = desempenho(doc, report, 31);
  y = produtos(doc, report, y + 8);
  blocoAds(doc, report.ads, y + 8);
  texto(doc, 'Visitas e conversão consideram apenas os anúncios acompanhados (com leitura diária válida); não representam as visitas totais da loja.', M, 281.5, { size: 6.2, color: MUTED });
}

// ---------------------------------------------------------------------------------------------
// Página 3: Demonstrativo Daludi
// ---------------------------------------------------------------------------------------------
function linhaValor(doc: jsPDF, y: number, rotulo: string, valor: string, o: { bold?: boolean; sub?: string; cor?: Rgb } = {}) {
  texto(doc, rotulo, M + 3, y, { size: 8.4, bold: o.bold, color: o.cor ?? INK });
  if (o.sub) texto(doc, o.sub, M + 3, y + 3.6, { size: 6.6, color: MUTED });
  texto(doc, valor, W - M - 3, y, { size: 8.4, bold: o.bold, color: o.cor ?? INK, align: 'right' });
}

function pagina3(doc: jsPDF, a: RelatorioMensalArgs) {
  const { report, statementSnapshot: s, paymentProfile: perfil, qrDataUrl, pixPayload } = a;
  moldura(doc, report, 3, 'Demonstrativo Daludi');
  texto(doc, `Remuneração sobre as vendas de ${mesPorExtenso(report.month)}  ·  demonstrativo fechado em ${dataBr(s.closed_at)}`, M, 30, { size: 8, color: MUTED });
  const venc = vencimentoDaCompetencia(report.month, s.due_day ?? 5);

  // Composição
  let y = 40;
  secao(doc, 'Base de cálculo', y);
  paineis(doc, M, y + 3, CW, 34, WHITE);
  let ly = y + 10;
  linhaValor(doc, ly, 'Faturamento bruto considerado', brl(s.gross_cents)); ly += 7;
  linhaValor(doc, ly, 'Devoluções abatidas', s.refund_cents > 0 ? `– ${brl(s.refund_cents)}` : brl(0)); ly += 7;
  doc.setDrawColor(...HAIR).line(M + 3, ly - 4.2, W - M - 3, ly - 4.2);
  linhaValor(doc, ly, 'Base de cálculo', brl(s.base_cents), { bold: true }); ly += 7;
  const faixa = s.applied_tier != null && s.applied_bps != null ? `Faixa ${s.applied_tier} · ${(s.applied_bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : 'sem faixa aplicada';
  linhaValor(doc, ly, 'Faixa e percentual', faixa, { cor: MUTED });
  const dif = s.gross_cents - report.summary.current.gross_cents;
  y = y + 3 + 34 + 3;
  if (dif !== 0) {
    texto(doc, `Diferença para o faturamento da loja das páginas anteriores: ${dif < 0 ? '– ' : ''}${brl(Math.abs(dif))} (cupons do vendedor e ajustes posteriores ao fechamento).`, M + 1, y + 1.5, { size: 6.8, color: MUTED });
    y += 5;
  }

  y += 5;
  secao(doc, 'Composição do valor', y);
  const linhas = s.lines;
  const h = 7 + linhas.length * 7;
  paineis(doc, M, y + 3, CW, h, WHITE);
  let cy = y + 10;
  linhas.forEach((l) => {
    const rot = l.quantity != null && l.key !== 'infrastructure' && l.key !== 'setup' ? `${l.label} (${fmtInt(l.quantity)})` : l.label;
    linhaValor(doc, cy, (doc.setFont('helvetica', 'normal').setFontSize(8.4), ajustar(doc, rot, 120)), l.amount_cents < 0 ? `– ${brl(-l.amount_cents)}` : brl(l.amount_cents));
    cy += 7;
  });
  y = y + 3 + h + 5;

  // Total
  const sem = s.total_cents <= 0;
  const th = 26;
  if (sem) {
    paineis(doc, M, y, CW, th, [236, 247, 242]);
    doc.setFillColor(...GOOD).rect(M, y + 3, 1.2, th - 6, 'F');
    texto(doc, 'Sem valor a pagar nesta competência', M + 7, y + 11, { size: 13, bold: true, color: GOOD });
    texto(doc, s.total_cents < 0 ? `Crédito de ${brl(-s.total_cents)} a favor da organização, aplicado nas próximas competências.` : 'O total do demonstrativo é R$ 0,00.', M + 7, y + 18, { size: 8, color: MUTED });
    return;
  }
  faixaMarca(doc, M, y, CW, th);
  texto(doc, 'TOTAL A DEPOSITAR', M + 6, y + 8.5, { size: 7.6, bold: true, color: [226, 224, 252], spacing: 0.6 });
  texto(doc, brl(s.total_cents), M + 6, y + 20, { size: 22, bold: true, color: WHITE });
  texto(doc, 'VENCIMENTO', W - M - 6, y + 8.5, { size: 7.6, bold: true, color: [226, 224, 252], align: 'right' });
  texto(doc, dataBr(venc), W - M - 6, y + 20, { size: 18, bold: true, color: WHITE, align: 'right' });
  y += th + 7;

  // Recebimento
  secao(doc, 'Dados para pagamento', y);
  y += 4;
  if (!perfil) {
    paineis(doc, M, y, CW, 16, [253, 247, 232]);
    texto(doc, 'Dados de recebimento não cadastrados', M + 5, y + 7.4, { size: 9.5, bold: true, color: AMBER });
    texto(doc, 'Cadastre o favorecido e a chave Pix da Daludi para gerar as instruções de pagamento e o QR deste relatório.', M + 5, y + 12.4, { size: 7.2, color: MUTED });
    return;
  }
  const bh = 62;
  paineis(doc, M, y, CW, bh, WHITE);
  const dados: Array<[string, string]> = [
    ['Favorecido', perfil.beneficiary_name], ['Documento', documentoBr(perfil.document)], ['Banco', perfil.bank_name],
    ['Agência / conta', `${perfil.branch} / ${perfil.account}`], [`Chave Pix (${{ cpf: 'CPF', cnpj: 'CNPJ', email: 'e-mail', phone: 'celular', random: 'aleatória' }[perfil.pix_key_type]})`, perfil.pix_key],
  ];
  const esq = 100;
  dados.forEach(([r, v], i) => {
    texto(doc, r.toUpperCase(), M + 5, y + 8 + i * 11.2, { size: 6.4, bold: true, color: MUTED, spacing: 0.3 });
    texto(doc, v, M + 5, y + 13 + i * 11.2, { max: esq - 10, size: 9, bold: true });
  });
  const qx = M + esq + 6;
  doc.setDrawColor(...HAIR).line(M + esq, y + 6, M + esq, y + bh - 6);
  if (qrDataUrl && pixPayload) {
    doc.addImage(qrDataUrl, 'PNG', qx, y + 6, 38, 38);
    texto(doc, 'Pix com valor exato', qx + 41, y + 12, { size: 8.6, bold: true });
    texto(doc, brl(s.total_cents), qx + 41, y + 19, { size: 11, bold: true, color: INDIGO });
    ['Aponte a câmera do app', 'do banco ou use o', 'código abaixo.'].forEach((l, i) => texto(doc, l, qx + 41, y + 26 + i * 3.8, { size: 6.8, color: MUTED }));
    texto(doc, 'PIX COPIA E COLA', qx, y + 49, { size: 6.4, bold: true, color: MUTED, spacing: 0.3 });
    doc.setFont('courier', 'normal').setFontSize(5.6).setTextColor(...INK);
    const largura = W - M - 4 - qx;
    const quebrado = doc.splitTextToSize(pixPayload, largura) as string[];
    doc.text(quebrado, qx, y + 53, { lineHeightFactor: 1.15 });
  } else {
    texto(doc, 'QR Pix indisponível', qx, y + 20, { size: 9, bold: true, color: MUTED });
  }
}

// ---------------------------------------------------------------------------------------------
export function gerarRelatorioMensalPdf(args: RelatorioMensalArgs): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `Relatório mensal · ${args.report.org.nome} · ${args.report.month}`, author: 'Daludi' });
  pagina1(doc, args.report);
  doc.addPage();
  pagina2(doc, args.report);
  doc.addPage();
  pagina3(doc, args);
  return doc;
}

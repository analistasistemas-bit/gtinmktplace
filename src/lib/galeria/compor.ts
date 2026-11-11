// ADR-0201 (Task 12): composição do arquivo final no navegador (R6.3–R6.5, R9.1). Cena cortada ao centro para
// 1200×1540 (nunca esticar; capa com preenchimento branco), texto do roteiro aprovado em Inter sobre placa branca
// opaca (estilo A) e lupas recortadas da referência real (R3.3). Moda e capa sem texto. Recortes (missão 7, Moda 5 e 7)
// usam só `refUrl`. Texto que não cabe na caixa recusa com motivo — nunca é cortado nem sai da área.
// Lupa pela caixa do produto: o recorte sai de `recortesLupa` (o mesmo módulo da edge) sobre as caixas gravadas na
// referência; sem caixas, caixas que não cabem ou referência com outras dimensões → lança (nunca recorta às cegas).
// As imagens vêm do Storage (outra origem): `crossOrigin = 'anonymous'` antes do `src`, senão o canvas fica sujo e
// `toBlob` lança SecurityError (o bucket precisa de CORS para a origem do app — procedimento da Task 16).
import { ALTURA_FINAL, LARGURA_FINAL, PESO_MAXIMO_FINAL, planejarCorte } from '../../../supabase/functions/_shared/galeria/corte';
import { missoesDisponiveis } from '../../../supabase/functions/_shared/galeria/regras';
import { comLupa, recortesLupa, type CaixaNorm, type Quadrado } from '../../../supabase/functions/_shared/galeria/lupa';
import { razaoContraste, TEXTO_ESCURO } from './contraste';
import { layoutMissao, linhasNecessarias, lupasMissao, type Caixa } from './layouts';

export interface TextosComposicao {
  headline?: string; subheadline?: string; beneficios?: string[];
  specs?: Array<{ rotulo: string; valor: string }>; etapas?: string[]; legendas?: string[];
}
export interface EntradaComposicao {
  cenaUrl: string | null; refUrl: string | null; missao: number; textos: TextosComposicao;
  /** `#rrggbb` da cor do produto (acento); null = só texto escuro. */
  corProduto: string | null; moda: boolean;
  /** Caixas da leitura da referência (missão com lupa); null/ausente → a composição recusa. */
  lupa?: { produto: CaixaNorm; detalhes: CaixaNorm[]; ref_w: number; ref_h: number } | null;
}

// Placa 100% opaca (≥92% exigido): o contraste "na cor composta" é exatamente o medido contra branco.
const PLACA = '#ffffff';
const FOLGA = 16;
const QUALIDADES = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.7];
const TITULO_PX = 84;

interface Trecho { rotulo: string; texto: string; caixa: Caixa; marcador?: string }

const nfc = (s: string | undefined) => (s ?? '').normalize('NFC').trim();
const ehRecorte = (missao: number, moda: boolean) =>
  missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).find((m) => m.missao === missao)?.usaGerador === false;

/** Pares texto × caixa na ordem de `layoutMissao`; `excesso` = mais textos do que caixas (nunca some em silêncio). */
function trechos(missao: number, t: TextosComposicao): { lista: Trecho[]; excesso: boolean } {
  const caixas = layoutMissao(missao, t);
  const itens: Array<Omit<Trecho, 'caixa'>> = [{ rotulo: 'Título', texto: nfc(t.headline) }];
  const serie = (nome: string, xs: string[] = [], marca?: (i: number) => string) =>
    xs.forEach((x, i) => itens.push({ rotulo: `${nome} ${i + 1}`, texto: nfc(x), marcador: marca?.(i) }));
  if (missao === 2 || missao === 3) {
    if (t.subheadline) itens.push({ rotulo: 'Subtítulo', texto: nfc(t.subheadline) });
    if (missao === 3 && t.legendas?.length) itens.push({ rotulo: 'Legenda', texto: nfc(t.legendas[0]) }); // chip
  } else if (missao === 4) serie('Benefício', t.beneficios, () => '•');
  else if (missao === 5) {
    (t.specs ?? []).forEach((s, i) => itens.push({ rotulo: `Rótulo ${i + 1}`, texto: nfc(s.rotulo) }, { rotulo: `Valor ${i + 1}`, texto: nfc(s.valor) }));
  } else if (missao === 6) serie('Etapa', t.etapas, (i) => String(i + 1));
  else if (missao === 7) serie('Legenda', t.legendas);
  return {
    lista: itens.slice(0, caixas.length).map((x, i) => ({ ...x, caixa: caixas[i] })).filter((x) => x.texto !== ''),
    excesso: itens.length > caixas.length,
  };
}

/** Motivos para recusar a composição por texto (vazio = cabe). Capa e Moda não levam texto. */
export function motivosDeTexto(missao: number, textos: TextosComposicao, moda: boolean): string[] {
  if (moda || missao === 1) return [];
  const { lista, excesso } = trechos(missao, textos);
  const m = lista.filter((x) => linhasNecessarias(x.texto, x.caixa.fontePx, x.caixa.w) > x.caixa.linhasMax)
    .map((x) => `${x.rotulo} não cabe em ${x.caixa.linhasMax} linha${x.caixa.linhasMax > 1 ? 's' : ''}: encurte o texto no roteiro`);
  return excesso ? [`Há mais textos do que o layout da missão ${missao} comporta`, ...m] : m;
}

function carregar(url: string | null): Promise<HTMLImageElement> {
  if (!url) return Promise.reject(new Error('Imagem sem URL'));
  return new Promise((ok, falha) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('Não foi possível carregar a imagem para compor'));
    img.src = url;
  });
}

/** Quebra por palavra medida no canvas; recusa se passar das linhas da caixa ou da largura (nunca corta). */
function quebrar(ctx: CanvasRenderingContext2D, x: Trecho): string[] {
  const linhas: string[] = [];
  for (const p of x.texto.split(/\s+/)) {
    const tentativa = linhas.length ? `${linhas[linhas.length - 1]} ${p}` : p;
    if (linhas.length && ctx.measureText(tentativa).width <= x.caixa.w) linhas[linhas.length - 1] = tentativa;
    else linhas.push(p);
  }
  if (linhas.length > x.caixa.linhasMax || linhas.some((l) => ctx.measureText(l).width > x.caixa.w)) {
    throw new Error(`${x.rotulo} não cabe em ${x.caixa.linhasMax} linha(s): encurte o texto no roteiro`);
  }
  return linhas;
}

function lupa(ctx: CanvasRenderingContext2D, ref: HTMLImageElement, r: { x: number; y: number; w: number; h: number },
  l: { x: number; y: number; lado: number }, acento: string) {
  const raio = l.lado / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(l.x + raio, l.y + raio, raio, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(ref, r.x, r.y, r.w, r.h, l.x, l.y, l.lado, l.lado);
  ctx.restore();
  ctx.beginPath(); ctx.arc(l.x + raio, l.y + raio, raio, 0, Math.PI * 2);
  ctx.lineWidth = 6; ctx.strokeStyle = acento; ctx.stroke();
}

function toBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Falha ao gerar o JPEG'))), 'image/jpeg', q));
}

/** Referência carregada + quadrados da lupa pelas caixas gravadas (mesma geometria da edge). */
async function recortesDaReferencia(e: EntradaComposicao): Promise<{ ref: HTMLImageElement; r: Quadrado[] }> {
  const l = e.lupa;
  if (!comLupa(e.missao, e.moda) || !l) throw new Error('Lupa indisponível: sem as caixas do produto na foto de referência');
  const ref = await carregar(e.refUrl);
  if (ref.naturalWidth !== l.ref_w || ref.naturalHeight !== l.ref_h) {
    throw new Error('A foto de referência tem dimensões diferentes das lidas para a lupa: recarregue e tente de novo');
  }
  const r = recortesLupa(l.ref_w, l.ref_h, l, e.missao, e.moda);
  if (!r || r.length === 0) throw new Error('Lupa indisponível: o detalhe não cabe dentro do produto na foto');
  return { ref, r };
}

export async function comporImagemFinal(e: EntradaComposicao): Promise<Blob> {
  const motivos = motivosDeTexto(e.missao, e.textos, e.moda);
  if (motivos.length > 0) throw new Error(motivos.join(' · '));
  const comTexto = !e.moda && e.missao !== 1;
  if (comTexto) {
    await Promise.all([document.fonts.load('600 60px Inter'), document.fonts.load(`800 ${TITULO_PX}px Inter`)]);
    // `load` não rejeita se o woff2 falhar: o texto sairia na fonte padrão e passaria na medida.
    if (!document.fonts.check('600 60px Inter') || !document.fonts.check(`800 ${TITULO_PX}px Inter`)) {
      throw new Error('A fonte Inter não carregou: recarregue a página e tente de novo');
    }
  }
  const acento = e.corProduto && /^#[0-9a-f]{6}$/i.test(e.corProduto) && razaoContraste(e.corProduto, PLACA) >= 4.5
    ? e.corProduto : TEXTO_ESCURO;

  const canvas = document.createElement('canvas');
  canvas.width = LARGURA_FINAL; canvas.height = ALTURA_FINAL;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador');
  ctx.fillStyle = PLACA; ctx.fillRect(0, 0, LARGURA_FINAL, ALTURA_FINAL);

  if (ehRecorte(e.missao, e.moda)) {
    const { ref, r } = await recortesDaReferencia(e);
    if (e.moda) {
      // Moda sem texto: o recorte do detalhe (5 = 1º, 7 = 2º) em 1200×1200 no centro.
      const q = r[0];
      ctx.drawImage(ref, q.x, q.y, q.w, q.h, 0, (ALTURA_FINAL - LARGURA_FINAL) / 2, LARGURA_FINAL, LARGURA_FINAL);
    } else {
      lupasMissao(e.missao).forEach((l, i) => lupa(ctx, ref, r[i], l, acento));
    }
  } else {
    const cena = await carregar(e.cenaUrl);
    const w = cena.naturalWidth; const h = cena.naturalHeight;
    const p = planejarCorte(w, h, e.missao === 1);
    if (p.modo === 'bloqueado') throw new Error(`A cena exige corte acima de 15% (${Math.round(p.perda * 100)}%): gere de novo`);
    if (p.modo === 'corte') ctx.drawImage(cena, p.x, p.y, p.largura, p.altura, 0, 0, LARGURA_FINAL, ALTURA_FINAL);
    else {
      const s = Math.min(LARGURA_FINAL / w, ALTURA_FINAL / h);
      const dw = Math.round(w * s); const dh = Math.round(h * s);
      ctx.drawImage(cena, Math.round((LARGURA_FINAL - dw) / 2), Math.round((ALTURA_FINAL - dh) / 2), dw, dh);
    }
    if (!e.moda && lupasMissao(e.missao).length > 0) {
      const { ref, r } = await recortesDaReferencia(e);
      lupasMissao(e.missao).forEach((l, i) => lupa(ctx, ref, r[i], l, acento));
    }
  }

  if (comTexto) {
    ctx.textBaseline = 'top';
    for (const x of trechos(e.missao, e.textos).lista) {
      ctx.font = `${x.caixa.fontePx >= TITULO_PX ? 800 : 600} ${x.caixa.fontePx}px Inter`;
      const linhas = quebrar(ctx, x);
      const passo = x.caixa.h / x.caixa.linhasMax;
      const largura = Math.max(...linhas.map((l) => ctx.measureText(l).width));
      // Marcador (número da etapa, ponto do benefício) na coluna x 72–144, dentro da mesma placa.
      const x0 = x.marcador ? 72 : x.caixa.x;
      ctx.fillStyle = PLACA;
      ctx.fillRect(x0 - FOLGA, x.caixa.y - FOLGA, x.caixa.x - x0 + largura + 2 * FOLGA, linhas.length * passo + 2 * FOLGA);
      if (x.marcador) { ctx.fillStyle = acento; ctx.font = `800 ${x.caixa.fontePx}px Inter`; ctx.fillText(x.marcador, x0, x.caixa.y); }
      ctx.fillStyle = TEXTO_ESCURO;
      ctx.font = `${x.caixa.fontePx >= TITULO_PX ? 800 : 600} ${x.caixa.fontePx}px Inter`;
      linhas.forEach((l, i) => ctx.fillText(l, x.caixa.x, x.caixa.y + i * passo));
    }
  }

  for (const q of QUALIDADES) {
    const b = await toBlob(canvas, q);
    if (b.size <= PESO_MAXIMO_FINAL) return b;
  }
  throw new Error('O arquivo final passou de 1 MB mesmo na qualidade mínima');
}

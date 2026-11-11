// Layouts fixos das missões 2–7 no arquivo final 1200×1540 (R6.4/R6.5, estilo A). A Task 12 desenha o texto dentro
// destas caixas; as áreas que o prompt reserva à cena vêm de `layout-area.ts` (fonte única).
// Área segura: x 72–1128 (6%), y 184,8–1355,2 (12–88%). Fonte ≥60 px (5%); títulos 84 px (7%).
// Puro (só importa `regras.ts`): o front compõe com isto e o roteiro (edge) poda o que não cabe com a mesma conta.
import { CAMPOS_DA_MISSAO, CAPACIDADE, type CampoTexto } from './regras.ts';

export interface Caixa { x: number; y: number; w: number; h: number; fontePx: number; linhasMax: number }

/** Só as quantidades importam aqui; o texto é da Task 12. */
export interface TextosMissao {
  headline?: string; subheadline?: string; beneficios?: unknown[]; specs?: Array<{ rotulo: string; valor: string }>;
  etapas?: unknown[]; legendas?: unknown[];
}

const TITULO = 84;
const CORPO = 60;
const X = 72;
const LARGURA = 1056;
const TOPO = 185;
const FIM = 1355;

// Entrelinha: 1,2 no título (til e cedilha não cruzam a linha de cima), 1,25 no corpo.
const altura = (fontePx: number, linhas: number) => Math.round(fontePx * (fontePx >= TITULO ? 1.2 : 1.25)) * linhas;

/**
 * Largura estimada do texto: 0,6 em por caractere (Inter 600–800 mede ~0,52–0,58 em em média; fator majorado ~10%
 * para nunca subestimar). Serve aos testes e à Task 12 para prever quebra e estouro.
 */
export const FATOR_LARGURA = 0.6;
export function linhasNecessarias(texto: string, fontePx: number, w: number): number {
  const porLinha = Math.max(1, Math.floor(w / (fontePx * FATOR_LARGURA)));
  let linhas = 1; let usado = 0;
  for (const p of texto.trim().split(/\s+/)) {
    const n = p.length;
    if (usado === 0) usado = n;
    else if (usado + 1 + n <= porLinha) usado += 1 + n;
    else { linhas++; usado = n; }
    while (usado > porLinha) { linhas++; usado -= porLinha; }
  }
  return linhas;
}
const caixa = (x: number, y: number, w: number, fontePx: number, linhasMax: number): Caixa =>
  ({ x, y, w, h: altura(fontePx, linhasMax), fontePx, linhasMax });

/** Headline (≤2 linhas) e, se houver, subheadline logo abaixo. */
function cabecalho(w: number, sub: boolean): Caixa[] {
  const h = caixa(X, TOPO, w, TITULO, 2);
  return sub ? [h, caixa(X, h.y + h.h + 20, w, CORPO, 2)] : [h];
}

// Coluna à esquerda: número/ícone em x 72–144, texto de x 170 a 760.
const COLUNA_X = 170;
const COLUNA_W = 590;

function coluna(n: number, passo: number, w: number, linhas: number): Caixa[] {
  const h = caixa(X, TOPO, LARGURA, TITULO, 2); // título na largura segura, faixa de topo reservada ao gerador
  const itens: Caixa[] = [];
  let y = h.y + h.h + 30;
  for (let i = 0; i < n; i++) {
    const c = caixa(COLUNA_X, y, w, CORPO, linhas);
    itens.push(c);
    y += c.h + passo;
  }
  return [h, ...itens];
}

export function layoutMissao(missao: number, t: TextosMissao): Caixa[] {
  switch (missao) {
    case 2:
      return cabecalho(LARGURA, !!t.subheadline);
    case 3: {
      // Chip logo abaixo do texto, na faixa de topo reservada (2 linhas: legenda de 5 palavras passa de 1056 px).
      const cab = cabecalho(LARGURA, !!t.subheadline);
      const ult = cab[cab.length - 1];
      return [...cab, ...(t.legendas?.length ? [caixa(X, ult.y + ult.h + 20, LARGURA, CORPO, 2)] : [])] // um chip: CAPACIDADE[3];
    }
    case 4:
      return coluna(Math.min(CAPACIDADE[4].beneficios!, t.beneficios?.length ?? 0), 40, COLUNA_W, 3);
    case 5: {
      // Ficha ancorada embaixo: título (2 linhas) + n linhas (rótulo e valor, 1 linha cada; valor longo é da Task 12).
      const n = Math.min(CAPACIDADE[5].specs!, t.specs?.length ?? 0);
      const linha = altura(CORPO, 1);
      const tit = altura(TITULO, 2);
      const topo = FIM - (tit + 24 + n * linha + Math.max(0, n - 1) * 20);
      const rows = Array.from({ length: n }, (_, i) => {
        const y = topo + tit + 24 + i * (linha + 20);
        return [caixa(X, y, 400, CORPO, 1), caixa(500, y, 628, CORPO, 1)];
      }).flat();
      return [caixa(X, topo, LARGURA, TITULO, 2), ...rows];
    }
    case 6: // etapa em até 2 linhas (decisão do Diego, 10/11): largura toda, 7 palavras a 60 px
      return coluna(Math.min(CAPACIDADE[6].etapas!, t.etapas?.length ?? 0), 30, LARGURA + X - COLUNA_X, 2);
    case 7: {
      // Duas lupas de 408 px (recortes da referência) em y 700–1108; legenda de até 3 linhas embaixo de cada uma.
      const legs = Math.min(CAPACIDADE[7].legendas!, t.legendas?.length ?? 0);
      return [
        caixa(X, TOPO, LARGURA, TITULO, 2),
        ...Array.from({ length: legs }, (_, i) => caixa(i ? 648 : X, 1130, 480, CORPO, 3)),
      ];
    }
    default:
      return [];
  }
}

/** Lupa (recorte da referência, R3.3) no arquivo final: quadrado de `lado` px em (x, y), desenhado em círculo. */
export interface Lupa { x: number; y: number; lado: number }
export function lupasMissao(missao: number): Lupa[] {
  if (missao === 3) return [{ x: X, y: 990, lado: 340 }]; // canto inferior esquerdo reservado (layout-area.ts)
  // Centradas sobre as legendas (x 72 e 648, largura 480); y 700–1108.
  if (missao === 7) return [{ x: 108, y: 700, lado: 408 }, { x: 684, y: 700, lado: 408 }];
  return [];
}

/** Textos de uma missão para compor (o front) ou podar (o roteiro na edge). */
export interface TextosComposicao {
  headline?: string; subheadline?: string; beneficios?: string[];
  specs?: Array<{ rotulo: string; valor: string }>; etapas?: string[]; legendas?: string[];
}

export interface Trecho { rotulo: string; texto: string; caixa: Caixa; marcador?: string }

const nfc = (s: string | undefined) => (s ?? '').normalize('NFC').trim();
const ROTULO_CAMPO: Array<[CampoTexto, string]> = [
  ['subheadline', 'Subtítulo'], ['beneficios', 'Benefícios'], ['specs', 'Especificações'], ['etapas', 'Etapas'], ['legendas', 'Legendas'],
];
const preenchido = (v: TextosComposicao[keyof TextosComposicao]) => (Array.isArray(v)
  ? v.some((x) => (typeof x === 'string' ? x : `${x.rotulo ?? ''}${x.valor ?? ''}`).trim() !== '')
  : (v ?? '').trim() !== '');

/**
 * Pares texto × caixa na ordem de `layoutMissao`; `excesso` = mais textos do que caixas; `fora` = campos preenchidos que
 * o layout da missão não mostra (`CAMPOS_DA_MISSAO`; revisão geral: nenhum texto aprovado some em silêncio).
 */
export function trechos(missao: number, t: TextosComposicao): { lista: Trecho[]; excesso: boolean; fora: string[] } {
  const caixas = layoutMissao(missao, t);
  const itens: Array<Omit<Trecho, 'caixa'>> = [{ rotulo: 'Título', texto: nfc(t.headline) }];
  const serie = (nome: string, xs: string[] = [], marca?: (i: number) => string) =>
    xs.forEach((x, i) => itens.push({ rotulo: `${nome} ${i + 1}`, texto: nfc(x), marcador: marca?.(i) }));
  if (missao === 2 || missao === 3) {
    if (t.subheadline) itens.push({ rotulo: 'Subtítulo', texto: nfc(t.subheadline) });
    if (missao === 3) serie('Legenda', t.legendas); // um chip só: a 2ª legenda vira excesso
  } else if (missao === 4) serie('Benefício', t.beneficios, () => '•');
  else if (missao === 5) {
    (t.specs ?? []).forEach((s, i) => itens.push({ rotulo: `Rótulo ${i + 1}`, texto: nfc(s.rotulo) }, { rotulo: `Valor ${i + 1}`, texto: nfc(s.valor) }));
  } else if (missao === 6) serie('Etapa', t.etapas, (i) => String(i + 1));
  else if (missao === 7) serie('Legenda', t.legendas);
  return {
    lista: itens.slice(0, caixas.length).map((x, i) => ({ ...x, caixa: caixas[i] })).filter((x) => x.texto !== ''),
    excesso: itens.length > caixas.length,
    fora: ROTULO_CAMPO.filter(([c]) => !(CAMPOS_DA_MISSAO[missao] ?? []).includes(c) && preenchido(t[c])).map(([, r]) => r),
  };
}

/** Motivos para recusar a composição por texto (vazio = cabe). Capa e Moda não levam texto. */
export function motivosDeTexto(missao: number, textos: TextosComposicao, moda: boolean): string[] {
  if (moda || missao === 1) return [];
  const { lista, excesso, fora } = trechos(missao, textos);
  const m = lista.filter((x) => linhasNecessarias(x.texto, x.caixa.fontePx, x.caixa.w) > x.caixa.linhasMax)
    .map((x) => `${x.rotulo} não cabe em ${x.caixa.linhasMax} linha${x.caixa.linhasMax > 1 ? 's' : ''}: encurte o texto no roteiro`);
  return [
    ...(excesso ? [`Há mais textos do que o layout da missão ${missao} comporta`] : []),
    ...fora.map((r) => `${r} não aparece no layout da missão ${missao}: remova do roteiro`),
    ...m,
  ];
}

// Layouts fixos das missões 2–7 no arquivo final 1200×1540 (R6.4/R6.5, estilo A). A Task 12 desenha o texto dentro
// destas caixas; as áreas que o prompt reserva à cena vêm de `_shared/galeria/layout-area.ts` (fonte única).
// Área segura: x 72–1128 (6%), y 184,8–1355,2 (12–88%). Fonte ≥60 px (5%); títulos 84 px (7%).
import type { SpecRoteiro } from '../../../supabase/functions/_shared/galeria/roteiro';

export interface Caixa { x: number; y: number; w: number; h: number; fontePx: number; linhasMax: number }

/** Só as quantidades importam aqui; o texto é da Task 12. */
export interface TextosMissao {
  headline?: string; subheadline?: string; beneficios?: unknown[]; specs?: Pick<SpecRoteiro, 'rotulo' | 'valor'>[];
  etapas?: unknown[]; legendas?: unknown[];
}

const TITULO = 84;
const CORPO = 60;
const X = 72;
const LARGURA = 1056;
const TOPO = 185;
const FIM = 1355;
const MAX = { beneficios: 3, specs: 4, etapas: 4 };

const altura = (fontePx: number, linhas: number) => Math.round(fontePx * (fontePx >= TITULO ? 1.05 : 1.25)) * linhas;
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

function coluna(n: number, passo: number, linhasTitulo: number): Caixa[] {
  const h = caixa(X, TOPO, COLUNA_W + COLUNA_X - X, TITULO, linhasTitulo);
  const itens: Caixa[] = [];
  let y = h.y + h.h + 40;
  for (let i = 0; i < n; i++) {
    const c = caixa(COLUNA_X, y, COLUNA_W, CORPO, 3);
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
      const chip = t.legendas?.length ? [caixa(X, 1180, 520, CORPO, 1)] : [];
      return [...cabecalho(LARGURA, !!t.subheadline), ...chip];
    }
    case 4:
      return coluna(Math.min(MAX.beneficios, t.beneficios?.length ?? 0), 40, 2);
    case 5: {
      // Ficha ancorada embaixo: título + n linhas (rótulo e valor, 1 linha cada; valor longo é da Task 12).
      const n = Math.min(MAX.specs, t.specs?.length ?? 0);
      const linha = altura(CORPO, 1);
      const topo = FIM - (altura(TITULO, 1) + 24 + n * linha + Math.max(0, n - 1) * 20);
      const rows = Array.from({ length: n }, (_, i) => {
        const y = topo + altura(TITULO, 1) + 24 + i * (linha + 20);
        return [caixa(X, y, 400, CORPO, 1), caixa(500, y, 628, CORPO, 1)];
      }).flat();
      return [caixa(X, topo, LARGURA, TITULO, 1), ...rows];
    }
    case 6: // título em 1 linha: 4 etapas de 3 linhas só cabem assim
      return coluna(Math.min(MAX.etapas, t.etapas?.length ?? 0), 30, 1);
    case 7: {
      // Duas lupas de 408 px (recortes da referência) em y 700–1108; legenda de até 2 linhas embaixo de cada uma.
      const legs = Math.min(2, t.legendas?.length ?? 0);
      return [
        caixa(X, TOPO, LARGURA, TITULO, 2),
        ...Array.from({ length: legs }, (_, i) => caixa(i ? 648 : X, 1130, 480, CORPO, 2)),
      ];
    }
    default:
      return [];
  }
}

/**
 * Dois recortes quadrados da referência (px da referência) para lupas/detalhes: terço da menor dimensão,
 * um na parte de cima e outro na de baixo, centrados na horizontal. Sem gerador (R3.3).
 */
export function recortesDetalhe(refW: number, refH: number): Array<{ x: number; y: number; w: number; h: number }> {
  const lado = Math.max(1, Math.floor(Math.min(refW, refH) / 3));
  return [0.35, 0.7].map((fy) => ({
    x: Math.floor((refW - lado) / 2), y: Math.floor((refH - lado) * fy), w: lado, h: lado,
  }));
}

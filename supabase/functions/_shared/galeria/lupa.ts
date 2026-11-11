// Lupa pela caixa do produto (adendo 11/11, plano `2026-11-11-galeria-lupa-pela-caixa.md`). A visão só LOCALIZA
// (`detalhes.ts` grava as caixas na referência `frente`); o recorte é sempre feito por código sobre a foto real (R3.3).
// Puro e sem imports: a edge (gerar, aprovar, imagens, fatos) e o front (`compor.ts`) usam esta mesma geometria.

/** Caixa em frações 0..1 da referência (x, y = canto superior esquerdo). */
export interface CaixaNorm { x: number; y: number; w: number; h: number }
/** Quadrado em px da referência. */
export interface Quadrado { x: number; y: number; w: number; h: number }

/** Leitura gravada em `galeria_referencias.detalhes`. `falhou` relê (após `RELER_FALHOU_MS`); `sem_detalhe` é definitivo. */
export type DetalhesLupa =
  | { estado: 'falhou'; versao: string; tentado_em: string }
  | { estado: 'sem_detalhe'; versao: string; tentado_em: string; motivo?: string }
  | {
    estado: 'ok'; versao: string; tentado_em: string; produto: CaixaNorm; detalhes: CaixaNorm[];
    ref_w: number; ref_h: number; hash: string;
  };

/** Missões que levam lupa/recorte da referência. NÃO é `MISSOES_LUPA_PENDENTE` (trava até o portão da Task 16). */
export const MISSOES_COM_LUPA: { geral: readonly number[]; moda: readonly number[] } = { geral: [3, 7], moda: [5, 7] };
export const comLupa = (missao: number, moda: boolean): boolean =>
  (moda ? MISSOES_COM_LUPA.moda : MISSOES_COM_LUPA.geral).includes(missao);

/** Lado mínimo do recorte em px da referência: Moda vira imagem inteira 1200×1200; geral, lupa de 340–408 px. */
export const LADO_MINIMO = { geral: 300, moda: 600 } as const;

/** Quais detalhes (índices) cada missão usa: Moda 5 ≠ Moda 7 (nunca a mesma caixa). */
function indices(missao: number, moda: boolean): number[] {
  if (moda) return missao === 5 ? [0] : missao === 7 ? [0, 1] : [];
  return missao === 3 ? [0] : missao === 7 ? [0, 1] : [];
}

const sobrepoe = (a: Quadrado, b: Quadrado) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Quadrados (px da referência) da missão, todos contidos na caixa `produto`; null = não cabe (nunca recorte de fundo).
 * Lado = max(lado da caixa `detalhe`, mínimo), centrado no detalhe e deslocado para caber em `produto`; não cabe se
 * passar do menor lado de `produto`. Missão 7 (geral e Moda): os dois quadrados não se sobrepõem. Moda 7 devolve
 * só o 2º (o 1º é a Moda 5). Missão sem lupa → [].
 */
export function recortesLupa(
  refW: number, refH: number, d: { produto: CaixaNorm; detalhes: CaixaNorm[] }, missao: number, moda: boolean,
): Quadrado[] | null {
  const usa = indices(missao, moda);
  if (usa.length === 0) return [];
  if (!(refW > 0 && refH > 0) || usa.some((i) => !d.detalhes[i])) return null;
  const p0x = Math.ceil(d.produto.x * refW);
  const p0y = Math.ceil(d.produto.y * refH);
  const p1x = Math.floor((d.produto.x + d.produto.w) * refW);
  const p1y = Math.floor((d.produto.y + d.produto.h) * refH);
  const cabe = Math.min(p1x - p0x, p1y - p0y);
  const minimo = moda ? LADO_MINIMO.moda : LADO_MINIMO.geral;
  const quadrados: Quadrado[] = [];
  for (const i of usa) {
    const c = d.detalhes[i];
    const lado = Math.max(Math.ceil(Math.max(c.w * refW, c.h * refH)), minimo);
    if (lado > cabe) return null;
    const cx = (c.x + c.w / 2) * refW;
    const cy = (c.y + c.h / 2) * refH;
    const x = Math.min(Math.max(Math.round(cx - lado / 2), p0x), p1x - lado);
    const y = Math.min(Math.max(Math.round(cy - lado / 2), p0y), p1y - lado);
    quadrados.push({ x, y, w: lado, h: lado });
  }
  if (quadrados.length === 2 && sobrepoe(quadrados[0], quadrados[1])) return null;
  return moda && missao === 7 ? [quadrados[1]] : quadrados;
}

/**
 * Situação da lupa de uma (cor, missão) pela leitura da referência `frente` vigente:
 * `ok` | `lendo` (nunca lida, `falhou` ou versão antiga: retentável) | `indisponivel` (`sem_detalhe` ou não cabe).
 * Missão sem lupa → `ok`. `versaoAtual` vem da edge (modelo de visão + prompt).
 */
export function situacaoLupa(
  d: DetalhesLupa | null | undefined, missao: number, moda: boolean, versaoAtual: string,
): 'ok' | 'lendo' | 'indisponivel' {
  if (!comLupa(missao, moda)) return 'ok';
  if (!d || d.estado === 'falhou' || d.versao !== versaoAtual) return 'lendo';
  if (d.estado === 'sem_detalhe') return 'indisponivel';
  return recortesLupa(d.ref_w, d.ref_h, d, missao, moda) ? 'ok' : 'indisponivel';
}

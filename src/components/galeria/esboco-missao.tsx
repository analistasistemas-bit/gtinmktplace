// Galeria IA: miniatura cinza do layout de cada imagem (onde fica o texto e o produto), como no protótipo aprovado.
import type { ReactElement } from 'react';

const forte = 'fill-foreground/45';
const fraco = 'fill-foreground/20';
const produto = 'fill-primary/45';

const R = (x: number, y: number, w: number, h: number, c: string, rx = 2) => <rect key={`${x}-${y}-${c}`} x={x} y={y} width={w} height={h} rx={rx} className={c} />;

const GERAL: Record<number, ReactElement[]> = {
  1: [R(25, 22, 50, 56, produto, 25)],
  2: [R(10, 12, 52, 8, forte), R(10, 25, 38, 5, fraco), R(44, 40, 46, 48, produto, 23)],
  3: [R(14, 26, 44, 52, produto, 22), <circle key="c" cx="66" cy="38" r="20" className="fill-none stroke-foreground/35" strokeWidth="2" />,
    <path key="p" d="M80 52 l10 10" className="stroke-foreground/35" strokeWidth="2" />, R(56, 32, 20, 12, fraco)],
  4: [R(10, 10, 56, 8, forte), ...[30, 46, 62].flatMap((y) => [<circle key={`b${y}`} cx="14" cy={y + 2} r="3" className={forte} />, R(21, y, 30, 5, fraco)]),
    R(58, 34, 34, 44, produto, 17)],
  5: [R(10, 10, 44, 8, forte), R(66, 8, 24, 24, produto, 12), ...[38, 52, 66, 80].flatMap((y) => [R(10, y, 26, 5, fraco), R(44, y, 40, 5, forte)])],
  6: [R(10, 10, 44, 8, forte), ...[10, 38, 66].flatMap((x) => [R(x, 40, 24, 24, fraco, 3), R(x, 70, 24, 4, fraco)])],
  7: [R(10, 10, 38, 38, fraco, 4), R(52, 10, 38, 38, fraco, 4), R(10, 52, 38, 38, fraco, 4), R(52, 52, 38, 38, produto, 4)],
};
// Moda não leva texto: produto inteiro (1-4, 6) ou recorte de detalhe (5, 7).
const MODA: Record<number, ReactElement[]> = { 5: GERAL[7], 7: GERAL[3] };

/** `compacto` = imagem indisponível (Em breve): miniatura pequena, para não ocupar uma linha inteira. */
export function EsbocoMissao({ missao, moda, apagado, compacto }: { missao: number; moda: boolean; apagado?: boolean; compacto?: boolean }) {
  const formas = (moda ? MODA[missao] : undefined) ?? (moda ? GERAL[1] : GERAL[missao]) ?? GERAL[1];
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`block aspect-square rounded-lg bg-muted ${compacto ? 'mx-auto size-14' : 'w-full'} ${apagado ? 'opacity-45' : ''}`}>
      {formas}
    </svg>
  );
}

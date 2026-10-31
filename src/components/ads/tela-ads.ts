/**
 * Acabamento local das telas de Ads (QA visual 2026-10-31): vale para tudo que está dentro do elemento que recebe
 * a classe, sem tocar nos componentes globais de `ui/`. As classes são literais para o Tailwind enxergá-las.
 *
 * - Foco: anel de 2 px na cor `--ring` com respiro de 2 px (contraste >= 3:1 sobre claro e escuro). O anel global
 *   (`ring-ring/50`, ~2:1) some em botões ghost.
 * - Pills: o texto tonal (`text-success` etc.) sobre o fundo a 10% ficava entre 4,30 e 4,45:1; misturar 30% do
 *   texto principal leva a >= 4,5:1 nos dois temas.
 * - Alvos de toque: `max-sm:` (tela estreita) ou `pointer-coarse:` (toque, inclusive paisagem) sobem para 44 px;
 *   o breakpoint `sm:` sozinho voltava a 32 px em celular na horizontal.
 */
export const TELA_ADS = [
  '[&_:is(button,a,input,[role=tab],[role=combobox]):focus-visible]:ring-2',
  '[&_:is(button,a,input,[role=tab],[role=combobox]):focus-visible]:ring-ring',
  '[&_:is(button,a,input,[role=tab],[role=combobox]):focus-visible]:ring-offset-2',
  '[&_:is(button,a,input,[role=tab],[role=combobox]):focus-visible]:ring-offset-background',
  '[&_[data-tone=success]]:[color:color-mix(in_oklch,var(--success),var(--foreground)_30%)]',
  '[&_[data-tone=warning]]:[color:color-mix(in_oklch,var(--warning),var(--foreground)_30%)]',
  '[&_[data-tone=danger]]:[color:color-mix(in_oklch,var(--danger),var(--foreground)_30%)]',
  '[&_[data-tone=info]]:[color:color-mix(in_oklch,var(--info),var(--foreground)_30%)]',
  '[&_[data-tone=neutral]]:[color:color-mix(in_oklch,var(--muted-foreground),var(--foreground)_30%)]',
  'max-sm:[&_button[aria-label^="O_que_é"]]:p-[15px]',
  'max-sm:[&_button[aria-label^="O_que_é"]]:-m-[15px]',
  'pointer-coarse:[&_button[aria-label^="O_que_é"]]:p-[15px]',
  'pointer-coarse:[&_button[aria-label^="O_que_é"]]:-m-[15px]',
].join(' ');

/** Botão/segmento selecionado: no escuro o indigo claro (3,38:1 com texto branco) usa o tom do tema claro. */
export const ATIVO_ESCURO = 'dark:bg-[oklch(0.55_0.2_277)] dark:text-white dark:hover:bg-[oklch(0.5_0.2_277)]';

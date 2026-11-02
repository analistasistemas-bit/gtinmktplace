// Mini-bloco da busca (ADR-0189, emenda 2026-11-02): bloco curto dentro de CADA card da busca do ML, com dados locais
// (vendedor observado, sinais, volume mínimo) e, quando há, Meu anúncio e Minha margem. Shadow DOM fechado: isola o
// estilo e não deixa scripts da página lerem a margem com facilidade (não é garantia absoluta de sigilo).
// `card` é a leitura DESTE card no DOM (lerCard): vendedor, sinais, posição, patrocínio, preço e vendidos são dele, e a
// margem só aparece se foi calculada a esse mesmo preço.
import type { MetadadosCardBusca, ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import { volumeMinimoAoPrecoAtual } from '../compartilhado/volume-minimo';
import { HOST_PUBLIAI, type CardBusca } from '../leitura/busca';
import { MARCA } from './aparencia';
import { seloDaBusca, type LinhaDaMargem } from './selo-busca';

export const HOST_MINI_BLOCO = HOST_PUBLIAI;

const brl = (centavos: number) => `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Tokens do app (src/index.css, tema claro: a página do ML é clara). Texto de cor = matiz misturado com preto em oklab
// (oklch puxa para vermelho), contraste ≥ 4,5:1 sobre o fundo do bloco e dos chips.
const CSS = `
:host{all:initial;display:block;margin:6px 0 4px}
.b{--chart-1:oklch(0.55 0.20 277);--chart-2:oklch(0.58 0.21 300);--chart-3:oklch(0.70 0.12 190);--chart-4:oklch(0.76 0.15 75);
  --chart-5:oklch(0.63 0.20 12);--success:oklch(0.51 0.15 150);--destructive:oklch(0.545 0.22 25);--warning:oklch(0.53 0.16 75);
  --brand-gradient:linear-gradient(180deg,oklch(0.56 0.21 277),oklch(0.585 0.21 300));
  --texto:oklch(0.30 0.02 277);--suave:oklch(0.45 0.02 277);
  position:relative;box-sizing:border-box;display:grid;gap:2px;padding:5px 8px 5px 11px;border-radius:8px;
  background:oklch(0.985 0.006 277);border:1px solid color-mix(in oklab,var(--chart-1) 16%,white);color:var(--texto);
  font:400 12px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;overflow:hidden}
.b::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--brand-gradient)}
.l{display:flex;flex-wrap:wrap;align-items:center;gap:3px 6px;min-width:0;overflow-wrap:anywhere}
svg{width:13px;height:13px;flex:none}
.v{color:var(--suave)}
.c{--c:var(--chart-1);display:inline-block;padding:0 6px;border-radius:999px;font-weight:600;font-size:11.5px;line-height:17px;
  color:color-mix(in oklab,var(--c) 70%,black);background:color-mix(in oklab,var(--c) 13%,white)}
.c.catalogo{background:transparent;padding-inline:2px}
.t{color:color-mix(in oklab,var(--c) 72%,black);font-weight:600}
b{font-weight:650;color:var(--texto)}
.ambar{--c:var(--chart-4)}.cyan{--c:var(--chart-3)}.violeta{--c:var(--chart-2)}.rosa{--c:var(--chart-5)}.roxo{--c:var(--chart-1)}
.lucro{--c:var(--success)}.prejuizo{--c:var(--destructive)}.aguardando{--c:var(--warning)}.neutro{--c:var(--suave)}
`;

function el(tag: string, classe: string, texto?: string): HTMLElement {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function linha(...filhos: HTMLElement[]): HTMLElement {
  const l = el('div', 'l');
  l.append(...filhos);
  return l;
}

/** Texto da margem desta ocorrência; null = nada a mostrar (sem vínculo, ou margem de outro preço). */
function margemDaOcorrencia(
  metadados: MetadadosCardBusca | undefined, margem: ResultadoCard | undefined, preco: number | null,
): LinhaDaMargem | null {
  if (margem?.estado === 'ok' && (preco === null || margem.margem?.preco !== preco)) return null;
  if (!margem && metadados?.vinculo) return { rotulo: 'Minha margem · calculando', valor: null, tom: 'aguardando', titulo: `SKU ${metadados.vinculo.codigo}: a margem chega em instantes.` };
  return seloDaBusca(margem);
}

export function renderizarMiniBlocoDaBusca(
  card: CardBusca,
  metadados: MetadadosCardBusca | undefined,
  margem: ResultadoCard | undefined,
): HTMLElement {
  const oc = card.ocorrencias[0] ?? { posicao: card.posicao, patrocinado: card.patrocinado, preco: card.preco, vendidosTexto: card.vendidosTexto };
  const host = document.createElement('div');
  host.className = HOST_MINI_BLOCO;
  const raiz = host.attachShadow({ mode: 'closed' });
  raiz.innerHTML = `<style>${CSS}</style><div class="b" role="note" aria-label="PubliAI"><div class="l">${MARCA}</div></div>`;
  const bloco = raiz.querySelector('.b')!;

  // 1. Vendedor observado + sinais explícitos do card (cor sempre com texto).
  const topo = bloco.querySelector('.l') as HTMLElement;
  topo.append(card.vendedor ? el('span', 'v', card.vendedor) : el('span', 'v', 'Vendedor não informado'));
  if (card.full) topo.append(el('span', 'c cyan', 'Full'));
  if (card.freteGratis) topo.append(el('span', 'c cyan', 'Frete grátis'));
  if (card.lojaOficial) topo.append(el('span', 'c ambar', 'Loja oficial'));
  if (card.catalogProductId) topo.append(el('span', 'c violeta catalogo', 'Catálogo'));
  if (oc.patrocinado) topo.append(el('span', 'c rosa', 'Patrocinado'));

  // 2. Volume mínimo ao preço atual: piso e preço da MESMA ocorrência.
  const volume = volumeMinimoAoPrecoAtual(oc.vendidosTexto, oc.preco);
  if (volume !== null) {
    const l = linha(el('span', 'v', 'Volume mínimo ao preço atual'), el('b', '', brl(volume)));
    l.title = `Piso de "${oc.vendidosTexto}" × preço atual. Não é faturamento: as vendas foram a outros preços.`;
    bloco.append(l);
  }

  // 3. Meu anúncio nesta busca (proprio null = verificação indisponível: nada conclusivo).
  if (metadados?.proprio === true) {
    const pos = oc.posicao ? `posição ${oc.posicao}` : 'posição não informada';
    bloco.append(linha(el('span', 't roxo', `Meu anúncio · ${pos} · ${oc.patrocinado ? 'patrocinado' : 'orgânico'}`)));
  }

  // 4. Minha margem (simulação Clássico) ou o estado dela.
  const m = margemDaOcorrencia(metadados, margem, oc.preco);
  if (m) {
    // Rótulo roxo (identidade), valor no tom do resultado; sem valor o rótulo leva o estado (aguardando = warning).
    const l = linha(el('span', `t ${m.valor !== null ? 'roxo' : m.tom === 'aguardando' ? 'aguardando' : 'neutro'}`, m.rotulo));
    if (m.valor !== null) l.append(' ', el('b', `t ${m.tom}`, m.valor));
    l.title = m.titulo;
    bloco.append(l);
  }
  return host;
}

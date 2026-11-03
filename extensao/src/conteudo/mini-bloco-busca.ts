// Mini-bloco da busca (ADR-0189, emenda 2026-11-02): bloco curto dentro de CADA card da busca do ML, com dados locais
// (vendedor observado, sinais, giro mínimo) e, quando há, Meu anúncio e Minha margem. Shadow DOM fechado: isola o
// estilo e não deixa scripts da página lerem a margem com facilidade (não é garantia absoluta de sigilo).
// `card` é a leitura DESTE card no DOM (lerCard): vendedor, sinais, posição, patrocínio, preço e vendidos são dele, e a
// margem só aparece se foi calculada a esse mesmo preço.
import type { MetadadosCardBusca, ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import { volumeMinimoAoPrecoAtual } from '../compartilhado/volume-minimo';
import { HOST_PUBLIAI, type CardBusca } from '../leitura/busca';
import { MARCA } from './aparencia';
import { seloDaBusca, type LinhaDaMargem } from './selo-busca';
import { idadeDoCatalogo, NOME_MEDALHA, NOME_TIPO, valorDaComissao, type VistaCard } from '../compartilhado/enriquecimento';

export const HOST_MINI_BLOCO = HOST_PUBLIAI;

const GIRO = 'Piso de vendidos de cada produto × o preço atual do card. Serve para comparar o tamanho dos produtos entre si. Não é faturamento nem o valor realmente vendido: as vendas aconteceram a outros preços e o Mercado Livre só informa a faixa.';
const COMISSAO = 'Tarifa de venda que o Mercado Livre cobraria na sua conta para este tipo de anúncio, nesta categoria e a este preço. Não inclui frete nem imposto.';
const VENDEDORES = 'Quantos vendedores diferentes têm oferta neste catálogo, na leitura feita agora. "≥" quando o Mercado Livre não devolveu todas as ofertas ou alguma veio sem vendedor.';
const ESPERA = { dados: 'Aguardando dados do catálogo', janela: 'Aguardando próxima janela', falha: 'Catálogo não lido · Tentar novamente no painel' } as const;
const pctBr = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
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
.g{display:inline-flex;gap:4px;align-items:baseline;white-space:nowrap}
.i{all:unset;box-sizing:border-box;color:var(--suave);cursor:pointer;font-size:12px;line-height:1;padding:1px 2px;border-radius:4px}
.i:focus-visible{outline:2px solid var(--chart-1);outline-offset:1px}
.a{color:var(--suave);font-size:11.5px;line-height:1.35}
b{font-weight:650;color:var(--texto)}
.idade.recente{--c:var(--success)}.idade.medio{--c:var(--warning)}.idade.antigo{--c:var(--suave)}
.ambar{--c:var(--chart-4)}.cyan{--c:var(--chart-3)}.violeta{--c:var(--chart-2)}.rosa{--c:var(--chart-5)}.roxo{--c:var(--chart-1)}
.lucro{--c:var(--success)}.prejuizo{--c:var(--destructive)}.aguardando{--c:var(--warning)}.neutro{--c:var(--suave)}
`;

function el(tag: string, classe: string, texto?: string): HTMLElement {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function linha(...filhos: (HTMLElement | string)[]): HTMLElement {
  const l = el('div', 'l');
  l.append(...filhos);
  return l;
}

/** Rótulo com ⓘ: o botão abre/fecha a explicação logo abaixo da linha. Dentro do card do ML (um link): o clique não
 *  navega nem sobe até o card. */
function comAjuda(rotulo: HTMLElement, nome: string, texto: string): { rotulo: HTMLElement; ligar: (l: HTMLElement) => void } {
  const i = el('button', 'i', 'ⓘ') as HTMLButtonElement;
  i.type = 'button';
  i.setAttribute('aria-label', `O que é ${nome}?`);
  i.setAttribute('aria-expanded', 'false');
  const g = el('span', 'g');
  g.append(rotulo, i);
  const ajuda = el('div', 'a', texto);
  return {
    rotulo: g,
    ligar: (l) => i.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const aberto = i.getAttribute('aria-expanded') !== 'true';
      i.setAttribute('aria-expanded', String(aberto));
      if (aberto) l.after(ajuda); else ajuda.remove();
    }),
  };
}

/** Texto da margem desta ocorrência; null = nada a mostrar (sem vínculo, ou margem de outro preço). */
function margemDaOcorrencia(
  metadados: MetadadosCardBusca | undefined, margem: ResultadoCard | undefined, preco: number | null, precoDoCard: number | null,
): LinhaDaMargem | null {
  if (margem?.estado === 'ok' && (preco === null || margem.margem?.preco !== preco)) return null;
  // Limite, sem categoria e indisponível também são do preço analisado (o do card agregado): outra aparição não os herda.
  if ((margem?.estado === 'limite' || margem?.estado === 'sem_categoria' || margem?.estado === 'indisponivel') && (preco === null || preco !== precoDoCard)) return null;
  if (!margem && metadados?.vinculo) return { rotulo: 'Minha margem · calculando', valor: null, tom: 'aguardando', titulo: `SKU ${metadados.vinculo.codigo}: a margem chega em instantes.` };
  return seloDaBusca(margem);
}

export function renderizarMiniBlocoDaBusca(
  card: CardBusca,
  metadados: MetadadosCardBusca | undefined,
  margem: ResultadoCard | undefined,
  /** Preço em que o item foi (ou seria) analisado: o 1º preço do item na busca (= `preco` do card agregado no SW). */
  precoAnalisado: number | null = card.preco,
  /** Catálogo enriquecido deste card (vistaDoCard); null/ausente = card sem catálogo: só dados da página. */
  vista: VistaCard = null,
  agora = Date.now(),
): HTMLElement {
  const oc = card.ocorrencias[0] ?? { posicao: card.posicao, patrocinado: card.patrocinado, preco: card.preco, vendidosTexto: card.vendidosTexto };
  const host = document.createElement('div');
  host.className = HOST_MINI_BLOCO;
  // O título do card do ML estica o link sobre o card inteiro (`a.poly-component__title::before`, inset 0, z-index 1;
  // medido 02/11). Sem subir o host, o ⓘ não recebe hover nem clique e o clique abre o anúncio.
  host.style.position = 'relative';
  host.style.zIndex = '2';
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
  // Perfil do vendedor da oferta exata (medalha ausente/desconhecida fica de fora: nunca presumida).
  const exata = vista?.exata;
  if (exata?.estado === 'ok' && exata.sellerId !== null) {
    const v = vista!.vendedor;
    if (v?.estado === 'ok') {
      if (v.medalha) topo.append(el('span', `c ${v.medalha === 'sem' ? 'neutro' : 'ambar'}`, NOME_MEDALHA[v.medalha]));
      if (v.uf) topo.append(el('span', 'v', v.uf));
    } else topo.append(el('span', 'v', 'Perfil não carregado'));
  }

  // 2. Giro mínimo ao preço atual: piso e preço da MESMA ocorrência.
  const volume = volumeMinimoAoPrecoAtual(oc.vendidosTexto, oc.preco);
  if (volume !== null) {
    const a = comAjuda(el('span', 'v', 'Giro mínimo ao preço atual'), 'giro mínimo', GIRO);
    const l = linha(a.rotulo, el('b', '', brl(volume)));
    l.title = `Piso de "${oc.vendidosTexto}" × preço atual. Não é faturamento: as vendas foram a outros preços.`;
    bloco.append(l);
    a.ligar(l);
  }

  // 2b. Catálogo enriquecido: oferta exata (tipo + comissão na sua conta) e catálogo (vendedores + idade).
  if (vista) {
    if (vista.espera) bloco.append(linha(el('span', `t ${vista.espera === 'dados' || vista.espera === 'janela' ? 'aguardando' : 'neutro'}`, vista.motivo ?? ESPERA[vista.espera as keyof typeof ESPERA])));
    if (exata?.estado === 'nao_encontrada') bloco.append(linha(el('span', 'v', 'Oferta não localizada nesta leitura')));
    else if (exata?.estado === 'ok') {
      const l = linha(el('span', 't roxo', exata.tipo ? NOME_TIPO[exata.tipo] : 'Tipo não confirmado'));
      // A comissão é do preço enviado: outra aparição do item com outro preço não a herda.
      if (oc.preco === exata.preco) {
        const c = exata.comissao;
        const a = comAjuda(el('span', 'v', 'Comissão na sua conta'), 'Comissão na sua conta', COMISSAO);
        l.append(a.rotulo);
        if (c.estado === 'ok') l.append(el('b', '', `R$ ${valorDaComissao(c.valor, exata.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pctBr(c.valor.percentual)})`));
        else l.append(el('span', `t ${c.estado === 'aguardando' ? 'aguardando' : 'neutro'}`, c.estado === 'aguardando' ? 'aguardando' : 'indisponível'));
        if (c.estado === 'indisponivel') l.title = c.motivo;
        a.ligar(l);
      }
      bloco.append(l);
    }
    const o = vista.ofertas;
    const idade = idadeDoCatalogo(vista.criadoEm, agora);
    if (o || idade) {
      const l = linha();
      if (o) {
        const n = o.vendedoresIdentificados;
        const texto = !o.completa && n === 0 ? 'Vendedores não identificados'
          : `${o.completa ? '' : '≥ '}${n} ${n === 1 ? 'vendedor' : 'vendedores'} no catálogo`;
        const a = comAjuda(el('b', '', texto), 'vendedores no catálogo', VENDEDORES);
        l.append(a.rotulo);
        if (!o.completa) l.append(el('span', 'c aguardando', 'Leitura parcial'));
        a.ligar(l);
      }
      if (idade) l.append(el('span', `c idade ${idade.tom}`, `catálogo criado há ${idade.dias} ${idade.dias === 1 ? 'dia' : 'dias'}`));
      bloco.append(l);
    }
  }

  // 3. Meu anúncio nesta busca (proprio null = verificação indisponível: nada conclusivo).
  if (metadados?.proprio === true) {
    const pos = oc.posicao ? `posição ${oc.posicao}` : 'posição não informada';
    bloco.append(linha(el('span', 't roxo', `Meu anúncio · ${pos} · ${oc.patrocinado ? 'patrocinado' : 'orgânico'}`)));
  }

  // 4. Minha margem (simulação Clássico) ou o estado dela.
  const m = margemDaOcorrencia(metadados, margem, oc.preco, precoAnalisado);
  if (m) {
    // Rótulo roxo (identidade), valor no tom do resultado; sem valor o rótulo leva o estado (aguardando = warning).
    const l = linha(el('span', `t ${m.valor !== null ? 'roxo' : m.tom === 'aguardando' ? 'aguardando' : 'neutro'}`, m.rotulo));
    if (m.valor !== null) l.append(' ', el('b', `t ${m.tom}`, m.valor));
    l.title = m.titulo;
    bloco.append(l);
  }
  return host;
}

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

const GIRO = 'Piso de vendidos de cada produto × o preço atual do card. Serve para comparar o tamanho dos produtos entre si. Não é faturamento nem o valor realmente vendido: as vendas aconteceram a outros preços e o Mercado Livre só informa a faixa. Valor arredondado aqui; o painel mostra o valor completo.';
const COMISSAO = 'Tarifa de venda que o Mercado Livre cobraria na sua conta para este tipo de anúncio, nesta categoria e a este preço. Não inclui frete nem imposto.';
const VENDEDORES = 'Quantos vendedores diferentes têm oferta neste catálogo, na leitura feita agora. "N+" = leitura parcial: o Mercado Livre não devolveu todas as ofertas ou alguma veio sem vendedor, então há pelo menos N.';
const PARCIAL = 'O Mercado Livre limitou as consultas, o tempo acabou ou a conexão falhou nesta leitura. O que já chegou continua aqui; nada foi presumido. Use "Tentar novamente" no painel do PubliAI.';
const CONSULTANDO = 'Consultando dados do catálogo';
const ADICIONAIS = 'Dados adicionais indisponíveis agora';
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
  position:relative;box-sizing:border-box;display:grid;gap:1px;padding:4px 6px 4px 9px;border-radius:8px;
  background:oklch(0.985 0.006 277);border:1px solid color-mix(in oklab,var(--chart-1) 16%,white);color:var(--texto);
  font:400 12px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;overflow:hidden}
.b::before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--brand-gradient)}
.l{display:flex;flex-wrap:wrap;align-items:center;gap:1px 3px;min-width:0;overflow-wrap:anywhere}
.k{display:flex;align-items:center;gap:3px;min-width:0;flex:0 1 auto}
.pq{font-size:11px;letter-spacing:-0.005em}
.n{flex:0 1 auto;min-width:2.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.um .c,.f{flex:none;white-space:nowrap}
.med{font-weight:650;color:color-mix(in oklab,var(--chart-4) 50%,black)}
svg{width:13px;height:13px;flex:none}
.v{color:var(--suave)}
.c{--c:var(--chart-1);display:inline-block;padding:0 6px;border-radius:999px;font-weight:600;font-size:11px;line-height:16px;
  color:color-mix(in oklab,var(--c) 70%,black);background:color-mix(in oklab,var(--c) 13%,white)}
.t{color:color-mix(in oklab,var(--c) 72%,black);font-weight:600}
.g{display:inline-flex;gap:3px;align-items:baseline;white-space:nowrap}
.i{all:unset;box-sizing:border-box;color:var(--suave);cursor:pointer;font-size:12px;line-height:1;padding:1px;border-radius:4px}
.i:focus-visible{outline:2px solid var(--chart-1);outline-offset:1px}
.a{color:var(--suave);font-size:11px;line-height:1.3}
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

/** Texto longo de estado (neutro) em dois trechos: o ⓘ prende só o último (2 palavras), o resto quebra livre — com
 *  zoom ou card estreito a linha nunca é cortada. */
function quebravel(texto: string): (HTMLElement | string)[] {
  const p = texto.split(' ');
  // O espaço entre os trechos é só texto (no flex, espaço solto não ocupa lugar; o gap separa).
  return [el('span', 't neutro', p.slice(0, -2).join(' ')), ' ', el('span', 't neutro', p.slice(-2).join(' '))];
}

/** ⓘ no fim da linha: abre/fecha a explicação logo abaixo dela. Dentro do card do ML (um link): o clique não navega
 *  nem sobe até o card. Botão de verdade: foco e Enter/Espaço pelo teclado. */
function ajuda(l: HTMLElement, nome: string, texto: string): void {
  const i = el('button', 'i', 'ⓘ') as HTMLButtonElement;
  i.type = 'button';
  i.setAttribute('aria-label', `O que é ${nome}?`);
  i.setAttribute('aria-expanded', 'false');
  const a = el('div', 'a', texto);
  i.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const aberto = i.getAttribute('aria-expanded') !== 'true';
    i.setAttribute('aria-expanded', String(aberto));
    if (aberto) l.after(a); else a.remove();
  });
  // ⓘ preso ao último trecho da linha: nunca quebra sozinho para uma linha nova.
  const g = el('span', 'g');
  const ultimo = l.lastElementChild;
  if (ultimo) g.append(ultimo);
  g.append(i);
  l.append(g);
}

/** Moeda compacta do Mini-bloco (o painel mostra o valor completo): R$ 950 · R$ 209 mil · R$ 4,4 mi (1 casa, sem ",0"). */
export function brlCompacto(reais: number): string {
  const [v, sufixo] = reais >= 1e6 ? [reais / 1e6, ' mi'] : reais >= 1e3 ? [reais / 1e3, ' mil'] : [reais, ''];
  const r = sufixo ? Math.round(v * 10) / 10 : Math.round(v);
  return `R$ ${r.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${sufixo}`;
}

/** Texto da margem desta ocorrência; null = nada a mostrar (sem vínculo, ou margem de outro preço). */
function margemDaOcorrencia(
  metadados: MetadadosCardBusca | undefined, margem: ResultadoCard | undefined, preco: number | null, precoDoCard: number | null,
): LinhaDaMargem | null {
  if (margem?.estado === 'ok' && (preco === null || margem.margem?.preco !== preco)) return null;
  // Limite, sem categoria e indisponível também são do preço analisado (o do card agregado): outra aparição não os herda.
  if ((margem?.estado === 'limite' || margem?.estado === 'sem_categoria' || margem?.estado === 'indisponivel') && (preco === null || preco !== precoDoCard)) return null;
  if (!margem && metadados?.vinculo && preco !== null && preco === precoDoCard) return { rotulo: 'Minha margem · calculando', valor: null, tom: 'aguardando', titulo: `SKU ${metadados.vinculo.codigo}: a margem chega em instantes.` };
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
  raiz.innerHTML = `<style>${CSS}</style><div class="b" role="note" aria-label="PubliAI"><div class="l um"><div class="k">${MARCA}</div></div></div>`;
  const bloco = raiz.querySelector('.b')!;
  const exata = vista?.exata;

  // 1. Uma linha: vendedor · medalha · UF (perfil da oferta exata; medalha desconhecida fica de fora) + selos que o
  // card do ML não deixa claros por si (Loja oficial, Patrocinado). Full, frete e "Catálogo" já aparecem no card / na
  // linha do catálogo. Nome longo é cortado com reticências (completo no title).
  // Marca + nome + medalha + UF formam um grupo (.k) que só encolhe pelo nome; os selos (chips) vão para uma 2ª linha
  // apenas quando não cabem — assim o nome não é cortado cedo demais.
  const grupo = bloco.querySelector('.k') as HTMLElement;
  const topo = bloco.querySelector('.l') as HTMLElement;
  // Só o nome encolhe (reticências); medalha e UF ficam sempre visíveis.
  const nome = el('span', 'v n', card.vendedor ?? 'Vendedor não informado');
  nome.title = nome.textContent ?? '';
  grupo.append(nome);
  if (exata?.estado === 'ok' && exata.sellerId !== null) {
    const v = vista!.vendedor;
    const extra = (classe: string, t: string) => { const f = el('span', 'v f', '· '); f.append(el('span', classe, t)); grupo.append(f); };
    if (v?.estado === 'ok') {
      if (v.medalha) extra(v.medalha === 'sem' ? 'v' : 'med', NOME_MEDALHA[v.medalha]);
      if (v.uf) extra('v', v.uf);
    } else extra('v', 'Perfil não carregado');
  }
  if (card.lojaOficial) topo.append(el('span', 'c ambar', 'Loja oficial'));
  if (oc.patrocinado) topo.append(el('span', 'c rosa', 'Patrocinado'));

  // 2. Oferta exata: tipo · comissão na sua conta (estado na mesma linha). Sem a oferta: processamento ou parcial terminal.
  const parcial = (motivo: string) => {
    const l = linha(...quebravel(ADICIONAIS));
    l.title = motivo;
    ajuda(l, 'dados adicionais indisponíveis', PARCIAL);
    bloco.append(l);
  };
  if (vista?.indisponivel && !exata) {
    bloco.append(linha(el('span', 't neutro', vista.indisponivel)));
  } else if (vista?.faltaOfertas) {
    bloco.append(linha(el('span', 't violeta', CONSULTANDO)));
  } else if (vista?.ofertasIndisponivel) {
    parcial(vista.ofertasIndisponivel);
  } else if (exata?.estado === 'indisponivel') {
    parcial(exata.motivo);
  } else if (exata?.estado === 'nao_encontrada') {
    bloco.append(linha(el('span', 'v', 'Oferta não localizada nesta leitura')));
  } else if (exata?.estado === 'ok') {
    const semTipo = !exata.tipo && exata.comissao.estado === 'indisponivel'; // sem tipo a comissão não tem como ser consultada
    // Tipo em chip (sem "·"): quebrando a linha, nenhum separador fica no começo ou no fim dela.
    const l = linha(exata.tipo ? el('span', 'c roxo', NOME_TIPO[exata.tipo]) : el('span', 't neutro', semTipo ? 'Tipo e comissão na sua conta não confirmados' : 'Tipo não confirmado'));
    bloco.append(l);
    if (semTipo && oc.preco === exata.preco) ajuda(l, 'comissão na sua conta', COMISSAO);
    // A comissão é do preço enviado: outra aparição do item com outro preço não a herda.
    else if (oc.preco === exata.preco) {
      const c = exata.comissao;
      if (c.estado === 'ok') {
        l.append(el('span', 'v', 'comissão na sua conta'), el('b', '', `R$ ${valorDaComissao(c.valor, exata.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pctBr(c.valor.percentual)})`));
        ajuda(l, 'comissão na sua conta', COMISSAO);
      } else {
        // Indisponível: linha própria (o texto é longo e quebraria no meio da do tipo).
        const lc = linha(...quebravel('Comissão na sua conta indisponível agora'));
        lc.title = c.motivo;
        ajuda(lc, 'comissão na sua conta', COMISSAO);
        bloco.append(lc);
      }
    }
  }

  // 3. Giro mínimo ao preço atual (piso e preço da MESMA ocorrência), compacto; o painel mostra o valor completo.
  const volume = volumeMinimoAoPrecoAtual(oc.vendidosTexto, oc.preco);
  if (volume !== null) {
    const l = linha(el('span', 'v', 'Giro mín.'), el('b', '', brlCompacto(volume / 100)));
    l.title = `Piso de "${oc.vendidosTexto}" × preço atual = ${brl(volume)}. Não é faturamento: as vendas foram a outros preços.`;
    ajuda(l, 'giro mínimo', GIRO);
    bloco.append(l);
  }

  // 4. Catálogo: vendedores (N+ = leitura parcial) · idade com semáforo (cor sempre com o texto "há D dias").
  const o = vista?.ofertas;
  const idade = vista ? idadeDoCatalogo(vista.criadoEm, agora) : null;
  // Ofertas lidas e metadados não: a idade em processamento ou indisponível (o que já chegou fica).
  const idadeEstado = !o || idade ? null : vista!.faltaProduto && !vista!.indisponivel ? 'consultando idade' : vista!.produtoIndisponivel ? 'idade indisponível agora' : null;
  if (o || idade) {
    const l = linha();
    l.classList.add('pq');
    if (o) {
      const n = o.vendedoresIdentificados;
      l.append(el('b', '', !o.completa && n === 0 ? 'vendedores não identificados' : `${n}${o.completa ? '' : '+'} ${n === 1 ? 'vendedor' : 'vendedores'}`));
    }
    if (idadeEstado) {
      const t = el('span', `t ${idadeEstado === 'consultando idade' ? 'violeta' : 'neutro'}`, idadeEstado);
      if (vista!.produtoIndisponivel) t.title = vista!.produtoIndisponivel;
      l.append(el('span', 'v', '·'), t);
    }
    if (idade) {
      if (o) l.append(el('span', 'v', '·'));
      const g = el('span', 'g');
      g.append(el('span', 'v', 'catálogo'), el('span', `t idade ${idade.tom}`, `há ${idade.dias} ${idade.dias === 1 ? 'dia' : 'dias'}`));
      l.append(g);
    }
    if (o) ajuda(l, 'vendedores no catálogo', VENDEDORES);
    bloco.append(l);
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

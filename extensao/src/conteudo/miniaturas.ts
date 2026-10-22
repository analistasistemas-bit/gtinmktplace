// Destaque das miniaturas abaixo de 1.200 px na galeria do ML (ADR-0189 D-10, Task 17).
// Casa a miniatura pelo id da foto como trecho delimitado da URL (medido em 22/10: `.ui-pdp-gallery__thumbnail img`,
// src `…/D_Q_NP_<id>-R.webp`); id fora do formato ou sem casamento → não marca (o painel lista as posições).
// Só `outline` (não muda o layout nem o tooltip do ML) e reversível: sai quando a sessão muda.
const MARCA = 'data-publiai-foto-fraca';
// = --warning do tema claro (painel.css): mesma "atenção" do cartão Qualidade; a página do ML é clara.
const ATENCAO = 'oklch(0.53 0.16 75)';
// Formato do id de foto do ML (ex.: 670304-MLB90067766444_082025, 923809-MLA95696729330_102025).
const ID_FOTO = /^\d{3,}-ML[A-Z]\d+_\d{6}$/;
const originais = new WeakMap<HTMLElement, { outline: string; outlineOffset: string }>();

export function destacarMiniaturas(doc: Document, ids: string[]): number {
  const validos = ids.filter((i) => ID_FOTO.test(i));
  if (validos.length === 0) return 0;
  let marcadas = 0;
  for (const img of doc.querySelectorAll<HTMLImageElement>('.ui-pdp-gallery__thumbnail img')) {
    const fontes = `${img.getAttribute('src') ?? ''} ${img.getAttribute('data-src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;
    const id = validos.find((i) => fontes.includes(`_${i}-`));
    const alvo = img.closest<HTMLElement>('.ui-pdp-gallery__thumbnail');
    if (!id || !alvo || alvo.hasAttribute(MARCA)) continue;
    originais.set(alvo, { outline: alvo.style.outline, outlineOffset: alvo.style.outlineOffset });
    alvo.setAttribute(MARCA, id);
    alvo.style.outline = `2px solid ${ATENCAO}`;
    alvo.style.outlineOffset = '-2px';
    marcadas++;
  }
  return marcadas;
}

/** Desfaz as marcas (troca de sessão/logout): devolve o estilo que a miniatura tinha. */
export function limparMiniaturas(doc: Document): void {
  for (const alvo of doc.querySelectorAll<HTMLElement>(`[${MARCA}]`)) {
    const o = originais.get(alvo);
    alvo.style.outline = o?.outline ?? '';
    alvo.style.outlineOffset = o?.outlineOffset ?? '';
    alvo.removeAttribute(MARCA);
  }
}

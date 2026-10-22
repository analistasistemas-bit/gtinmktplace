// Destaque das miniaturas abaixo de 1200 px na galeria do ML (ADR-0189 D-10, Task 17).
// Casa a miniatura pelo id da foto no src (medido em 22/10: `.ui-pdp-gallery__thumbnail img`, src com o id);
// sem casamento seguro, não marca (o painel lista as posições). `outline` não muda o layout da página.
const MARCA = 'data-publiai-foto-fraca';
// = --warning do tema claro (painel.css): mesma "atenção" do cartão Qualidade; a página do ML é clara.
const ATENCAO = 'oklch(0.53 0.16 75)';

export function destacarMiniaturas(doc: Document, ids: string[]): number {
  if (ids.length === 0) return 0;
  let marcadas = 0;
  for (const img of doc.querySelectorAll<HTMLImageElement>('.ui-pdp-gallery__thumbnail img')) {
    const fontes = `${img.getAttribute('src') ?? ''} ${img.getAttribute('data-src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;
    const id = ids.find((i) => fontes.includes(i));
    const alvo = img.closest<HTMLElement>('.ui-pdp-gallery__thumbnail');
    if (!id || !alvo || alvo.hasAttribute(MARCA)) continue;
    alvo.setAttribute(MARCA, id);
    alvo.title = 'PubliAI: foto abaixo de 1.200 px';
    alvo.style.outline = `2px solid ${ATENCAO}`;
    alvo.style.outlineOffset = '-2px';
    alvo.style.borderRadius = '6px';
    marcadas++;
  }
  return marcadas;
}

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { destacarMiniaturas } from '../miniaturas';

const galeria = () => {
  document.body.innerHTML = `
    <span class="ui-pdp-thumbnail ui-pdp-gallery__thumbnail"><img class="ui-pdp-image" src="https://http2.mlstatic.com/D_Q_NP_670304-MLB9-R.webp"></span>
    <span class="ui-pdp-thumbnail ui-pdp-gallery__thumbnail"><img class="ui-pdp-image" data-src="https://http2.mlstatic.com/D_Q_NP_222222-MLB9-R.webp"></span>
    <figure class="ui-pdp-gallery__figure"><img src="https://http2.mlstatic.com/D_NQ_NP_670304-MLB9-O.webp"></figure>`;
  return document;
};

describe('destacarMiniaturas', () => {
  it('marca só a miniatura da galeria cuja foto é fraca (nunca a imagem grande)', () => {
    const doc = galeria();
    expect(destacarMiniaturas(doc, ['670304-MLB9'])).toBe(1);
    const marcadas = doc.querySelectorAll('[data-publiai-foto-fraca]');
    expect(marcadas).toHaveLength(1);
    expect((marcadas[0] as HTMLElement).style.outline).toContain('2px solid');
    expect(doc.querySelector('figure')!.hasAttribute('data-publiai-foto-fraca')).toBe(false);
  });

  it('casa por data-src; sem id na página não marca; segunda chamada não duplica', () => {
    const doc = galeria();
    expect(destacarMiniaturas(doc, ['222222-MLB9', 'nao-existe'])).toBe(1);
    expect(destacarMiniaturas(doc, ['222222-MLB9'])).toBe(0);
    expect(destacarMiniaturas(doc, [])).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { destacarMiniaturas, limparMiniaturas } from '../miniaturas';

const A = '670304-MLB90067766444_082025';
const B = '222222-MLA95696729330_102025';
const galeria = () => {
  document.body.innerHTML = `
    <span class="ui-pdp-thumbnail ui-pdp-gallery__thumbnail" title="Foto 1" style="outline: 1px dotted blue"><img class="ui-pdp-image" src="https://http2.mlstatic.com/D_Q_NP_${A}-R.webp"></span>
    <span class="ui-pdp-thumbnail ui-pdp-gallery__thumbnail"><img class="ui-pdp-image" data-src="https://http2.mlstatic.com/D_Q_NP_${B}-R.webp"></span>
    <span class="ui-pdp-thumbnail ui-pdp-gallery__thumbnail"><img class="ui-pdp-image" src="https://http2.mlstatic.com/D_Q_NP_${A.replace('_082025', '9_082025')}-R.webp"></span>
    <figure class="ui-pdp-gallery__figure"><img src="https://http2.mlstatic.com/D_NQ_NP_${A}-O.webp"></figure>`;
  return document;
};

describe('destacarMiniaturas', () => {
  it('marca só a miniatura da galeria cuja foto é fraca (nunca a imagem grande), sem mexer no tooltip do ML', () => {
    const doc = galeria();
    expect(destacarMiniaturas(doc, [A])).toBe(1);
    const marcadas = doc.querySelectorAll<HTMLElement>('[data-publiai-foto-fraca]');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].style.outline).toContain('2px solid');
    expect(marcadas[0].title).toBe('Foto 1');
    expect(doc.querySelector('figure')!.hasAttribute('data-publiai-foto-fraca')).toBe(false);
  });

  it('casamento seguro: id fora do formato, vazio ou prefixo de outro id não marca nada', () => {
    const doc = galeria();
    expect(destacarMiniaturas(doc, ['', '-', 'NP', '670304-MLB9', A.slice(0, -2)])).toBe(0);
  });

  it('casa por data-src; segunda chamada não duplica', () => {
    const doc = galeria();
    expect(destacarMiniaturas(doc, [B, 'nao-existe'])).toBe(1);
    expect(destacarMiniaturas(doc, [B])).toBe(0);
  });

  it('limparMiniaturas devolve o estilo original e tira a marca (troca de sessão)', () => {
    const doc = galeria();
    destacarMiniaturas(doc, [A, B]);
    limparMiniaturas(doc);
    expect(doc.querySelectorAll('[data-publiai-foto-fraca]')).toHaveLength(0);
    const [primeira, segunda] = doc.querySelectorAll<HTMLElement>('.ui-pdp-gallery__thumbnail');
    expect(primeira.style.outline).toBe('1px dotted blue');
    expect(segunda.style.outline).toBe('');
  });
});

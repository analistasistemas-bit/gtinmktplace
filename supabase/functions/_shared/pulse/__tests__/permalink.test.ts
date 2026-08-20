import { describe, expect, it } from 'vitest';
import { enrichPulsePermalinks } from '../permalink.ts';

interface OfertaTeste {
  item_id: string;
  permalink: string | null;
}

const oferta = (item_id: string, permalink: string | null = null): OfertaTeste => ({ item_id, permalink });

describe('enrichPulsePermalinks', () => {
  it('deriva o link público do item_id sem consultar detalhes do concorrente', () => {
    const [resultado] = enrichPulsePermalinks([oferta('MLB6803357628')]);

    expect(resultado.permalink).toBe('https://produto.mercadolivre.com.br/MLB-6803357628');
  });

  it('preserva permalink atual ou anterior quando já existe um link válido', () => {
    const resultado = enrichPulsePermalinks(
      [oferta('MLB6803357628', 'https://ml.atual/oferta'), oferta('MLB3250921353')],
      new Map([['MLB3250921353', 'https://ml.anterior/oferta']]),
    );

    expect(resultado.map((item) => item.permalink)).toEqual([
      'https://ml.atual/oferta',
      'https://ml.anterior/oferta',
    ]);
  });

  it('não fabrica link para item_id inválido', () => {
    const [resultado] = enrichPulsePermalinks([oferta('item-invalido')]);

    expect(resultado.permalink).toBeNull();
  });
});

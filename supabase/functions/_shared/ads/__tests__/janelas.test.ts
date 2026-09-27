import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../trafego/janelas.ts';
import { janelaAds } from '../janelas.ts';

const dias = (j: { desde: string; ate: string }) => (Date.parse(j.ate) - Date.parse(j.desde)) / DAY_MS + 1;

describe('janelaAds', () => {
  it('carga inicial: 90 dias terminando ontem (a janela aceita no spike 053: 29/06–26/09 em 27/09)', () => {
    const j = janelaAds({ hoje: '2026-09-27', cargaInicialOk: false, ultimoOkDia: null });
    expect(j).toEqual({ desde: '2026-06-29', ate: '2026-09-26' });
    expect(dias(j)).toBe(90);
  });
  it('dia a dia: D-1 + 14 dias de releitura da atribuição; hoje nunca entra', () => {
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-09-26' })).toEqual({ desde: '2026-09-12', ate: '2026-09-26' });
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: null })).toEqual({ desde: '2026-09-12', ate: '2026-09-26' });
  });
  it('worker parado: estende até o último ok − 14 (dias ainda em aberto naquela leitura)', () => {
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-09-01' })).toEqual({ desde: '2026-08-18', ate: '2026-09-26' });
  });
  it('nunca passa de 90 dias (acima disso o ML devolve 400)', () => {
    const j = janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-05-01' });
    expect(j).toEqual({ desde: '2026-06-29', ate: '2026-09-26' });
    expect(dias(j)).toBeLessThanOrEqual(90);
  });
});

import { describe, expect, it } from 'vitest';
import type { RespostaAnuncio } from '../../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import type { MargemTipo } from '../../../../supabase/functions/_shared/extensao/tipos.ts';
import { textoDoSelo } from '../selo';

const tipo = (o: Partial<MargemTipo>): MargemTipo => ({ comissao: 0, imposto: 0, frete: 0, custo: null, recebe: 0, lucro: null, margemPct: null, avisos: [], ...o });
const resp = (margem: RespostaAnuncio['margem'], proprio = false): RespostaAnuncio =>
  ({ proprio, margem, custo: {} as RespostaAnuncio['custo'], parametros: {} as RespostaAnuncio['parametros'] });
const comClassico = (c: MargemTipo | null) =>
  resp({ preco: 100, classico: c ? { estado: 'ok', valor: c } : { estado: 'indisponivel', motivo: 'x' }, premium: { estado: 'indisponivel', motivo: 'x' } });

describe('textoDoSelo', () => {
  it('com lucro', () => {
    expect(textoDoSelo(comClassico(tipo({ recebe: 120, custo: 52.76, lucro: 67.24, margemPct: 31.54 })))).toBe('Minha margem R$ 67,24 (31,54%)');
  });
  it('sem custo', () => {
    expect(textoDoSelo(comClassico(tipo({ recebe: 1234.5 })))).toBe('Recebe R$ 1.234,50 · informe o custo');
  });
  it('anúncio próprio', () => {
    expect(textoDoSelo(resp(null, true))).toBe('Anúncio seu · abrir no PubliAI');
  });
  it('Clássico indisponível ou margem nula → sem selo', () => {
    expect(textoDoSelo(comClassico(null))).toBe('');
    expect(textoDoSelo(resp(null))).toBe('');
  });
});

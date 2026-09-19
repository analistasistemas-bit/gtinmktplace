import { describe, expect, it } from 'vitest';
import {
  CONTORNO_PEITO_CM, domainIdSemPrefixo, montarLinhasChart, nomeChart, parseLinhasResposta,
} from '../size-chart.ts';

// Achado real (produção, 2026-09-19): a 1ª tentativa de publicação real ficou presa em retry
// porque POST /catalog/charts recusou o nome com `invalid_chart_name` — a mensagem cita "máximo
// 60 caracteres" mas o nome tinha 45; reproduzido isolado contra a API real, o `_` de
// "JACKETS_AND_COATS" (domain_id cru) é que invalida o nome, não o tamanho. Nome sem `_` (mesmo
// mais longo) passou. `nomeChart` nunca pode deixar `_` vazar pro campo `names`.
describe('nomeChart (ADR-0167 — achado real de produção)', () => {
  it('nunca contém underscore, mesmo com domain_id cru (JACKETS_AND_COATS)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome).not.toContain('_');
  });

  it('troca underscore por espaço, preservando legibilidade', () => {
    expect(nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M'])).toBe('PubliAI Guia Jackets And Coats masculino P-M');
  });

  it('nunca passa de 60 caracteres (limite real confirmado)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome.length).toBeLessThanOrEqual(60);
  });
});

describe('domainIdSemPrefixo (ADR-0167)', () => {
  it('remove o prefixo MLB- do catalog_domain', () => {
    expect(domainIdSemPrefixo('MLB-JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('mantém intacto quando já não tem prefixo', () => {
    expect(domainIdSemPrefixo('JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('null/undefined vira null', () => {
    expect(domainIdSemPrefixo(null)).toBeNull();
    expect(domainIdSemPrefixo(undefined)).toBeNull();
  });
});

describe('montarLinhasChart (ADR-0167 / Spike 051 §3)', () => {
  const sizeValores = [{ id: '17552780', nome: 'P' }, { id: '2282666', nome: 'M' }];
  // Achado real do spike: FILTRABLE_SIZE tem value_id PRÓPRIO, diferente de SIZE, para o mesmo tamanho.
  const filtravelValores = [{ id: '13853813', nome: 'P' }, { id: '12917795', nome: 'M' }];

  it('monta SIZE + FILTRABLE_SIZE + CHEST_CIRCUMFERENCE_FROM por linha, com ids corretos de cada namespace', () => {
    const linhas = montarLinhasChart(['P', 'M'], sizeValores, filtravelValores);
    expect(linhas).toEqual([
      { attributes: [
        { id: 'SIZE', values: [{ id: '17552780', name: 'P' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '13853813', name: 'P' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '88 cm' }] },
      ] },
      { attributes: [
        { id: 'SIZE', values: [{ id: '2282666', name: 'M' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '12917795', name: 'M' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '96 cm' }] },
      ] },
    ]);
  });

  it('tamanho sem medida confirmada (ex.: Tamanho Único) falha alto em vez de inventar', () => {
    expect(() => montarLinhasChart(['Único'], sizeValores, filtravelValores))
      .toThrow(/sem valor\/medida confirmado/);
  });

  it('tamanho sem value_id em SIZE ou FILTRABLE_SIZE falha alto', () => {
    expect(() => montarLinhasChart(['G'], sizeValores, filtravelValores)).toThrow();
  });

  it('CONTORNO_PEITO_CM só cobre P/M/G/GG — trava contra regressão silenciosa', () => {
    expect(Object.keys(CONTORNO_PEITO_CM).sort()).toEqual(['G', 'GG', 'M', 'P']);
  });
});

describe('parseLinhasResposta (ADR-0167 / Spike 051 §3)', () => {
  it('extrai tamanho -> row_id da resposta real do ML', () => {
    const rows = [
      { id: '8522331:1', attributes: [{ id: 'SIZE', values: [{ name: 'P' }] }, { id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] },
      { id: '8522331:2', attributes: [{ id: 'SIZE', values: [{ name: 'M' }] }] },
    ];
    const mapa = parseLinhasResposta(rows);
    expect(mapa.get('P')).toBe('8522331:1');
    expect(mapa.get('M')).toBe('8522331:2');
    expect(mapa.size).toBe(2);
  });

  it('linha sem atributo SIZE não entra no mapa', () => {
    const rows = [{ id: '8522331:9', attributes: [{ id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] }];
    expect(parseLinhasResposta(rows).size).toBe(0);
  });
});

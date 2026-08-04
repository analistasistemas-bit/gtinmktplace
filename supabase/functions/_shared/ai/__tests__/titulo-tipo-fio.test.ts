import { describe, it, expect } from 'vitest';
import { garantirTipoFioTitulo, garantirTipoProdutoTitulo } from '../titulo';

describe('garantirTipoFioTitulo', () => {
  it('corrige FIO para LINHA quando nome_pai declara "L." (bug real lote #63)', () => {
    const r = garantirTipoFioTitulo('FIO CLÉA 1000 151,3G | 100% ALGODÃO MERCERIZADO', 'L.CLEA 1000 CORES');
    expect(r).toBe('LINHA CLÉA 1000 151,3G | 100% ALGODÃO MERCERIZADO');
  });

  it('não mexe quando já está correto (idempotente)', () => {
    const r = garantirTipoFioTitulo('LINHA CLEA 125 CIRCULO 125M | 100% ALGODÃO MERCERIZADO', 'L.CLEA 125 CROCHE CORES');
    expect(r).toBe('LINHA CLEA 125 CIRCULO 125M | 100% ALGODÃO MERCERIZADO');
  });

  it('não mexe quando nome_pai não declara nenhum sinônimo (ex.: EUROROMA)', () => {
    const r = garantirTipoFioTitulo('BARBANTE EUROROMA 4/6 600G 610MT | 85% ALGODÃO', 'EUROROMA 4/6 CORES 600G 610MT');
    expect(r).toBe('BARBANTE EUROROMA 4/6 600G 610MT | 85% ALGODÃO');
  });

  it('não mexe quando nome_pai já declara FIO por extenso e o título já usa FIO', () => {
    const r = garantirTipoFioTitulo('FIO NAUTICO CIRCULO 500G | 100% POLIPROPILENO', 'FIO NAUTICO CORES UND 500G');
    expect(r).toBe('FIO NAUTICO CIRCULO 500G | 100% POLIPROPILENO');
  });

  it('respeita BARBANTE declarado por extenso no nome_pai', () => {
    const r = garantirTipoFioTitulo('FIO BANDEIRANTE 4/6 570MT | 85% ALGODÃO', 'BARBANTE ALGODAO CONES 4/6 CORES 570MT');
    expect(r).toBe('BARBANTE BANDEIRANTE 4/6 570MT | 85% ALGODÃO');
  });

  it('não mexe quando a 1ª palavra do título não é nenhum sinônimo de tipo de fio', () => {
    const r = garantirTipoFioTitulo('CLÉA 1000 151,3G | 100% ALGODÃO', 'L.CLEA 1000 CORES');
    expect(r).toBe('CLÉA 1000 151,3G | 100% ALGODÃO');
  });

  it('ordem correta com garantirTipoProdutoTitulo: rodar DEPOIS evita reprefixar (ver ADR)', () => {
    const titulo = garantirTipoProdutoTitulo('FIO CLÉA 1000 151,3G | 100% ALGODÃO MERCERIZADO', 'fio de crochê');
    const corrigido = garantirTipoFioTitulo(titulo, 'L.CLEA 1000 CORES');
    expect(corrigido).toBe('LINHA CLÉA 1000 151,3G | 100% ALGODÃO MERCERIZADO');
  });
});

import { describe, it, expect } from 'vitest';
import { escolherLoteRevisao } from '../escolher-lote-revisao';

type LoteTeste = {
  id: string;
  status: string;
  totalErros: number;
  criadoEm: string;
};

const lote = (id: string, status: string, totalErros: number, criadoEm: string): LoteTeste =>
  ({ id, status, totalErros, criadoEm });

describe('escolherLoteRevisao', () => {
  it('prefere lote em revisao mais recente sobre concluido sem erros', () => {
    const lotes = [
      lote('novo-ok', 'concluido', 0, '2026-09-01T12:00:00Z'),
      lote('velho-revisao', 'revisao', 0, '2026-08-01T10:00:00Z'),
    ];
    expect(escolherLoteRevisao(lotes)?.id).toBe('velho-revisao');
  });

  it('prefere lote com erros mais recente sobre concluido sem erros', () => {
    const lotes = [
      lote('novo-ok', 'concluido', 0, '2026-09-01T12:00:00Z'),
      lote('velho-erro', 'concluido', 2, '2026-08-01T10:00:00Z'),
    ];
    expect(escolherLoteRevisao(lotes)?.id).toBe('velho-erro');
  });

  it('só lotes bem-sucedidos → retorna o primeiro (já mais recente)', () => {
    const lotes = [
      lote('a', 'concluido', 0, '2026-09-01T12:00:00Z'),
      lote('b', 'concluido', 0, '2026-08-01T10:00:00Z'),
    ];
    expect(escolherLoteRevisao(lotes)?.id).toBe('a');
  });

  it('lista vazia → undefined', () => {
    expect(escolherLoteRevisao([])).toBeUndefined();
  });
});

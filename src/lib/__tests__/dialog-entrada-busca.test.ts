import { describe, it, expect } from 'vitest';
import { montarOpcaoSku } from '../dialog-entrada-busca';

describe('montarOpcaoSku', () => {
  it('sem tamanho, o rótulo é exatamente o de hoje (INV-1)', () => {
    const o = montarOpcaoSku({
      codigo: '09200001', nome: 'Preto', cor: 'Preto', codigoPai: '09200000', estoque: 1,
    });
    expect(o.rotulo).toBe('09200001 · Preto (Preto)');
  });

  // ADR-0166 (Task 3): picker geral da Entrada ganha o tamanho no rótulo.
  it('com tamanho, o rótulo ganha o sufixo " · <tamanho>"', () => {
    const o = montarOpcaoSku({
      codigo: '09200001', nome: 'Preto', cor: 'Preto', tamanho: 'M', codigoPai: '09200000', estoque: 1,
    });
    expect(o.rotulo).toBe('09200001 · Preto (Preto) · M');
    expect(o.textoBusca).toContain('m');
  });
});

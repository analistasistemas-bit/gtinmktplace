import { describe, expect, it } from 'vitest';
import { decidirStatus, MSG_BLOQUEADO_STATUS, MSG_SEM_LEITURA } from '../decidir-status.ts';

const PXV = 'Migração para preço por variação em andamento.';

describe('decidirStatus', () => {
  it('pausar ativo → escrever pausado; reativar pausado → escrever ativo', () => {
    expect(decidirStatus('pausar', 'ativo', null)).toEqual({ tipo: 'escrever', alvo: 'pausado' });
    expect(decidirStatus('reativar', 'pausado', null)).toEqual({ tipo: 'escrever', alvo: 'ativo' });
  });
  it('já no alvo → ja_estava (idempotente no retry do QStash)', () => {
    expect(decidirStatus('pausar', 'pausado', null)).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
    expect(decidirStatus('reativar', 'ativo', null)).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('moderado, encerrado, inativo → bloqueado, nunca escreve', () => {
    for (const s of ['moderado', 'encerrado', 'inativo'] as const) {
      expect(decidirStatus('reativar', s, null)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS });
      expect(decidirStatus('pausar', s, null)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: MSG_BLOQUEADO_STATUS });
    }
  });
  it('migração PxV em curso → bloqueado com a mensagem do guard, mesmo ativo', () => {
    expect(decidirStatus('pausar', 'ativo', PXV)).toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: PXV });
  });
  it('sem leitura (null/indisponivel) → erro, sem escrever', () => {
    expect(decidirStatus('pausar', null, null)).toEqual({ tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA });
    expect(decidirStatus('pausar', 'indisponivel', null)).toEqual({ tipo: 'fim', status: 'erro', mensagem: MSG_SEM_LEITURA });
  });
});

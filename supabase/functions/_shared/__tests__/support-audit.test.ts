import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditarOperacaoSuporte } from '../support-audit.ts';

const handlers = [
  'atributos-familia', 'atualizar-status-publicado', 'backfill-faturamento',
  'definir-categoria-familia', 'excluir-lote', 'ingest-lote', 'invalidar-cache-cor',
  'ml-oauth-claim', 'ml-oauth-disconnect', 'ml-oauth-start', 'monitorar-moderados',
  'publicar-familias', 'reconciliar-user-products', 'regenerar-copy-familia',
  'remover-publicado', 'reprocessar-familia', 'responder-mensagem',
  'responder-pergunta', 'upload-imagens-lote',
];

const support = { userId: 'user-1', orgId: 'org-1', support: { requestId: 'request-1' } };

describe('auditarOperacaoSuporte', () => {
  it('grava resultado de suporte sem payload', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };

    await auditarOperacaoSuporte(db as never, support, { type: 'familia', id: 'familia-1' }, 'succeeded');

    expect(db.from).toHaveBeenCalledWith('support_audit_events');
    expect(insert).toHaveBeenCalledWith({
      org_id: 'org-1', support_request_id: 'request-1', actor_id: 'user-1',
      event: 'operation', target_type: 'familia', target_id: 'familia-1', result: 'succeeded',
    });
  });

  it('não grava para membro normal', async () => {
    const db = { from: vi.fn() };

    await auditarOperacaoSuporte(db as never, { ...support, support: null }, { type: 'familia', id: 'familia-1' }, 'failed');

    expect(db.from).not.toHaveBeenCalled();
  });

  it('falha alto se a auditoria de suporte falhar', async () => {
    const db = { from: () => ({ insert: () => Promise.resolve({ error: new Error('db indisponível') }) }) };

    await expect(auditarOperacaoSuporte(db as never, support, { type: 'familia', id: 'familia-1' }, 'failed'))
      .rejects.toThrow('falha ao auditar operação de suporte');
  });
});

describe('handlers de escrita auditáveis', () => {
  it.each(handlers)('%s chama o helper de auditoria', (handler) => {
    const file = resolve(import.meta.dirname!, '../../', handler, 'index.ts');
    expect(readFileSync(file, 'utf8')).toContain('auditarOperacaoSuporte');
  });
});

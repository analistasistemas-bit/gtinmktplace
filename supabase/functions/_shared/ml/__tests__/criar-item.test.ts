import { describe, it, expect, afterEach } from 'vitest';
import { criarItemML } from '../criar-item';
import type { PayloadItem } from '../publicar';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

const payload = { category_id: 'MLB1', currency_id: 'BRL', buying_mode: 'buy_it_now', listing_type_id: 'gold_special', condition: 'new', pictures: [], attributes: [] } as unknown as PayloadItem;

describe('criarItemML (ADR-0087: anexa mlCauses ao erro para detecção reativa)', () => {
  it('400 rejeitado pelo ML anexa o array `cause` bruto como `mlCauses` no erro lançado', async () => {
    const cause = [
      { code: 'body.required_fields', cause_id: 369, type: 'error', message: 'x' },
      { code: 'body.invalid_fields', cause_id: 374, type: 'error', message: 'y' },
    ];
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ message: 'Validation error', error: 'validation_error', status: 400, cause }), { status: 400 }))) as typeof fetch;
    await expect(criarItemML('tok', payload)).rejects.toMatchObject({ mlCauses: cause, status: 400 });
  });

  it('rejeição sem `cause` no corpo anexa `mlCauses` undefined (não quebra)', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))) as typeof fetch;
    await expect(criarItemML('tok', payload)).rejects.toMatchObject({ mlCauses: undefined, status: 403 });
  });
});

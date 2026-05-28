import { describe, it, expect } from 'vitest';
import { processarArquivo } from '../processar';

function fakeFile(nome: string): File {
  return new File(['fake-bytes'], nome, { type: 'image/jpeg' });
}

// Simulates the Supabase admin client query chains used in processar.ts.
// familias query: .from('familias').select(...).eq('familias.lote_id', loteId).eq('familias.user_id', userId) -> array
// variacoes query: .from('variacoes').select(...).eq('codigo', ...).eq('familias.lote_id', ...).eq('familias.user_id', ...) -> array
function fakeSupabase(opts: {
  familiaCodigoPai?: string;
  variacaoCodigo?: string;
  variacaoTinhaImagem?: boolean;
}) {
  const storageClient = {
    upload: async () => ({ error: null }),
    remove: async () => ({ error: null }),
  };

  return {
    from: (tabela: string) => {
      // Build a chainable query that returns data at the terminal call
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        // Terminal: returns array (variacoes uses [0] indexing)
        then: undefined as any,
      };

      // Override to track calls and return appropriate data
      let eqCount = 0;
      let resolvedData: any[] = [];

      if (tabela === 'familias') {
        resolvedData =
          opts.familiaCodigoPai
            ? [{ id: 'fam-1', codigo_pai: opts.familiaCodigoPai, capa_storage_path: null }]
            : [];
      } else if (tabela === 'variacoes') {
        resolvedData =
          opts.variacaoCodigo
            ? [
                {
                  id: 'var-1',
                  codigo: opts.variacaoCodigo,
                  imagem_path: opts.variacaoTinhaImagem ? 'old-path' : null,
                  familias: { lote_id: 'lote-1', user_id: 'user-1' },
                },
              ]
            : [];
      }

      const asyncChain: any = {
        select: () => asyncChain,
        eq: () => asyncChain,
        update: () => asyncChain,
        // make it thenable so await works
        then: (resolve: any) => Promise.resolve({ data: resolvedData, error: null }).then(resolve),
      };

      return asyncChain;
    },
    storage: {
      from: () => storageClient,
    },
  };
}

describe('processarArquivo', () => {
  it('CAPA_00012345.jpeg vai pro path capas/ e retorna capa_ok', async () => {
    const sb = fakeSupabase({ familiaCodigoPai: '00012345' });
    const r = await processarArquivo(fakeFile('CAPA_00012345.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('capa_ok');
  });

  it('CAPA_00099999.jpeg sem família correspondente vira capa_sem_match', async () => {
    const sb = fakeSupabase({});
    const r = await processarArquivo(fakeFile('CAPA_00099999.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('capa_sem_match');
  });

  it('00012345.jpeg sem prefixo segue caminho variação como ok (nova foto)', async () => {
    const sb = fakeSupabase({ variacaoCodigo: '00012345', variacaoTinhaImagem: false });
    const r = await processarArquivo(fakeFile('00012345.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('ok');
  });

  it('00012345.jpeg quando já tinha vira ja_tinha', async () => {
    const sb = fakeSupabase({ variacaoCodigo: '00012345', variacaoTinhaImagem: true });
    const r = await processarArquivo(fakeFile('00012345.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('ja_tinha');
  });

  it('00099999.jpeg sem variação correspondente vira sem_match', async () => {
    const sb = fakeSupabase({});
    const r = await processarArquivo(fakeFile('00099999.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('sem_match');
  });

  it('nome inválido retorna invalido com erro', async () => {
    const sb = fakeSupabase({});
    const r = await processarArquivo(fakeFile('foto-aleatoria.jpeg'), 'user-1', 'lote-1', sb as any);
    expect(r.tipo).toBe('invalido');
  });
});

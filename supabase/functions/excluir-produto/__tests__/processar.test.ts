import { describe, it, expect } from 'vitest';
import { excluirProduto } from '../processar';

// Fake admin client: fila FIFO por tabela, consumida na ordem real das queries do processar.ts.
// delete()/update()/storage.remove() só gravam a chamada — nunca consomem a fila.
// ERRO(msg): marcador na fila — a próxima query nessa tabela resolve {data:null, error}.
const ERRO = (message: string) => ({ __erro: message });
function ehErro(v: unknown): v is { __erro: string } {
  return !!v && typeof v === 'object' && '__erro' in (v as Record<string, unknown>);
}

function fakeAdmin(filas: Record<string, unknown[]>) {
  const deletes: { tabela: string }[] = [];
  const removidos: string[][] = [];
  // A ORDEM importa: a varredura de órfãos (ADR-0097 D-2) só é correta DEPOIS do delete das
  // famílias — antes dele o cascade não rodou e o anti-join sai vazio.
  const rpcs: { nome: string; args: unknown; tabelasDeletadasAntes: string[] }[] = [];

  const proximo = (tabela: string) => {
    const fila = filas[tabela] ?? [];
    return fila.length ? fila.shift() : [];
  };
  const resolver = (tabela: string) => {
    const v = proximo(tabela);
    return ehErro(v) ? { data: null, error: { message: v.__erro } } : { data: v, error: null };
  };

  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj, eq: () => obj, not: () => obj, in: () => obj, limit: () => obj,
      maybeSingle: async () => resolver(tabela),
      delete: () => {
        deletes.push({ tabela });
        const del: any = { eq: () => del, in: () => del, then: (r: any) => Promise.resolve(resolver(`${tabela}:delete`)).then(r) };
        return del;
      },
      update: () => {
        const upd: any = { eq: () => upd, then: (r: any) => Promise.resolve(resolver(`${tabela}:update`)).then(r) };
        return upd;
      },
      then: (r: any) => Promise.resolve(resolver(tabela)).then(r),
    };
    return obj;
  }

  const admin: any = {
    from: (tabela: string) => chain(tabela),
    storage: { from: () => ({ remove: async (paths: string[]) => { removidos.push(paths); return { error: null }; } }) },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args, tabelasDeletadasAntes: deletes.map((d) => d.tabela) });
      return { data: 3, error: null };
    },
  };
  return { admin, deletes, removidos, rpcs };
}

const ORG = 'org-1';
const DONO = 'user-1'; // 1º segmento dos paths de Storage
const CODIGO = '00000026';

const familiaCompleta = (id: string, lote: string) => ({
  id, lote_id: lote, user_id: DONO,
  capa_storage_path: `${DONO}/capa-${id}.jpg`, capa2_storage_path: null, capa3_storage_path: null,
  variacoes: [{ imagem_path: `${DONO}/var-${id}.jpg` }],
});

describe('excluirProduto — só produto não publicado (ADR-0113 D-1)', () => {
  it('código sem nenhuma família na org devolve nao_encontrada', async () => {
    const { admin, deletes } = fakeAdmin({ familias: [[], [], []] });
    const r = await excluirProduto(admin, { codigoPai: 'inexistente', orgId: ORG });
    expect(r).toEqual({ tipo: 'nao_encontrada' });
    expect(deletes).toEqual([]);
  });

  it('recusa quando QUALQUER irmã do codigo_pai está publicada, sem apagar nada', async () => {
    // D-3: ciclos de UPDATE deixam várias famílias com o mesmo codigo_pai. A linha visível na
    // tela não tem ml_item_id, mas uma irmã tem — apagar cortaria o vínculo (ADR-0019).
    const { admin, deletes, removidos, rpcs } = fakeAdmin({
      familias: [[{ id: 'fam-2' }]],
    });
    const r = await excluirProduto(admin, { codigoPai: CODIGO, orgId: ORG });
    expect(r).toEqual({ tipo: 'publicado' });
    expect(deletes).toEqual([]);
    expect(removidos).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it('recusa quando há família do codigo_pai em voo, sem apagar nada', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [[], [{ id: 'fam-3' }]],
    });
    const r = await excluirProduto(admin, { codigoPai: CODIGO, orgId: ORG });
    expect(r).toEqual({ tipo: 'em_voo' });
    expect(deletes).toEqual([]);
    expect(removidos).toEqual([]);
  });

  it('apaga todas as famílias do codigo_pai, as fotos do dono e varre os órfãos DEPOIS', async () => {
    const { admin, deletes, removidos, rpcs } = fakeAdmin({
      familias: [
        [],                                                     // 1. publicadas
        [],                                                     // 2. em voo
        [familiaCompleta('fam-1', 'lote-9'), familiaCompleta('fam-2', 'lote-9')], // 3. alvos
        [],                                                     // 4. recontar: lote ficou vazio
      ],
    });

    const r = await excluirProduto(admin, { codigoPai: CODIGO, orgId: ORG });

    expect(r).toEqual({ tipo: 'ok', familiasRemovidas: 2, lotesRemovidos: 1, movimentosRemovidos: 3 });
    expect(removidos).toEqual([[
      `${DONO}/capa-fam-1.jpg`, `${DONO}/var-fam-1.jpg`,
      `${DONO}/capa-fam-2.jpg`, `${DONO}/var-fam-2.jpg`,
    ]]);
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'lotes']);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nome).toBe('limpar_movimentos_orfaos');
    expect(rpcs[0].args).toEqual({ p_org: ORG });
    // ADR-0097 D-2: a varredura roda com o delete das famílias já feito.
    expect(rpcs[0].tabelasDeletadasAntes).toContain('familias');
  });

  it('descarta path de Storage fora do prefixo do dono', async () => {
    const intruso = { ...familiaCompleta('fam-1', 'lote-9'), capa_storage_path: 'outro-user/capa.jpg' };
    const { admin, removidos } = fakeAdmin({
      familias: [[], [], [intruso], []],
    });
    await excluirProduto(admin, { codigoPai: CODIGO, orgId: ORG });
    expect(removidos).toEqual([[`${DONO}/var-fam-1.jpg`]]);
  });

  it('erro ao consultar publicadas propaga — nunca vira "não publicado"', async () => {
    // Fail-closed: degradar para lista vazia apagaria o vínculo de UPDATE em silêncio.
    const { admin, deletes } = fakeAdmin({ familias: [ERRO('boom')] });
    await expect(excluirProduto(admin, { codigoPai: CODIGO, orgId: ORG })).rejects.toThrow(/boom/);
    expect(deletes).toEqual([]);
  });
});

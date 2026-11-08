import { describe, it, expect } from 'vitest';
import { excluirFamilia } from '../processar';
import { MENSAGEM_MIGRACAO_EM_CURSO } from '../../_shared/user-products/guard-migracao-pxv';

// Fake admin: fila FIFO por tabela, consumida na ordem real das queries do processar.ts:
//   familias:          alvo (maybeSingle) → irmãs → kits → status do lote → capa → capa2 → capa3
//   lotes:             lote (maybeSingle)
//   anuncios_externos: PxV (maybeSingle) → externos
//   familias:delete / lotes:delete / lotes:update: resultado da escrita
//   variacoes:         referências de imagem_path
// Fila vazia: maybeSingle → null, lista → [].
// ERRO(msg, code?): a próxima query nessa fila resolve {data:null, error}.
const ERRO = (message: string, code?: string) => ({ __erro: message, code });
function ehErro(v: unknown): v is { __erro: string; code?: string } {
  return !!v && typeof v === 'object' && '__erro' in (v as Record<string, unknown>);
}

function fakeAdmin(filas: Record<string, unknown[]>) {
  // Log único e ordenado de efeitos: prova que a varredura de órfãos roda DEPOIS do delete.
  const efeitos: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const removidos: string[][] = [];

  const resolver = (fila: string, vazio: unknown) => {
    const q = filas[fila] ?? [];
    const v = q.length ? q.shift() : vazio;
    return ehErro(v) ? { data: null, error: { message: v.__erro, code: v.code } } : { data: v, error: null };
  };

  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj, eq: () => obj, neq: () => obj, not: () => obj, in: () => obj,
      is: () => obj, or: () => obj, limit: () => obj,
      maybeSingle: async () => resolver(tabela, null),
      delete: () => {
        efeitos.push(`${tabela}:delete`);
        const del: any = {
          eq: () => del, in: () => del, is: () => del, select: () => del,
          then: (r: any) => Promise.resolve(resolver(`${tabela}:delete`, [])).then(r),
        };
        return del;
      },
      update: (body: Record<string, unknown>) => {
        efeitos.push(`${tabela}:update`);
        updates.push(body);
        const upd: any = { eq: () => upd, then: (r: any) => Promise.resolve(resolver(`${tabela}:update`, null)).then(r) };
        return upd;
      },
      then: (r: any) => Promise.resolve(resolver(tabela, [])).then(r),
    };
    return obj;
  }

  const admin: any = {
    from: (tabela: string) => chain(tabela),
    storage: { from: () => ({ remove: async (paths: string[]) => { removidos.push(paths); return { error: null }; } }) },
    rpc: async (nome: string) => { efeitos.push(`rpc:${nome}`); return { data: 1, error: null }; },
  };
  return { admin, efeitos, updates, removidos };
}

const ORG = 'org-1';
const DONO = 'user-1';
const CODIGO = '00000026';
const INPUT = { familiaId: 'fam-1', orgId: ORG, userId: DONO, suporteFull: false };

const ALVO = {
  id: 'fam-1', lote_id: 'lote-1', user_id: DONO, codigo_pai: CODIGO, status: 'pronto',
  ml_item_id: null, publicado_em: null,
  capa_storage_path: `${DONO}/capa.jpg`, capa2_storage_path: null, capa3_storage_path: null,
  variacoes: [{ imagem_path: `${DONO}/var.jpg`, ml_variation_id: null }],
};
const LOTE = {
  user_id: DONO, status: 'revisao', planilha_path: `${DONO}/planilha.xlsx`,
  imagens_paths: [`${DONO}/img1.jpg`, 'outro-user/img2.jpg'],
};

// Caminho feliz até o DELETE (1 linha apagada). `restantes` = status das famílias que sobram no lote.
function filasOk(restantes: { status: string }[], over: Record<string, unknown[]> = {}) {
  return {
    familias: [ALVO, [], [], restantes, [], [], []],
    lotes: [LOTE],
    anuncios_externos: [null, []],
    'familias:delete': [[{ id: 'fam-1' }]],
    ...over,
  };
}

describe('excluirFamilia (ADR-0199)', () => {
  it('família inexistente → nao_encontrada', async () => {
    const { admin, efeitos } = fakeAdmin({});
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'nao_encontrada' });
    expect(efeitos).toEqual([]);
  });

  it('lote de outro dono sem suporte → nao_encontrada', async () => {
    const { admin, efeitos } = fakeAdmin({ familias: [ALVO], lotes: [{ ...LOTE, user_id: 'outro-user' }] });
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'nao_encontrada' });
    expect(efeitos).toEqual([]);
  });

  it('lote processando → recusada em_voo', async () => {
    const { admin, efeitos } = fakeAdmin({ familias: [ALVO], lotes: [{ ...LOTE, status: 'processando' }] });
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'recusada', motivo: 'em_voo' });
    expect(efeitos).toEqual([]);
  });

  it('PxV em curso → recusada pxv com a mensagem', async () => {
    const { admin, efeitos } = fakeAdmin({
      familias: [ALVO], lotes: [LOTE], anuncios_externos: [{ migracao_pxv_status: 'em_andamento' }],
    });
    expect(await excluirFamilia(admin, INPUT))
      .toEqual({ tipo: 'recusada', motivo: 'pxv', mensagem: MENSAGEM_MIGRACAO_EM_CURSO });
    expect(efeitos).toEqual([]);
  });

  it('leitura de guard falhou → recusada nao_conferido, sem delete', async () => {
    const { admin, efeitos } = fakeAdmin(filasOk([], { anuncios_externos: [null, ERRO('timeout')] }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'recusada', motivo: 'nao_conferido' });
    expect(efeitos).toEqual([]);
  });

  it('cor UP criada só na reposição (sku sem irmã) → recusada vinculada, sem delete', async () => {
    const { admin, efeitos } = fakeAdmin(filasOk([], {
      familias: [{ ...ALVO, status: 'erro' }, [{ ml_item_id: null, variacoes: [{ codigo: 'A1', ml_variation_id: null }] }], []],
      anuncios_externos: [null, [{ status: 'erro', item_externo_id: null, anuncios_externos_itens: [
        { status: 'criado', item_externo_id: 'MLB9', sku: 'A2' },
      ] }]],
    }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'recusada', motivo: 'vinculada' });
    expect(efeitos).toEqual([]);
  });

  it('DELETE devolve 0 linhas → recusada em_voo, sem limpar movimentos', async () => {
    // Corrida com o worker: a família virou `publicando` entre a leitura e o DELETE condicional.
    const { admin, efeitos, removidos } = fakeAdmin(filasOk([], { 'familias:delete': [[]] }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'recusada', motivo: 'em_voo' });
    expect(efeitos).toEqual(['familias:delete']);
    expect(removidos).toEqual([]);
  });

  it('DELETE com erro 23514 → recusada kit', async () => {
    const msg = `Produto ${CODIGO} tem kit vinculado ativo: remova os kits antes de remover o produto-base.`;
    const { admin, efeitos } = fakeAdmin(filasOk([], { 'familias:delete': [ERRO(msg, '23514')] }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'recusada', motivo: 'kit', mensagem: msg });
    expect(efeitos).toEqual(['familias:delete']);
  });

  it('DELETE com outro erro → lança', async () => {
    const { admin } = fakeAdmin(filasOk([], { 'familias:delete': [ERRO('boom')] }));
    await expect(excluirFamilia(admin, INPUT)).rejects.toThrow(/boom/);
  });

  it('ok com publicadas restantes → limpa movimentos depois do delete e grava status concluido e contadores', async () => {
    const { admin, efeitos, updates } = fakeAdmin(filasOk([{ status: 'publicado' }, { status: 'publicado' }]));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'ok', loteRemovido: false });
    expect(efeitos).toEqual(['familias:delete', 'rpc:limpar_movimentos_orfaos', 'lotes:update']);
    expect(updates).toEqual([{ total_familias: 2, total_publicadas: 2, total_erros: 0, status: 'concluido' }]);
  });

  it('lote com família publicando → contadores sem status', async () => {
    const { admin, updates } = fakeAdmin(filasOk([{ status: 'publicando' }, { status: 'erro' }]));
    await excluirFamilia(admin, INPUT);
    expect(updates).toEqual([{ total_familias: 2, total_publicadas: 0, total_erros: 1 }]);
  });

  it('ok última família → lotes.delete, loteRemovido true, storage remove planilha+imagens só do prefixo do dono', async () => {
    const { admin, efeitos, removidos } = fakeAdmin(filasOk([]));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'ok', loteRemovido: true });
    expect(efeitos).toEqual(['familias:delete', 'rpc:limpar_movimentos_orfaos', 'lotes:delete']);
    expect(removidos).toEqual([[
      `${DONO}/capa.jpg`, `${DONO}/var.jpg`, `${DONO}/planilha.xlsx`, `${DONO}/img1.jpg`,
    ]]);
  });

  it('erro ao apagar o lote vazio → lança', async () => {
    const { admin } = fakeAdmin(filasOk([], { 'lotes:delete': [ERRO('fk')] }));
    await expect(excluirFamilia(admin, INPUT)).rejects.toThrow(/fk/);
  });

  it('lote sobrevive → paths de imagens_paths não são removidos', async () => {
    // A capa da família veio do upload do lote: o `excluir-lote` cuida dela depois.
    const lote = { ...LOTE, imagens_paths: [`${DONO}/capa.jpg`] };
    const { admin, removidos } = fakeAdmin(filasOk([{ status: 'pronto' }], { lotes: [lote] }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'ok', loteRemovido: false });
    expect(removidos).toEqual([[`${DONO}/var.jpg`]]);
  });

  it('path referenciado por outra família → não é removido', async () => {
    // Capa de kit = foto da base.
    const { admin, removidos } = fakeAdmin(filasOk([{ status: 'pronto' }], {
      familias: [ALVO, [], [], [{ status: 'pronto' }], [{ capa_storage_path: `${DONO}/capa.jpg` }], [], []],
    }));
    await excluirFamilia(admin, INPUT);
    expect(removidos).toEqual([[`${DONO}/var.jpg`]]);
  });

  it('leitura de referências falhou → não apaga nada do storage', async () => {
    const { admin, removidos } = fakeAdmin(filasOk([{ status: 'pronto' }], { variacoes: [ERRO('boom')] }));
    expect(await excluirFamilia(admin, INPUT)).toEqual({ tipo: 'ok', loteRemovido: false });
    expect(removidos).toEqual([]);
  });

  it('erro ao ler famílias para fechar o lote → lança', async () => {
    const { admin, efeitos } = fakeAdmin(filasOk([], { familias: [ALVO, [], [], ERRO('leitura')] }));
    await expect(excluirFamilia(admin, INPUT)).rejects.toThrow(/leitura/);
    expect(efeitos).toEqual(['familias:delete', 'rpc:limpar_movimentos_orfaos']);
  });
});

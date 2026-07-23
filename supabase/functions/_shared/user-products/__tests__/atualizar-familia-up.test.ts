import { describe, it, expect, beforeEach, vi } from 'vitest';

// queue.ts puxa QStash — mockado. O spy prova o reenfileirar de catálogo (Fix 5).
const { enfileirarSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarSpy }));

import { atualizarFamiliaUP, type AtualizarFamiliaUPArgs } from '../atualizar-familia-up';
import type { PortasComposicao, ResultadoComposicao } from '../atualizar-composicao';

type Write = { table: string; payload: Record<string, unknown> };

// Fake admin mínimo: captura writes; ITENS select devolve os filhos semente.
function fakeAdmin(filhos: Record<string, unknown>[] = []) {
  const writes: Write[] = [];
  function chain(table: string) {
    const rec = { op: '', payload: {} as Record<string, unknown> };
    const ler = () => (table === 'anuncios_externos_itens' ? filhos : null);
    const api: Record<string, unknown> = {
      select: () => api, eq: () => api, in: () => api, is: () => api, limit: () => api,
      upsert: () => api,
      update: (p: Record<string, unknown>) => { rec.op = 'update'; rec.payload = p; return api; },
      maybeSingle: async () => ({ data: ler(), error: null }),
      single: async () => ({ data: ler(), error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') writes.push({ table, payload: rec.payload });
        return Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve);
      },
    };
    return api;
  }
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) };
  return { admin: { from: chain, storage } as never, writes };
}

// conn stub: capabilities configuráveis; registra descrição/atacado.
function fakeConn(caps: { descricaoSeparada?: boolean; atacado?: boolean } = {}) {
  const chamadas: Array<{ metodo: string; itemExternoId: string }> = [];
  return {
    capabilities: { variacoes: true, descricaoSeparada: !!caps.descricaoSeparada, catalogo: false, desconto: false, atacado: !!caps.atacado, dimensoesPacote: true },
    chamadas,
    subirFoto: async () => 'PIC',
    garantirDescricao: async (_ctx: unknown, itemExternoId: string) => { chamadas.push({ metodo: 'garantirDescricao', itemExternoId }); },
    aplicarAtacado: async (_ctx: unknown, itemExternoId: string) => { chamadas.push({ metodo: 'aplicarAtacado', itemExternoId }); },
    sincronizarDescricao: async () => null,
  };
}

const FAMILIA = {
  id: 'fam-1', org_id: 'org-1', codigo_pai: '000', categoria_ml_id: null, descricao_ml: 'Desc da família',
  atributos_ml: [], capa_ml_picture_id: null, capa2_ml_picture_id: null, capa3_ml_picture_id: null,
  atacado: null as unknown,
};
const RAIZ = { id: 'root-1', titulo: 'T', criado_em: null };
const CONEXAO = { id: 'c', contaExternaId: 'seller-1' } as never;

function args(over: Partial<AtualizarFamiliaUPArgs> = {}): AtualizarFamiliaUPArgs {
  const { admin } = fakeAdmin();
  return {
    admin, conn: fakeConn() as never, ctx: { getToken: async () => 'tok' } as never, conexao: CONEXAO,
    familia: { ...FAMILIA } as never, raiz: RAIZ, variacoes: [{ codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null }] as never,
    somenteEstoque: false, tentativas: 0,
    ...over,
  };
}

beforeEach(() => { enfileirarSpy.mockReset(); });

// Fix 1 — exceção genérica no meio da composição limpa mudando_composicao (senão fica escondido).
describe('atualizarFamiliaUP — Fix 1: exceção genérica na saga limpa mudando_composicao', () => {
  it('saga liga a flag e depois lança → flag é limpa (best-effort) e o erro re-propaga', async () => {
    const { admin, writes } = fakeAdmin();
    let rejeitou = false;
    const executarSaga = async (portas: PortasComposicao): Promise<ResultadoComposicao> => {
      await portas.iniciarComposicao(['A', 'B']);          // liga mudando_composicao=true
      throw new Error('falha genérica no meio da mutação remota'); // rede/supabase/etc.
    };
    try {
      await atualizarFamiliaUP(args({ admin, executarSaga }));
    } catch { rejeitou = true; }
    expect(rejeitou).toBe(true);   // re-propaga (o worker aplica o orçamento de retry)
    const raizWrites = writes.filter((w) => w.table === 'anuncios_externos');
    expect(raizWrites.some((w) => w.payload.mudando_composicao === true)).toBe(true);  // foi ligada
    expect(raizWrites.at(-1)!.payload.mudando_composicao).toBe(false);                 // e limpa ao final
  });
});

// Fix 4b — 'incompleto' converge para erro terminal quando esgota o orçamento de tentativas.
describe('atualizarFamiliaUP — Fix 4b: orçamento de tentativas no incompleto', () => {
  it('tentativas restantes → estado retry (flag persiste, sem marcar erro)', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await atualizarFamiliaUP(args({ admin, tentativas: 0, executarSaga: async () => ({ tipo: 'incompleto' }) }));
    expect(r.estado).toBe('retry');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeUndefined();
  });

  it('tentativas esgotadas → estado erro + familias erro + mudando_composicao limpa', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await atualizarFamiliaUP(args({ admin, tentativas: 10, executarSaga: async () => ({ tipo: 'incompleto' }) }));
    expect(r.estado).toBe('erro');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeDefined();
    expect(writes.find((w) => w.table === 'anuncios_externos' && w.payload.mudando_composicao === false)).toBeDefined();
  });
});

// Fix 5 — efeitos pós-composição que o UPDATE Legacy já faz.
describe('atualizarFamiliaUP — Fix 5: efeitos pós-composição', () => {
  it('cor genuinamente nova → enfileirarVinculacaoCatalogo(familia.id)', async () => {
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    const r = await atualizarFamiliaUP(args({ admin, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) }));
    expect(r.estado).toBe('ok');
    expect(enfileirarSpy).toHaveBeenCalledWith('fam-1');
  });

  it('sem cor nova (só readd/retirada) → NÃO reenfileira catálogo', async () => {
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({ admin, executarSaga: async () => ({ tipo: 'concluido', criadas: [] }) }));
    expect(enfileirarSpy).not.toHaveBeenCalled();
  });

  it('sem_mudanca → NÃO reenfileira catálogo nem sincroniza descrição', async () => {
    const conn = fakeConn({ descricaoSeparada: true });
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'sem_mudanca' }) }));
    expect(enfileirarSpy).not.toHaveBeenCalled();
    expect(conn.chamadas).toEqual([]);
  });

  it('cores mudaram + capabilities → garantirDescricao e aplicarAtacado por item final ativo', async () => {
    const conn = fakeConn({ descricaoSeparada: true, atacado: true });
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ quantidade: 3, preco: 8 }] } as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'garantirDescricao', itemExternoId: 'MLB1' });
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
  });

  // Revisão v3 (Codex): faixas removidas mas atacado_status ainda 'aplicado' → Legacy limpa (envia
  // faixas vazias); o caminho UP tinha esquecido esse caso (só reaplicava com faixas.length>0).
  it('filho_em_estado_terminal → mensagem cita SKU e estado concreto (revisão v3)', async () => {
    const { admin } = fakeAdmin();
    const r = await atualizarFamiliaUP(args({
      admin, executarSaga: async () => ({ tipo: 'erro', codigo: 'filho_em_estado_terminal', sku: 'B', status: 'compensacao_pendente' }),
    }));
    expect(r.estado).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toMatch(/\bB\b/);
    expect((r as { mensagem: string }).mensagem).toMatch(/compensacao_pendente/);
  });

  it('faixas removidas + atacado_status=aplicado → limpa o PxQ (mesmo comportamento do Legacy)', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [], atacado_status: 'aplicado' } as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === null)).toBeDefined();
  });
});

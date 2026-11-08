import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// queue.ts puxa QStash — mockado. O spy prova o reenfileirar de catálogo (Fix 5).
const { enfileirarSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarSpy }));

// notificacoes puxa Telegram/Supabase reais — mockado. O spy prova o alerta LOUD (Fix 6).
const { notificarSpy } = vi.hoisted(() => ({ notificarSpy: vi.fn() }));
vi.mock('../../notificacoes/config.ts', () => ({ notificarCategoria: notificarSpy }));

import { atualizarFamiliaUP, type AtualizarFamiliaUPArgs } from '../atualizar-familia-up';
import { atualizarComposicao, type FilhoComp, type PortasComposicao, type ResultadoComposicao } from '../atualizar-composicao';

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
// falharDescricaoPara: itemExternoIds cujo garantirDescricao deve rejeitar (simula push falho).
function fakeConn(caps: { descricaoSeparada?: boolean; atacado?: boolean; falharDescricaoPara?: string[] } = {}) {
  const chamadas: Array<{ metodo: string; itemExternoId: string; texto?: string }> = [];
  const atacados: Array<{ itemExternoId: string; precoBase: number; faixas: unknown[] }> = [];
  const falhar = new Set(caps.falharDescricaoPara ?? []);
  return {
    capabilities: { variacoes: true, descricaoSeparada: !!caps.descricaoSeparada, catalogo: false, desconto: false, atacado: !!caps.atacado, dimensoesPacote: true },
    chamadas,
    atacados,
    subirFoto: async () => 'PIC',
    garantirDescricao: async (_ctx: unknown, itemExternoId: string, texto: string) => {
      chamadas.push({ metodo: 'garantirDescricao', itemExternoId, texto });
      if (falhar.has(itemExternoId)) throw new Error(`push falhou (${itemExternoId})`);
    },
    aplicarAtacado: async (_ctx: unknown, itemExternoId: string, precoBase: number, faixas: unknown[]) => {
      chamadas.push({ metodo: 'aplicarAtacado', itemExternoId });
      atacados.push({ itemExternoId, precoBase, faixas });
    },
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

beforeEach(() => { enfileirarSpy.mockReset(); notificarSpy.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

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
    expect(raizWrites.at(-1)!.payload.reconciliacao_tentativas).toBe(0);               // episódio termina aqui
    // Revisão Codex (reconciliador de convergência): a raiz não tinha FK direta pra uma família
    // específica — resolver "a família atual" por recência escolheria a família ERRADA quando
    // múltiplas linhas compartilham o mesmo codigo_pai (1 por lote). Grava referência durável
    // junto com mudando_composicao=true; limpa junto no fim do episódio.
    const ligou = raizWrites.find((w) => w.payload.mudando_composicao === true);
    expect(ligou!.payload.mudando_composicao_familia_id).toBe('fam-1');
    expect(raizWrites.at(-1)!.payload.mudando_composicao_familia_id).toBeNull();
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

  it('tentativas esgotadas → estado erro + familias erro + mudando_composicao limpa + reconciliacao_tentativas zerada', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await atualizarFamiliaUP(args({ admin, tentativas: 10, executarSaga: async () => ({ tipo: 'incompleto' }) }));
    expect(r.estado).toBe('erro');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeDefined();
    const limpeza = writes.find((w) => w.table === 'anuncios_externos' && w.payload.mudando_composicao === false);
    expect(limpeza).toBeDefined();
    // Revisão (achado durante o design do reconciliador de convergência): sem isso, uma família
    // que já gastou rodadas do reconciliador numa composição anterior começaria a PRÓXIMA
    // mudança de composição travada já com o contador antigo, esgotando o orçamento mais rápido
    // que deveria — reconciliacao_tentativas é por-EPISÓDIO de mudando_composicao=true, não vitalício.
    expect(limpeza!.payload.reconciliacao_tentativas).toBe(0);
  });
});

// A porta real `limparComposicao` (fechada em atualizar-familia-up.ts) é chamada pela saga tanto
// no sucesso quanto no esgotamento — testa a porta em si, não só os 2 casos acima que a exercitam
// indiretamente via executarSaga fake (que não chama a porta de verdade).
describe('atualizarFamiliaUP — porta limparComposicao zera reconciliacao_tentativas (sempre, não só no esgotamento)', () => {
  it('executarSaga REAL (não fake) chamando portas.limparComposicao() grava reconciliacao_tentativas=0 junto com mudando_composicao=false', async () => {
    const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    const executarSaga = async (portas: PortasComposicao): Promise<ResultadoComposicao> => {
      await portas.iniciarComposicao(['A']);
      await portas.limparComposicao();
      return { tipo: 'concluido', criadas: [] };
    };
    await atualizarFamiliaUP(args({ admin, executarSaga }));
    const limpeza = writes.filter((w) => w.table === 'anuncios_externos' && w.payload.mudando_composicao === false).at(-1);
    expect(limpeza?.payload.reconciliacao_tentativas).toBe(0);
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

  it('cores mudaram + capabilities → garantirDescricao (com a seção de cores recalculada) e aplicarAtacado por item final ativo', async () => {
    const conn = fakeConn({ descricaoSeparada: true, atacado: true });
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'garantirDescricao', itemExternoId: 'MLB1', texto: 'Desc da família\n\n🎨 CORES DISPONÍVEIS\n\n- Azul' });
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
  });

  // Fix 6 (revisão Opus+Codex): garantirDescricao reenviava o texto CRU persistido, sem recalcular
  // a seção "CORES DISPONÍVEIS" — depois de add/retirar cor, a descrição publicada ficava desatualizada.
  describe('atualizarFamiliaUP — Fix 6: sincroniza a lista de cores na descrição', () => {
    it('família com 2 itens ativos → ambos recebem a MESMA descrição recalculada (1 cálculo, N pushes)', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin } = fakeAdmin([
        { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
        { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
      ]);
      await atualizarFamiliaUP(args({
        admin, conn: conn as never,
        variacoes: [
          { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
          { codigo: 'B', cor: 'Verde', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        ] as never,
        executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
      }));
      const pushes = conn.chamadas.filter((c) => c.metodo === 'garantirDescricao');
      expect(pushes).toHaveLength(2);
      expect(new Set(pushes.map((p) => p.texto)).size).toBe(1); // mesma string pros 2 itens
      expect(pushes[0].texto).toContain('- Azul');
      expect(pushes[0].texto).toContain('- Verde');
    });

    it('cor indefinida ("Outra") é excluída da lista, igual ao Legacy', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
      await atualizarFamiliaUP(args({
        admin, conn: conn as never,
        variacoes: [
          { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
          { codigo: 'B', cor: 'Outra', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        ] as never,
        executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
      }));
      const texto = conn.chamadas.find((c) => c.metodo === 'garantirDescricao')!.texto!;
      expect(texto).toContain('- Azul');
      expect(texto).not.toContain('Outra');
    });

    it('todos os pushes OK → persiste familias.descricao_ml (novo texto), limpa descricao_status e NÃO notifica', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
      await atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) }));
      const w = writes.find((x) => x.table === 'familias' && 'descricao_ml' in x.payload);
      expect(w?.payload.descricao_ml).toBe('Desc da família\n\n🎨 CORES DISPONÍVEIS\n\n- Azul');
      const status = writes.find((x) => x.table === 'familias' && 'descricao_status' in x.payload);
      expect(status?.payload).toEqual({ descricao_status: null, descricao_erro: null });
      expect(notificarSpy).not.toHaveBeenCalled();
    });

    it('push falha em 1 de N itens → AINDA ASSIM persiste descricao_ml (é o estado desejado/referência), marca descricao_status=erro (durável, revisão Opus+Codex) e notifica LOUD (integracao)', async () => {
      const conn = fakeConn({ descricaoSeparada: true, falharDescricaoPara: ['MLB2'] });
      const { admin, writes } = fakeAdmin([
        { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
        { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
      ]);
      await atualizarFamiliaUP(args({
        admin, conn: conn as never,
        variacoes: [
          { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
          { codigo: 'B', cor: 'Verde', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        ] as never,
        executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
      }));
      const w = writes.find((x) => x.table === 'familias' && 'descricao_ml' in x.payload);
      expect(w?.payload.descricao_ml).toBeDefined(); // persiste mesmo com 1 falha (evita reverter cor já OK em MLB1)
      const status = writes.find((x) => x.table === 'familias' && 'descricao_status' in x.payload);
      expect(status?.payload.descricao_status).toBe('erro');
      expect(status?.payload.descricao_erro as string).toContain('MLB2');
      expect(notificarSpy).toHaveBeenCalledWith(admin, 'org-1', 'integracao', expect.stringContaining('MLB2'));
    });

    it('descrição recalculada é igual à já persistida → NÃO reescreve familias.descricao_ml, mas AINDA ASSIM faz o push (revisão Codex: reparo de push anterior que falhou não pode depender do texto local ter mudado)', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const jaSincronizada = 'Desc da família\n\n🎨 CORES DISPONÍVEIS\n\n- Azul';
      const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
      await atualizarFamiliaUP(args({
        admin, conn: conn as never,
        familia: { ...FAMILIA, descricao_ml: jaSincronizada } as never,
        executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }),
      }));
      // texto local já é o desejado → escrita em `familias` é redundante, evitada — mas o push ao
      // ML precisa continuar rodando sempre que houveMudanca=true (é a única forma de reparar um
      // push anterior que falhou nesse item específico; sem isso a divergência nunca se corrige).
      expect(writes.find((x) => x.table === 'familias' && 'descricao_ml' in x.payload)).toBeUndefined();
      expect(conn.chamadas).toContainEqual({ metodo: 'garantirDescricao', itemExternoId: 'MLB1', texto: jaSincronizada });
      expect(notificarSpy).not.toHaveBeenCalled();
    });

    it('consulta dos itens finais falha → NÃO trata como sucesso (não persiste, não empurra, notifica LOUD)', async () => {
      const conn = fakeConn({ descricaoSeparada: true, atacado: true });
      const { admin, writes } = fakeAdmin();
      admin.from = ((table: string) => {
        if (table === 'anuncios_externos_itens') {
          return { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }) };
        }
        return fakeAdmin().admin.from(table);
      }) as never;
      await atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) }));
      expect(conn.chamadas).toEqual([]); // nenhum push (nem descrição, nem atacado)
      expect(writes.find((x) => x.table === 'familias' && 'descricao_ml' in x.payload)).toBeUndefined();
      expect(notificarSpy).toHaveBeenCalledWith(admin, 'org-1', 'integracao', expect.any(String));
    });

    it('zero itens finais ativos (lista vazia) → NÃO trata como sucesso (não persiste descrição, loga)', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin, writes } = fakeAdmin([]); // nenhum filho ativo devolvido
      await atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) }));
      expect(conn.chamadas).toEqual([]);
      expect(writes.find((x) => x.table === 'familias' && 'descricao_ml' in x.payload)).toBeUndefined();
    });

    it('erro ao persistir familias.descricao_ml (Supabase resolve com {error}, não rejeita) → LOUD (notifica + marca descricao_status=erro), sem derrubar a publicação', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
      const originalFrom = admin.from;
      admin.from = ((table: string) => {
        const api = (originalFrom as (t: string) => Record<string, unknown>)(table) as Record<string, unknown> & { update: (p: Record<string, unknown>) => unknown };
        if (table === 'familias') {
          return {
            ...api,
            update: (payload: Record<string, unknown>) => 'descricao_ml' in payload
              ? { eq: () => Promise.resolve({ data: null, error: { message: 'constraint violation' } }) }
              : (api.update as (p: Record<string, unknown>) => unknown)(payload),
          };
        }
        return api;
      }) as never;
      await atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) }));
      expect(notificarSpy).toHaveBeenCalledWith(admin, 'org-1', 'integracao', expect.stringContaining('persistir'));
    });

    it('erro ao persistir o PRÓPRIO descricao_status (estado durável) → propaga (revisão Codex 3ª rodada: worker aplica orçamento de retry via QStash em vez de mascarar)', async () => {
      const conn = fakeConn({ descricaoSeparada: true });
      const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
      const originalFrom = admin.from;
      admin.from = ((table: string) => {
        const api = (originalFrom as (t: string) => Record<string, unknown>)(table) as Record<string, unknown> & { update: (p: Record<string, unknown>) => unknown };
        if (table === 'familias') {
          return {
            ...api,
            update: (payload: Record<string, unknown>) => 'descricao_status' in payload
              ? { eq: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }
              : (api.update as (p: Record<string, unknown>) => unknown)(payload),
          };
        }
        return api;
      }) as never;
      await expect(atualizarFamiliaUP(args({ admin, conn: conn as never, executarSaga: async () => ({ tipo: 'concluido', criadas: ['B'] }) })))
        .rejects.toThrow(/descricao_status/);
    });
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

  // ADR-0160 (I10) — "Adicionar variação" (ADR-0129) não pode repreçar as cores já publicadas.
  //
  // `preservarPublicadas` era calculado DEPOIS do `return rodarUP` no worker e nunca chegava aqui:
  // a saga rodava com somenteEstoque=false e a reposição empurrava preço a todas as cores vivas.
  // Como o lote manual nasce por cópia e o `process-familia` recalcula `preco_publicacao` das
  // variações não-pinadas, um preço que ninguém revisou ia parar nas irmãs — num fluxo cuja
  // promessa é tocar só a cor nova.
  it('I10: preservarPublicadas anula o preço das cores ativas e mantém o da cor nova', async () => {
    let entradaVista: Parameters<typeof atualizarComposicao>[1] | null = null;
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin,
      preservarPublicadas: true,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'NOVA', cor: 'Rosa', estoque: 2, preco_publicacao: 31, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async (_p, e) => { entradaVista = e; return { tipo: 'concluido', criadas: ['NOVA'] }; },
    }));
    // A já publicada → null = preserva o preço vivo do item no ML.
    expect(entradaVista!.precoPorSku.A).toBeNull();
    // A cor nova entra com o preço dela — é o ponto do fluxo.
    expect(entradaVista!.precoPorSku.NOVA).toBe(31);
    // E a ficha das irmãs não é reescrita (ADR-0157 manda atributos na reposição).
    expect(entradaVista!.atributosFamilia).toBeUndefined();
  });

  it('ADR-0197: participante de kit chega à saga e fica fora da conferência; org sem módulo, nenhum', async () => {
    const filhos = [
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ];
    const variacoes = ['A', 'B'].map((codigo) => ({ codigo, cor: codigo, estoque: 3, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null }));
    const rodar = async (modulos: string[]) => {
      const { admin } = fakeAdmin(filhos);
      const lidas: string[] = [];
      const kitAdmin = {
        ...(admin as Record<string, unknown>),
        from: (t: string) => {
          lidas.push(t);
          if (t.startsWith('kit_variacao_')) {
            return { select: () => ({ eq: () => ({ in: async () => ({ data: t === 'kit_variacao_componentes' ? [{ codigo: 'A' }] : [], error: null }) }) }) };
          }
          return (admin as { from: (t: string) => unknown }).from(t);
        },
      };
      let entradaVista: Parameters<typeof atualizarComposicao>[1] | null = null;
      const r = await atualizarFamiliaUP(args({
        admin: kitAdmin as never, variacoes: variacoes as never,
        familia: { ...FAMILIA, organizations: { modulos_habilitados: modulos } } as never,
        executarSaga: async (_p, e) => { entradaVista = e; return { tipo: 'sem_mudanca' }; },
      }));
      return { r, entradaVista: entradaVista!, lidas };
    };

    const com = await rodar(['kit_variacao']);
    expect([...(com.entradaVista.participantes ?? [])]).toEqual(['A']);
    expect(com.r.estado === 'ok' && com.r.enviados?.map((e) => e.itemExternoId)).toEqual(['MLB2']);

    const sem = await rodar([]);
    expect([...(sem.entradaVista.participantes ?? [])]).toEqual([]);
    expect(sem.r.estado === 'ok' && sem.r.enviados?.map((e) => e.itemExternoId)).toEqual(['MLB1', 'MLB2']);
    expect(sem.lidas.filter((t) => t.startsWith('kit_') || t === 'organizations')).toEqual([]);
    // Com o módulo: organizations não (embed), kit_variacao_skus/componentes e os SKUs da raiz (Task 7).
    expect(sem.lidas.length).toBe(com.lidas.length - 3);
  });

  it('Task 7: participante fora da planilha vai como participante à saga e o lote ganha aviso; sem módulo, nada', async () => {
    const filhos = [
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ];
    const variacoes = [{ codigo: 'A', cor: 'A', estoque: 3, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null }];
    const rodar = async (modulos: string[]) => {
      const { admin, writes } = fakeAdmin(filhos);
      const kitAdmin = {
        ...(admin as Record<string, unknown>),
        from: (t: string) => {
          if (t.startsWith('kit_variacao_')) {
            return { select: () => ({ eq: () => ({ in: async (_c: string, cods: string[]) => ({
              data: t === 'kit_variacao_componentes' ? cods.filter((c) => c === 'B').map((codigo) => ({ codigo })) : [], error: null,
            }) }) }) };
          }
          return (admin as { from: (t: string) => unknown }).from(t);
        },
      };
      let entradaVista: Parameters<typeof atualizarComposicao>[1] | null = null;
      await atualizarFamiliaUP(args({
        admin: kitAdmin as never, variacoes: variacoes as never,
        familia: { ...FAMILIA, organizations: { modulos_habilitados: modulos } } as never,
        executarSaga: async (_p, e) => {
          entradaVista = e;
          return e.participantes?.has('B') ? { tipo: 'sem_mudanca', mantidosKit: ['B'] } : { tipo: 'sem_mudanca' };
        },
      }));
      const fam = writes.filter((w) => w.table === 'familias').map((w) => w.payload);
      return { entradaVista: entradaVista!, fam };
    };

    const com = await rodar(['kit_variacao']);
    expect(com.entradaVista.participantes?.has('B')).toBe(true);
    expect(com.fam).toContainEqual(expect.objectContaining({
      status: 'publicado', erro_mensagem: expect.stringMatching(/kit com variação \(B\).*Gerenciar kit/),
    }));

    const sem = await rodar([]);
    expect(sem.fam.every((p) => p.erro_mensagem === undefined)).toBe(true);
  });

  it('sem preservarPublicadas o UPDATE comum segue empurrando preço em todas', async () => {
    let entradaVista: Parameters<typeof atualizarComposicao>[1] | null = null;
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async (_p, e) => { entradaVista = e; return { tipo: 'concluido', criadas: [] }; },
    }));
    expect(entradaVista!.precoPorSku.A).toBe(10);
  });

  // Trava da oferta (emenda ADR-0196): `preservarPublicadas` só cobre os ativos; o reprovado pode estar
  // em qualquer status. Saga real, para provar o payload de reposição.
  it('semPrecoPara: SKU reprovado sai sem price na reposição, ativo, criado ou readicionado', async () => {
    const filhos: FilhoComp[] = [
      { sku: 'ATIVO', status: 'ativo', retirado: false, itemExternoId: 'MLB1', familyId: 'F' },
      { sku: 'CRIADO', status: 'criado', retirado: false, itemExternoId: 'MLB2', familyId: 'F' },
      { sku: 'READD', status: 'pausado', retirado: true, itemExternoId: 'MLB3', familyId: 'F' },
      { sku: 'LIVRE', status: 'ativo', retirado: false, itemExternoId: 'MLB4', familyId: 'F' },
    ];
    const repostos: Record<string, { price?: number }> = {};
    const nada = async () => {};
    const portas = {
      listar: async () => filhos, iniciarComposicao: nada, limparComposicao: nada, salvarConfirmacao: nada,
      ativar: nada, confirmarPreco: nada,
      marcarAtivo: async (sku: string) => { Object.assign(filhos.find((f) => f.sku === sku)!, { status: 'ativo', retirado: false }); },
      confirmar: async () => ({ ok: true, status: 'active', familyId: 'F' }),
      repor: async (id: string, patch: { price?: number }) => { repostos[id] = patch; },
    } as unknown as PortasComposicao;
    const cor = (codigo: string, preco_publicacao: number) => ({ codigo, cor: codigo, estoque: 1, preco_publicacao, gtin: null, imagem_path: null, ml_picture_id: null });
    const { admin } = fakeAdmin(filhos.map((f) => ({ sku: f.sku, status: f.status, retirado: f.retirado, item_externo_id: f.itemExternoId, family_id: f.familyId })));
    await atualizarFamiliaUP(args({
      admin, semPrecoPara: ['ATIVO', 'CRIADO', 'READD'],
      variacoes: [cor('ATIVO', 10), cor('CRIADO', 20), cor('READD', 30), cor('LIVRE', 40)] as never,
      executarSaga: (_p, e) => atualizarComposicao(portas, e),
    }));
    expect(Object.keys(repostos).sort()).toEqual(['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    expect(repostos.MLB1).not.toHaveProperty('price');
    expect(repostos.MLB2).not.toHaveProperty('price');
    expect(repostos.MLB3).not.toHaveProperty('price');
    expect(repostos.MLB4!.price).toBe(40);
  });

  // ADR-0160 (I5) / ADR-0196 — o PxQ do ML é por ITEM e o valor é ABSOLUTO (ADR-0041): cada cor recebe
  // as faixas sobre o próprio preço. Base de outra cor seria dinheiro errado, em silêncio.
  it('I5: preços divergentes + atacado ativo → cada item recebe as faixas sobre o próprio preço', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'B', cor: 'Rosa', estoque: 1, preco_publicacao: 25, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    const faixas = [{ min_unidades: 3, desconto_pct: 8 }];
    expect(conn.atacados).toEqual([
      { itemExternoId: 'MLB1', precoBase: 10, faixas },
      { itemExternoId: 'MLB2', precoBase: 25, faixas },
    ]);
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro')).toBeUndefined();
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'aplicado')).toBeDefined();
  });

  // Sem o preço do próprio item não há base legítima: a cor vizinha daria valor B2B de outra cor.
  it('item sem preço → não aplica em nenhum e grava atacado_status=erro', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'B', cor: 'Rosa', estoque: 1, preco_publicacao: null, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.atacados).toEqual([]);
    const erro = writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro');
    expect(String(erro?.payload.atacado_erro)).toMatch(/preço-base/);
  });

  // Faixa viva e preço vivo por item, no formato real das APIs do ML.
  function mlVivo(itens: Record<string, { preco: number; faixas?: boolean } | 'falha'>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = /\/items\/(MLB\d+)\/prices/.exec(url)?.[1] ?? /ids=(MLB\d+)/.exec(url)?.[1] ?? '';
      const x = itens[id];
      if (x === 'falha' || !x) return new Response(null, { status: 500 });
      if (url.includes('/prices')) {
        const b2b = { type: 'standard', amount: x.preco * 0.9, conditions: { context_restrictions: ['user_type_business'], min_purchase_unit: 3 } };
        return new Response(JSON.stringify({ prices: x.faixas ? [b2b] : [] }), { status: 200 });
      }
      return new Response(JSON.stringify([{ status_code: 200, body: { id, price: x.preco, status: 'active' } }]), { status: 200 });
    }));
  }

  // I10: a irmã com faixas fica como está. A cor ativada numa tentativa que falhou é "ativa" no retry, mas
  // sem faixas, e por isso entra pelo preço vivo.
  it('Adicionar variação: aplica na cor nova, e a irmã com faixas fica intacta', async () => {
    mlVivo({ MLB1: { preco: 10, faixas: true } });
    const conn = fakeConn({ atacado: true });
    const nova: Record<string, unknown> = { sku: 'B', status: 'pendente', retirado: false, item_externo_id: null, family_id: null };
    const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }, nova]);
    const executarSaga = async (): Promise<ResultadoComposicao> => {
      Object.assign(nova, { status: 'ativo', item_externo_id: 'MLB2', family_id: 'F' });
      return { tipo: 'concluido', criadas: ['B'] };
    };
    await atualizarFamiliaUP(args({
      admin, conn: conn as never, preservarPublicadas: true,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'B', cor: 'Rosa', estoque: 1, preco_publicacao: 25, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga,
    }));
    expect(conn.atacados.map((a) => [a.itemExternoId, a.precoBase])).toEqual([['MLB2', 25]]);
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'aplicado')).toBeDefined();
  });

  it('semPrecoPara: SKU reprovado mantém as faixas vivas, ou entra pelo preço vivo, e o atacado não vira erro', async () => {
    mlVivo({ MLB1: { preco: 10, faixas: true }, MLB2: { preco: 20 } });
    const conn = fakeConn({ atacado: true });
    const filho = (sku: string, item_externo_id: string) => ({ sku, status: 'ativo', retirado: false, item_externo_id, family_id: 'F' });
    const { admin, writes } = fakeAdmin([filho('A', 'MLB1'), filho('B', 'MLB2'), filho('C', 'MLB3')]);
    const cor = (codigo: string, preco_publicacao: number) => ({ codigo, cor: codigo, estoque: 1, preco_publicacao, gtin: null, imagem_path: null, ml_picture_id: null });
    await atualizarFamiliaUP(args({
      admin, conn: conn as never, semPrecoPara: ['A', 'B'],
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [cor('A', 5), cor('B', 5), cor('C', 30)] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.atacados.map((a) => [a.itemExternoId, a.precoBase])).toEqual([['MLB2', 20], ['MLB3', 30]]);
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'aplicado')).toBeDefined();
  });

  it('Adicionar variação em duas tentativas: a cor ativada na que falhou recebe as faixas no retry', async () => {
    mlVivo({ MLB1: { preco: 10, faixas: true }, MLB2: { preco: 25 }, MLB3: { preco: 30 } });
    const conn = fakeConn({ atacado: true });
    const b: Record<string, unknown> = { sku: 'B', status: 'pendente', retirado: false, item_externo_id: null, family_id: null };
    const c: Record<string, unknown> = { sku: 'C', status: 'pendente', retirado: false, item_externo_id: null, family_id: null };
    const { admin } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }, b, c]);
    const cor = (codigo: string, preco_publicacao: number) => ({ codigo, cor: codigo, estoque: 1, preco_publicacao, gtin: null, imagem_path: null, ml_picture_id: null });
    const tentativa = (executarSaga: () => Promise<ResultadoComposicao>) => atualizarFamiliaUP(args({
      admin, conn: conn as never, preservarPublicadas: true,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [cor('A', 10), cor('B', 25), cor('C', 30)] as never, executarSaga,
    }));

    const r1 = await tentativa(async () => {
      Object.assign(b, { status: 'ativo', item_externo_id: 'MLB2', family_id: 'F' });
      return { tipo: 'incompleto' };
    });
    expect(r1.estado).toBe('retry');
    expect(conn.atacados).toEqual([]);

    await tentativa(async () => {
      Object.assign(c, { status: 'ativo', item_externo_id: 'MLB3', family_id: 'F' });
      return { tipo: 'concluido', criadas: ['C'] };
    });
    expect(conn.atacados.map((a) => [a.itemExternoId, a.precoBase])).toEqual([['MLB2', 25], ['MLB3', 30]]);
  });

  it('Adicionar variação: leitura inconclusiva da irmã → erro, sem enviar', async () => {
    mlVivo({ MLB1: 'falha' });
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never, preservarPublicadas: true,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [{ codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null }] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.atacados).toEqual([]);
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro')).toBeDefined();
  });

  // R$ 1,00 com 0,1% arredonda para R$ 1,00: faixa igual ao base (conta real do payload).
  it('faixa arredondada igual ao base: não envia e grava erro', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([{ sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' }]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 0.1 }] } as never,
      variacoes: [{ codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 1, gtin: null, imagem_path: null, ml_picture_id: null }] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.atacados).toEqual([]);
    const erro = writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro');
    expect(String(erro?.payload.atacado_erro)).toMatch(/igual ou acima/);
  });

  it('faixas removidas limpam todos os itens, mesmo sem preço conhecido', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never, preservarPublicadas: true,
      familia: { ...FAMILIA, atacado: [], atacado_status: 'aplicado' } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: null, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'B', cor: 'Rosa', estoque: 1, preco_publicacao: 25, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.atacados.map((a) => [a.itemExternoId, a.faixas])).toEqual([['MLB1', []], ['MLB2', []]]);
  });

  // Regressão inversa: preço uniforme continua aplicando PxQ normalmente em todos os itens.
  it('preços uniformes + atacado ativo → aplica PxQ em cada item, como antes', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
      { sku: 'B', status: 'ativo', retirado: false, item_externo_id: 'MLB2', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
        { codigo: 'B', cor: 'Rosa', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB2' });
  });

  // ADR-0160 (I7) — config de atacado por cor não pode ser ignorada no caminho UP, que aplica só a
  // config família-level. Publicar o valor da família calando a config por cor é dinheiro diferente
  // do que o operador configurou, com resposta 200.
  it('I7: cor com atacado DIFERENTE do da família → não aplica PxQ, grava erro', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin, writes } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 8 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null,
          atacado: [{ min_unidades: 10, desconto_pct: 20 }] },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.chamadas.filter((c: { metodo: string }) => c.metodo === 'aplicarAtacado')).toEqual([]);
    expect(writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro')).toBeDefined();
  });

  // `ConfigGruposPreco` grava `[]` explícito ao desmarcar o atacado — não-nulo de propósito (null
  // significaria "herdar" e dispararia LOUD no publish do split). Se a trava olhasse "coluna
  // preenchida", toda família que passou por aquele editor ficaria com o atacado recusado PARA
  // SEMPRE ao migrar para UP, sem saída: a UI esconde o editor de faixas sob UP.
  it('cor com atacado IGUAL ao da família não dispara I7', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [{ min_unidades: 5, desconto_pct: 5 }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null,
          atacado: [{ min_unidades: 5, desconto_pct: 5 }] },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
  });

  it('atacado vazio na cor e na família não dispara I7', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [], atacado_status: 'aplicado' } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null,
          atacado: [] },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    // Chega ao ramo de limpeza (faixas vazias) em vez de parar no I7.
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
  });

  // O I7 não pode impedir DESLIGAR o atacado: faixas removidas + já aplicado tem que LIMPAR o PxQ
  // no ML. Parar aqui deixaria o Mercado Livre vendendo no atacado enquanto o app diz "erro".
  it('faixas removidas + config por cor → ainda LIMPA o PxQ no ML', async () => {
    const conn = fakeConn({ atacado: true });
    const { admin } = fakeAdmin([
      { sku: 'A', status: 'ativo', retirado: false, item_externo_id: 'MLB1', family_id: 'F' },
    ]);
    await atualizarFamiliaUP(args({
      admin, conn: conn as never,
      familia: { ...FAMILIA, atacado: [], atacado_status: 'aplicado' } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null,
          atacado: [{ min_unidades: 10, desconto_pct: 20 }] },
      ] as never,
      executarSaga: async () => ({ tipo: 'concluido', criadas: [] }),
    }));
    expect(conn.chamadas).toContainEqual({ metodo: 'aplicarAtacado', itemExternoId: 'MLB1' });
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

// Reconciliador de convergência (ADR-0088): reusa atualizarFamiliaUP pra convergir uma família
// travada em mudando_composicao=true. Precisa convergir pro skus_esperados JÁ GRAVADO na raiz
// (o snapshot da mutação interrompida), não pro que `variacoes` diz agora — senão o reconciliador
// poderia reintroduzir uma cor que o operador já tinha decidido remover num UPDATE mais recente.
describe('atualizarFamiliaUP — devolve o que enviou para a conferência (ADR-0195)', () => {
  const filhos = [
    { sku: 'A', item_externo_id: 'MLB-A', retirado: false, status: 'ativo' },
    { sku: 'B', item_externo_id: 'MLB-B', retirado: false, status: 'ativo' },
    { sku: 'C', item_externo_id: 'MLB-C', retirado: true, status: 'pausado' },
    { sku: 'D', item_externo_id: null, retirado: false, status: 'pendente' },
    { sku: 'FORA', item_externo_id: 'MLB-F', retirado: false, status: 'ativo' },
  ];
  const variacoes = [
    { codigo: 'A', cor: 'Azul', estoque: 3 }, { codigo: 'B', cor: 'Bege', estoque: 0 },
    { codigo: 'C', cor: 'Cinza', estoque: 9 }, { codigo: 'D', cor: 'Dourado', estoque: 9 },
  ] as never;

  it.each(['sem_mudanca', 'concluido'] as const)('%s: um item por filho ativo desejado', async (tipo) => {
    const { admin } = fakeAdmin(filhos);
    const r = await atualizarFamiliaUP(args({
      admin, variacoes, somenteEstoque: true,
      executarSaga: async () => (tipo === 'concluido' ? { tipo, criadas: [] } : { tipo }),
    }));
    expect(r).toMatchObject({
      estado: 'ok',
      enviados: [
        { itemExternoId: 'MLB-A', modelo: 'item', capados: 0, enviado: { A: { qtd: 3, anterior: null, variacao_id: null } } },
        { itemExternoId: 'MLB-B', modelo: 'item', capados: 0, enviado: { B: { qtd: 0, anterior: null, variacao_id: null } } },
      ],
    });
  });

  it('Adicionar variação não registra', async () => {
    const { admin } = fakeAdmin(filhos);
    const r = await atualizarFamiliaUP(args({
      admin, variacoes, preservarPublicadas: true, executarSaga: async () => ({ tipo: 'sem_mudanca' }),
    }));
    expect(r).toMatchObject({ estado: 'ok' });
    expect((r as { enviados?: unknown }).enviados).toBeUndefined();
  });

  it('falha ao ler os filhos não derruba o desfecho', async () => {
    const base = fakeAdmin(filhos).admin as unknown as { from: (t: string) => unknown; storage: unknown };
    const admin = {
      ...base,
      from: (t: string) => (t === 'anuncios_externos_itens'
        ? { select: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }) }) }
        : base.from(t)),
    } as never;
    const r = await atualizarFamiliaUP(args({ admin, variacoes, somenteEstoque: true, executarSaga: async () => ({ tipo: 'sem_mudanca' }) }));
    expect(r).toMatchObject({ estado: 'ok' });
    expect((r as { enviados?: unknown }).enviados).toBeUndefined();
  });
});

describe('atualizarFamiliaUP — skusDesejadosOverride (reconciliador de convergência)', () => {
  it('quando fornecido, executarSaga recebe o override em vez de variacoes.map(codigo)', async () => {
    const { admin } = fakeAdmin();
    let entradaVista: { skusDesejados: string[] } | null = null;
    const executarSaga = async (_portas: PortasComposicao, entrada: { skusDesejados: string[] }): Promise<ResultadoComposicao> => {
      entradaVista = entrada;
      return { tipo: 'concluido', criadas: [] };
    };
    await atualizarFamiliaUP(args({
      admin, executarSaga,
      variacoes: [{ codigo: 'A', cor: 'Azul', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: null }] as never,
      skusDesejadosOverride: ['X', 'Y', 'Z'],
    }));
    expect(entradaVista).not.toBeNull();
    expect(entradaVista!.skusDesejados).toEqual(['X', 'Y', 'Z']); // não ['A']
  });

  it('sem override, comportamento padrão intacto (variacoes.map(codigo))', async () => {
    const { admin } = fakeAdmin();
    let entradaVista: { skusDesejados: string[] } | null = null;
    const executarSaga = async (_portas: PortasComposicao, entrada: { skusDesejados: string[] }): Promise<ResultadoComposicao> => {
      entradaVista = entrada;
      return { tipo: 'concluido', criadas: [] };
    };
    await atualizarFamiliaUP(args({ admin, executarSaga }));
    expect(entradaVista!.skusDesejados).toEqual(['A']); // default de FAMILIA/args()
  });
});

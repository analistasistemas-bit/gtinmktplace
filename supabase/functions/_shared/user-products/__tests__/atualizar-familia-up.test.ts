import { describe, it, expect, beforeEach, vi } from 'vitest';

// queue.ts puxa QStash — mockado. O spy prova o reenfileirar de catálogo (Fix 5).
const { enfileirarSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarSpy }));

// notificacoes puxa Telegram/Supabase reais — mockado. O spy prova o alerta LOUD (Fix 6).
const { notificarSpy } = vi.hoisted(() => ({ notificarSpy: vi.fn() }));
vi.mock('../../notificacoes/config.ts', () => ({ notificarCategoria: notificarSpy }));

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
// falharDescricaoPara: itemExternoIds cujo garantirDescricao deve rejeitar (simula push falho).
function fakeConn(caps: { descricaoSeparada?: boolean; atacado?: boolean; falharDescricaoPara?: string[] } = {}) {
  const chamadas: Array<{ metodo: string; itemExternoId: string; texto?: string }> = [];
  const falhar = new Set(caps.falharDescricaoPara ?? []);
  return {
    capabilities: { variacoes: true, descricaoSeparada: !!caps.descricaoSeparada, catalogo: false, desconto: false, atacado: !!caps.atacado, dimensoesPacote: true },
    chamadas,
    subirFoto: async () => 'PIC',
    garantirDescricao: async (_ctx: unknown, itemExternoId: string, texto: string) => {
      chamadas.push({ metodo: 'garantirDescricao', itemExternoId, texto });
      if (falhar.has(itemExternoId)) throw new Error(`push falhou (${itemExternoId})`);
    },
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

beforeEach(() => { enfileirarSpy.mockReset(); notificarSpy.mockReset(); });

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
      familia: { ...FAMILIA, atacado: [{ quantidade: 3, preco: 8 }] } as never,
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

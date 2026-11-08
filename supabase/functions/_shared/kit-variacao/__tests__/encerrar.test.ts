import { describe, it, expect } from 'vitest';
import { MLApiError } from '../../ml/erro-ml.ts';
import { avancarSaga, type AlvoSaga, type DepsSaga, type TransferenciaSaga } from '../saga.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { atrasoEncerrar, avisarKitsEncerrados, faixaEncerrar, type Notificar } from '../encerrar.ts';

// ADR-0200, emenda "Encerrar kit": banco e ML em memória. Só GET e PUT status=closed; nada de quantidade.
interface Item { id: string; status: string; subStatus: string[] }
const INICIO = Date.parse('2026-11-08T12:00:00.000Z');

function alvo(up_id: string, codigo: string, item_ids: string[]): AlvoSaga {
  return {
    up_id, codigo, papel: 'destino', delta: 0, item_ids, qtd_passo1: null, passo1_em: null, ids_passo1: null,
    valor_anterior: null, valor_alvo: null, pausado_pela_saga: [], intencao_escrita_em: null, recusa_definitiva_em: null,
    escrita_em: null, confirmada_em: null, item_escrita: null, recusas: 0, repausar: [], fase: null, marca_ordem: null,
    criar: false, up_criado: null, item_criado: null,
  };
}
const pausado = (id: string): Item => ({ id, status: 'paused', subStatus: ['out_of_stock', 'paused_by_seller'] });

function cenario() {
  const s = {
    agora: INICIO,
    // Kit de 2 combinações; a primeira tem cópia de catálogo que o local não conhece (só a busca por UP mostra).
    ups: {
      'UP-1': [pausado('MLB-1'), pausado('MLB-1C')],
      'UP-2': [pausado('MLB-2')],
    } as Record<string, Item[]>,
    t: {
      id: 'T1', org_id: 'ORG', tipo: 'encerrar', passo: 'fechar', estado: 'ativa', versao_politica: 0,
      passo_em: new Date(INICIO).toISOString(), alerta: null,
    } as unknown as TransferenciaSaga,
    alvos: [alvo('UP-1', 'K1', ['MLB-1']), alvo('UP-2', 'K2', ['MLB-2'])],
    puts: [] as string[],
    filas: [] as number[],
    avisos: [] as Array<{ texto: string; chave: string }>,
    alertas: [] as string[],
    finalizadas: 0,
    concluidos: 0,
    falhaAviso: false,
    token: null as string | null,
    ate: 0,
    /** Falha injetada no PUT: o erro e se o ML aplicou mesmo assim. */
    falhaPut: (_id: string): { erro: Error; aplica: boolean } | null => null,
    falhaLer: (_up: string): Error | null => null,
    /** ML aceita o PUT e não fecha (ignora). */
    ignora: new Set<string>(),
  };
  const validar = (token: string) => {
    if (token !== s.token || s.agora >= s.ate || s.t.estado !== 'ativa') throw new Error('kit_execucao_vencida');
  };
  const deps: DepsSaga = {
    repo: {
      async reivindicar(_id, token, prazoS) {
        if (s.t.estado !== 'ativa' || (s.token !== null && s.agora < s.ate)) return false;
        s.token = token; s.ate = s.agora + prazoS * 1000; return true;
      },
      async carregar() { return { transferencia: structuredClone(s.t), alvos: structuredClone(s.alvos) }; },
      async salvarTransferencia(_id, token, patch) {
        validar(token);
        if (patch.passo) s.t.passo = patch.passo;
        if (patch.alerta !== undefined) s.t.alerta = patch.alerta;
        if (patch.travar) s.t.estado = 'travada';
      },
      async salvarAlvo(_id, token, upId, patch) {
        validar(token);
        Object.assign(s.alvos.find((a) => a.up_id === upId)!, patch);
      },
      finalizar: async () => { throw new Error('finalizar de quantidade inesperado'); },
      ledger: async () => { throw new Error('ledger inesperado'); },
      podeReativar: async () => { throw new Error('reativar inesperado'); },
      async liberar(_id, token) { if (s.token === token) { s.token = null; s.ate = 0; } },
      versaoPolitica: async () => 0,
      conferirSaldo: async () => { throw new Error('saldo inesperado'); },
      registrarItem: async () => { throw new Error('registro inesperado'); },
    },
    ml: {
      async lerOferta(upId, esperados) {
        const f = s.falhaLer(upId);
        if (f) throw f;
        const itens = s.ups[upId];
        for (const id of esperados) if (!itens.some((i) => i.id === id)) throw new Error(`UP ${upId}: busca sem ${id}`);
        return { upId, versao: 1, locais: [{ type: 'selling_address', quantity: 0 }], quantidade: 0, somenteSellingAddress: true,
          itens: structuredClone(itens) };
      },
      lerItens: async () => { throw new Error('leitura direta inesperada'); },
      listarPendentes: async () => { throw new Error('pendentes inesperado'); },
      importarPedidos: async () => { throw new Error('importação inesperada'); },
      putQuantidade: async () => { throw new Error('PUT de quantidade inesperado'); },
      async putStatus(itemId, status) {
        s.puts.push(`${itemId}:${status}`);
        const f = s.falhaPut(itemId);
        const item = Object.values(s.ups).flat().find((i) => i.id === itemId)!;
        if (!f || f.aplica) if (!s.ignora.has(itemId)) { item.status = status; item.subStatus = []; }
        if (f) throw f.erro;
      },
      prepararItem: async () => { throw new Error('criação inesperada'); },
      buscarItemCriado: async () => { throw new Error('busca inesperada'); },
    },
    enfileirar: async (_id, delay) => { s.filas.push(delay); },
    alertar: async (texto) => { s.alertas.push(texto); },
    agora: () => new Date(s.agora),
    quarentenaS: 300,
    novoToken: () => crypto.randomUUID(),
    encerramento: {
      async finalizar(_id, token) {
        validar(token);
        if (s.alvos.some((a) => !a.escrita_em)) throw new Error('kit_encerrar_pendente');
        s.finalizadas++;
        s.t.estado = 'concluida';
        s.t.passo = 'fim';
      },
      // Idempotente pela chave, como notificarCategoria com chave; `falhaAviso` simula envio que falhou.
      async avisar(texto, chave) {
        if (s.falhaAviso) { s.falhaAviso = false; throw new Error('telegram fora'); }
        if (!s.avisos.some((a) => a.chave === chave)) s.avisos.push({ texto, chave });
      },
      async avisarConcluidos() { s.concluidos++; },
    },
  };
  const rodar = () => avancarSaga(deps, 'T1');
  return { s, deps, rodar };
}

describe('Encerrar kit (saga, tipo encerrar)', () => {
  it('fecha todos os itens abertos do UP, inclusive a cópia de catálogo que só a busca mostra; confirma pela leitura', async () => {
    const { s, rodar } = cenario();
    const r1 = await rodar();
    expect(r1.acao).toBe('reagendada');
    expect(s.puts.sort()).toEqual(['MLB-1:closed', 'MLB-1C:closed', 'MLB-2:closed']);
    expect(s.alvos.every((a) => a.intencao_escrita_em)).toBe(true);
    expect(s.alvos.some((a) => a.escrita_em)).toBe(false);   // PUT não confirma: só a leitura
    expect(s.filas).toEqual([5]);

    s.agora += 5_000;
    const r2 = await rodar();
    expect(r2.acao).toBe('concluida');
    expect(s.puts).toHaveLength(3);                            // nada reenviado: já closed = confirmado
    expect(s.alvos.every((a) => a.escrita_em)).toBe(true);
    expect(s.alvos.every((a) => a.confirmada_em === null)).toBe(true);   // marca d'água do SKU intocada
    expect(s.finalizadas).toBe(1);
    expect(s.concluidos).toBe(1);   // aviso de conclusão durável, depois do commit
    expect(s.avisos).toEqual([]);
  });

  it('item já closed na primeira leitura: confirma sem PUT', async () => {
    const { s, rodar } = cenario();
    for (const up of Object.values(s.ups)) for (const i of up) i.status = 'closed';
    expect((await rodar()).acao).toBe('concluida');
    expect(s.puts).toEqual([]);
  });

  it('erro (4xx ou leitura) num item não impede fechar os outros', async () => {
    const { s, rodar } = cenario();
    s.falhaPut = (id) => (id === 'MLB-1' ? { erro: new MLApiError(400, 'item em revisão'), aplica: false } : null);
    s.falhaLer = (up) => (up === 'UP-2' ? new Error('ML 500') : null);
    const r = await rodar();
    expect(r.acao).toBe('reagendada');
    expect(s.puts).toEqual(['MLB-1:closed', 'MLB-1C:closed']);   // a cópia fechou mesmo com o principal recusado
    expect(s.alvos[0].recusas).toBe(1);
    // Na releitura, o UP-2 lê e fecha; o MLB-1 recebe novo PUT (fechar é idempotente) e passa.
    s.falhaPut = () => null; s.falhaLer = () => null;
    s.agora += 5_000;
    await rodar();
    expect(s.puts).toEqual(['MLB-1:closed', 'MLB-1C:closed', 'MLB-1:closed', 'MLB-2:closed']);
    s.agora += 5_000;
    expect((await rodar()).acao).toBe('concluida');
  });

  it('resultado incerto não reenvia às cegas: relê antes, e closed confirma', async () => {
    const { s, rodar } = cenario();
    // Timeout sem status: o ML aplicou.
    s.falhaPut = () => ({ erro: new Error('timeout'), aplica: true });
    await rodar();
    expect(s.puts).toHaveLength(3);
    s.falhaPut = () => null;
    s.agora += 5_000;
    expect((await rodar()).acao).toBe('concluida');
    expect(s.puts).toHaveLength(3);   // a releitura viu closed: nenhum PUT novo
  });

  it('leitura que falha sempre: o prazo conta desde antes da primeira leitura e o alerta diz a causa', async () => {
    const { s, rodar } = cenario();
    s.falhaLer = () => new Error('ML 401');
    await rodar();
    expect(s.alvos.every((a) => a.intencao_escrita_em && !a.escrita_em)).toBe(true);
    s.agora += 16 * 60_000;
    await rodar();
    expect(s.avisos.map((a) => a.chave)).toEqual(['kit_encerrar_pendente:T1:15 min']);
    expect(s.t.alerta).toContain('não respondeu à leitura');
    expect(s.puts).toEqual([]);
    expect(s.finalizadas).toBe(0);
  });

  it('ML ignora o fechamento: backoff crescente e alerta só depois da carência única da saga, uma vez por faixa', async () => {
    const { s, rodar } = cenario();
    s.ignora.add('MLB-2');
    await rodar();
    expect(s.avisos).toEqual([]);
    s.agora += 2 * 60_000;              // 2 min: dentro da carência (CARENCIA_ALERTA_MS = 3 min)
    await rodar();
    expect(s.avisos).toEqual([]);
    expect(s.t.estado).toBe('ativa');   // nunca trava
    s.agora += 2 * 60_000;              // 4 min
    await rodar();
    expect(s.avisos.map((a) => a.chave)).toEqual(['kit_encerrar_pendente:T1:3 min']);
    expect(s.avisos[0].texto).toContain('MLB-2');
    s.agora += 5 * 60_000;              // 9 min, mesma faixa: não repete
    await rodar();
    expect(s.avisos).toHaveLength(1);
    s.agora += 7 * 60_000;              // 16 min
    await rodar();
    s.agora += 45 * 60_000;             // 61 min
    await rodar();
    expect(s.avisos.map((a) => a.chave)).toEqual([
      'kit_encerrar_pendente:T1:3 min', 'kit_encerrar_pendente:T1:15 min', 'kit_encerrar_pendente:T1:1 h']);
    expect(s.filas.at(-1)).toBe(300);
    expect(s.finalizadas).toBe(0);
  });

  it('aviso da faixa que falhou é repetido na rodada seguinte (a chave deduplica)', async () => {
    const { s, rodar } = cenario();
    s.ignora.add('MLB-2');
    await rodar();
    s.agora += 16 * 60_000;
    s.falhaAviso = true;
    await rodar();
    expect(s.avisos).toEqual([]);
    s.agora += 5 * 60_000;
    await rodar();
    expect(s.avisos.map((a) => a.chave)).toEqual(['kit_encerrar_pendente:T1:15 min']);
  });

  it('backoff e faixas', () => {
    expect([0, 59_000, 60_000, 299_000, 300_000, 899_000, 900_000].map(atrasoEncerrar)).toEqual([5, 5, 30, 30, 60, 60, 300]);
    expect(faixaEncerrar(2 * 60_000)).toBeNull();
    expect(faixaEncerrar(3 * 60_000)).toBe('3 min');
    expect(faixaEncerrar(14 * 60_000)).toBe('3 min');
    expect(faixaEncerrar(15 * 60_000)).toBe('15 min');
    expect(faixaEncerrar(60 * 60_000)).toBe('1 h');
    expect(faixaEncerrar(6 * 3600_000)).toBe('6 h');
    expect(faixaEncerrar(24 * 3600_000)).toBe('1 dia');
    expect(faixaEncerrar(3 * 24 * 3600_000)).toBe('3 dias');
  });

  it('prazo da execução vencido: nenhum PUT novo', async () => {
    const { s, deps } = cenario();
    const ler = deps.ml.lerOferta;
    deps.ml.lerOferta = async (up, esp) => { s.agora += 130_000; return ler(up, esp); };
    // Como na saga: prazo vencido lança sem efeito novo (nem o reagendamento); o QStash repete.
    await expect(avancarSaga(deps, 'T1')).rejects.toThrow('prazo da execução vencido');
    expect(s.puts).toEqual([]);
  });

  it('transferência de quantidade não passa pelo encerramento', async () => {
    const { s, rodar } = cenario();
    s.t.tipo = 'montar';
    s.t.passo = 'aguardar';
    await rodar();
    expect(s.puts).toEqual([]);
    expect(s.finalizadas).toBe(0);
  });
});

describe('avisarKitsEncerrados (avisos duráveis)', () => {
  function banco(o: { avisado?: string | null; saldo?: Record<string, number>; falhaEnvio?: boolean } = {}) {
    const kits = [{ id: 'KIT', org_id: 'ORG', status: 'encerrado', codigo_pai_kit: '00000223',
      encerrado_avisado_em: o.avisado ?? null, kit_variacao_skus: [{ codigo: 'K1' }, { codigo: 'K2' }] }];
    const marcas: string[] = [];
    const enviados: Array<{ chave: string; texto: string }> = [];
    const from = (tabela: string) => {
      const f: Record<string, unknown> = {};
      const api: Record<string, unknown> = {
        select: () => api, order: () => api, limit: () => api, is: () => api,
        eq: (c: string, v: unknown) => { f[c] = v; return api; },
        update: (patch: Record<string, unknown>) => { marcas.push(JSON.stringify(patch)); return api; },
        then: (res: (v: unknown) => unknown) => Promise.resolve(
          tabela === 'kits_variacao' && !marcas.length ? { data: kits.filter((k) => k.status === f.status), error: null }
            : tabela === 'estoque_movimentos' ? { data: [{ id: `MOV-${f.codigo}` }], error: null }
              : { data: null, error: null }).then(res),
      };
      return api;
    };
    const admin = { from, rpc: async () => ({ data: o.saldo ?? { K1: 0, K2: 0 }, error: null }) } as unknown as SupabaseClient;
    const notificar: Notificar = async (_a, _o, _c, texto, op) => {
      if (o.falhaEnvio) throw new Error('telegram fora');
      enviados.push({ chave: op.chave, texto });
      return 1;
    };
    return { admin, notificar, marcas, enviados };
  }

  it('conclusão: avisa uma vez com chave do kit e marca depois do envio', async () => {
    const b = banco();
    await avisarKitsEncerrados(b.admin, b.notificar, 'ORG');
    expect(b.enviados.map((e) => e.chave)).toEqual(['kit_encerrado:KIT']);
    expect(b.enviados[0].texto).toContain('00000223');
    expect(b.marcas).toHaveLength(1);
    const c = banco({ avisado: '2026-11-08T12:00:00Z' });   // já marcado: nada de novo
    await avisarKitsEncerrados(c.admin, c.notificar, 'ORG');
    expect(c.enviados).toEqual([]);
  });

  it('envio que falha não marca: a varredura diária reenvia com a mesma chave', async () => {
    const b = banco({ falhaEnvio: true });
    await avisarKitsEncerrados(b.admin, b.notificar, 'ORG');
    expect(b.marcas).toEqual([]);
  });

  it('estorno depois do encerramento: saldo preso no SKU do kit vira aviso por último movimento (não remonta)', async () => {
    const b = banco({ avisado: '2026-11-08T12:00:00Z', saldo: { K1: 1, K2: 0 } });
    await avisarKitsEncerrados(b.admin, b.notificar, 'ORG');
    expect(b.enviados.map((e) => e.chave)).toEqual(['kit_encerrado_saldo:K1:MOV-K1']);
    expect(b.enviados[0].texto).toContain('ajuste o estoque à mão');
  });
});

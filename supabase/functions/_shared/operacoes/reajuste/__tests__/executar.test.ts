import { describe, expect, it, vi } from 'vitest';
import {
  executarReajuste, MSG_FINANCEIRO, MSG_NAO_APLICADO, MSG_SEM_CONFIRMACAO,
  type DepsReajuste, type ItemReajuste, type OperacaoReajusteRow,
} from '../executar.ts';
import { resumir } from '../avaliacao.ts';
import { MSG_RECONECTAR } from '../../falhas.ts';
import { SemAcessoStatusML } from '../../ml-status.ts';
import type { ResultadoPut } from '../ml.ts';
import type { CorAvaliada, EntradaRestauracao, VivoItem } from '../tipos.ts';
import type { ItemRow } from '../../tipos.ts';

const AGORA = Date.parse('2026-10-04T12:00:00Z');
const PASSADO = new Date(AGORA - 60_000).toISOString();
type Linha = ItemRow & ItemReajuste & { mensagem?: string | null; parado?: boolean };

const cor = (over: Partial<CorAvaliada> = {}): CorAvaliada => ({
  variation_id: '1', sku: 'S', custo: 50, piso: 60, origem: 'nacional', aliquota_pct: 8, comissao_pct: 12,
  comissao_fixa: 0, frete: 10, liquido: 30, semaforo: 'verde', motivo: null, ...over,
});
const AVAL = resumir([cor()]);
const RESTAURAR: EntradaRestauracao[] = [{
  variacao_id: 'va', esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false },
  novo: { preco_publicacao: 110, preco_editado_pelo_operador: true },
}];
const item = (id: string, over: Partial<Linha> = {}): Linha => ({
  ml_item_id: id, preco: 110, preco_anterior: 100, status: 'pendente', conferencias: 0, semaforo: null,
  confirmado_risco: false, confirmado_sem_dado: false, proxima_conferencia: null, saida_pedida_em: null,
  etapa: null, avaliacao: AVAL, restaurar: RESTAURAR, variacoes_ml: null, codigo_pai: 'P', variacao_ids: ['va'], ...over,
});
const plano = (preco: number): VivoItem => ({ preco, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false });
const legacy = (...precos: number[]): VivoItem => ({ ...plano(precos[0]), variacoes: precos.map((p, i) => ({ id: String(i + 1), preco: p })) });

function montar(itens: Linha[], vivo: Record<string, VivoItem>) {
  const achar = (id: string) => itens.find((i) => i.ml_item_id === id)!;
  const claimavel = (i: Linha) => i.status === 'pendente' || (i.status === 'enviando' && i.parado === true)
    || (i.status === 'conferindo' && !!i.proxima_conferencia && Date.parse(i.proxima_conferencia) <= AGORA);
  const agendar = (i: Linha) => Object.assign(i, {
    status: 'conferindo', conferencias: i.conferencias + 1, mensagem: 'Aguardando confirmação do ML',
    proxima_conferencia: new Date(AGORA + 5 * 60_000).toISOString(),
  });
  // PUT ok aplica o alvo no "ML" (todas as variações pedidas ou o price).
  const aplicar = (id: string, alvo: number, ids: string[] | null) => {
    const v = vivo[id];
    if (ids && v.variacoes) v.variacoes = v.variacoes.map((x) => (ids.includes(x.id) ? { ...x, preco: alvo } : x));
    else v.preco = alvo;
  };
  const deps = {
    agora: () => AGORA,
    reivindicar: vi.fn(async (_o: string, id: string) => {
      const i = achar(id);
      if (!claimavel(i)) return false;
      Object.assign(i, { status: 'enviando', parado: false });
      return true;
    }),
    itensPendentes: vi.fn(async (_o: string, limite: number) => itens.filter(claimavel).slice(0, limite).map((i) => ({ ...i }))),
    temEnviando: vi.fn(async () => itens.some((i) => i.status === 'enviando')),
    itensAConferir: vi.fn(async () => itens.filter((i) => i.status === 'conferindo' && i.proxima_conferencia).map((i) => ({ ...i }))),
    gravarItem: vi.fn(async (_o: string, id: string, campos: object) => { Object.assign(achar(id), campos); }),
    continuar: vi.fn(async () => {}),
    agendarConferencia: vi.fn(async () => {}),
    concluir: vi.fn(async () => {}),
    ml: {
      lerVivo: vi.fn(async (id: string) => structuredClone(vivo[id])),
      putPreco: vi.fn(async (id: string, alvo: number, ids: string[] | null): Promise<ResultadoPut> => {
        aplicar(id, alvo, ids);
        return { kind: 'ok' };
      }),
      participaPromocaoML: vi.fn(async (): Promise<boolean | null> => false),
    },
    lerItem: vi.fn(async (_o: string, id: string) => ({ ...achar(id) })),
    avaliarFresco: vi.fn(async () => AVAL),
    fatos: vi.fn(async () => ({ ehKit: false, temAtacado: false, promocaoBanco: false, familiaPublicando: false, migracaoPxv: false })),
    persistir: vi.fn(async (_o: string, id: string) => {
      const i = achar(id);
      if (i.status === 'aplicado') return 'ja_aplicado' as const;
      Object.assign(i, { status: 'aplicado', etapa: null, mensagem: null });
      return 'ok' as const;
    }),
    agendarConferenciaItem: vi.fn(async (_o: string, id: string) => { agendar(achar(id)); }),
    encerrarSemEtapa: vi.fn(async (_o: string, mensagem: string) => {
      for (const i of itens) {
        if (i.status !== 'pendente' && i.status !== 'enviando') continue;
        if (i.etapa) agendar(i);
        else Object.assign(i, { status: 'erro', mensagem });
      }
    }),
  } satisfies DepsReajuste;
  return deps;
}
const OP: OperacaoReajusteRow = { id: 'op', org_id: 'o', origem_id: null };
const OPTS = { limiteMs: 60_000, lote: 10, maxItens: 100 };
const resumo = (i: Linha) => ({ status: i.status, etapa: i.etapa, mensagem: i.mensagem ?? null });

describe('executarReajuste — envio novo', () => {
  it('plano/UP: PUT {price} → GET confirma → persiste; etapa gravada antes do PUT; conclui', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    expect(await executarReajuste(OP, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 110, null);
    expect(deps.persistir).toHaveBeenCalledWith('op', 'A', 110, RESTAURAR);
    const marca = deps.gravarItem.mock.calls.findIndex((c) => (c[2] as { etapa?: string }).etapa === 'escrita_pedida');
    expect(deps.gravarItem.mock.invocationCallOrder[marca]).toBeLessThan(deps.ml.putPreco.mock.invocationCallOrder[0]);
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', { etapa: 'ml_confirmado' });
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('Legacy: PUT com todas as variações; todas = alvo → aplicado', async () => {
    const itens = [item('A', { variacoes_ml: ['1', '2'] })];
    const deps = montar(itens, { A: legacy(100, 100) });
    await executarReajuste(OP, deps, OPTS);
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 110, ['1', '2']);
    expect(itens[0].status).toBe('aplicado');
  });

  it('Legacy com 1 variação divergente após PUT ok → erro "não aplicado", não persiste', async () => {
    const itens = [item('A', { variacoes_ml: ['1', '2'] })];
    const vivo = { A: legacy(100, 100) };
    const deps = montar(itens, vivo);
    deps.ml.putPreco.mockImplementation(async () => { vivo.A.variacoes![0].preco = 110; return { kind: 'ok' }; });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
    expect(deps.persistir).not.toHaveBeenCalled();
  });

  it.each([
    ['ML devolve só uma das variações (no alvo)', () => legacy(110)],
    ['variação a mais no ML', () => legacy(110, 110, 110)],
    ['todas no preço antigo', () => legacy(100, 100)],
  ])('Legacy após PUT ok: %s → erro "não aplicado", não persiste', async (_n, depois) => {
    const itens = [item('A', { variacoes_ml: ['1', '2'] })];
    const deps = montar(itens, { A: legacy(100, 100) });
    deps.ml.lerVivo.mockResolvedValueOnce(legacy(100, 100)).mockResolvedValueOnce(depois());
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
    expect(deps.persistir).not.toHaveBeenCalled();
  });

  it('400 do ML → erro com a mensagem do ML, etapa limpa', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'price inválido' });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'price inválido' });
  });

  it('429 ×3: fica enviando (sem etapa) e continua em 150 s; na 3ª → erro; um PUT por chamada', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 429, mensagem: 'too many' });
    for (const n of [1, 2]) {
      expect(await executarReajuste(OP, deps, OPTS)).toEqual({ processados: 1, continuou: true });
      expect(itens[0]).toMatchObject({ status: 'enviando', etapa: null, conferencias: n, mensagem: 'too many' });
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(n);
      itens[0].parado = true; // > 2 min depois
    }
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'too many' });
    expect(deps.continuar).toHaveBeenCalledWith(150);
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('PUT desconhecido → conferindo agendado (etapa mantida) e a operação NÃO conclui', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.putPreco.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
    expect(await executarReajuste(OP, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida', conferencias: 1 });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('GET de confirmação falha após PUT ok → conferindo', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerVivo.mockResolvedValueOnce(plano(100)).mockRejectedValueOnce(new Error('ML 500'));
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('agendarConferenciaItem falha após PUT desconhecido → relança; item enviando com etapa (não erro)', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.putPreco.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
    deps.agendarConferenciaItem.mockRejectedValue(new Error('db fora'));
    await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('db fora');
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida' });
  });

  it('banco falha após ml_confirmado → relança; item enviando com etapa ml_confirmado', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.persistir.mockRejectedValue(new Error('db fora'));
    await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('db fora');
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'ml_confirmado' });
  });

  it('conflito na persistência → a RPC grava erro; laço segue e conclui', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.persistir.mockImplementation(async (_o, id) => {
      Object.assign(itens.find((i) => i.ml_item_id === id)!, { status: 'erro', etapa: null, mensagem: 'Conflito: …' });
      return 'conflito';
    });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'Conflito: …' });
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('persistir devolve estado_invalido → relança (inconsistência)', async () => {
    const itens = [item('A', { etapa: 'ml_confirmado', status: 'enviando', parado: true })];
    const deps = montar(itens, { A: plano(110) });
    deps.persistir.mockResolvedValue('estado_invalido');
    await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow(/estado inválido/);
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'ml_confirmado' });
  });

  it('tarifa mudou desde o preview → mudou, sem PUT', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.avaliarFresco.mockResolvedValue(resumir([cor({ comissao_pct: 14 })]));
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_FINANCEIRO });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('🔴 sem confirmado_risco (defesa C5) → mudou, sem PUT', async () => {
    const vermelho = resumir([cor({ semaforo: 'vermelho' })]);
    const itens = [item('A', { avaliacao: vermelho })];
    const deps = montar(itens, { A: plano(100) });
    deps.avaliarFresco.mockResolvedValue(vermelho);
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toMatchObject({ status: 'mudou', mensagem: MSG_SEM_CONFIRMACAO });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('inelegível na execução (promoção fresca) → bloqueado; preço vivo mudou → mudou', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { A: plano(100), B: plano(105) });
    deps.ml.participaPromocaoML.mockImplementation(async (id: string) => id === 'A');
    await executarReajuste(OP, deps, OPTS);
    expect(itens.map(resumo)).toEqual([
      { status: 'bloqueado', etapa: null, mensagem: 'Participando de promoção' },
      { status: 'mudou', etapa: null, mensagem: 'O preço mudou desde o preview' },
    ]);
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('leitura falha sem etapa → retentável (enviando, tentativa contada), nunca escreve', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerVivo.mockRejectedValue(new Error('ML 500'));
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: null, conferencias: 1, mensagem: 'ML 500' });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('Reverter: alvo = preço anterior da origem e restaurar da origem vão à persistência', async () => {
    const restaurarOrigem: EntradaRestauracao[] = [{
      variacao_id: 'va', esperado: { preco_publicacao: 110, preco_editado_pelo_operador: true },
      novo: { preco_publicacao: 100, preco_editado_pelo_operador: false },
    }];
    const itens = [item('A', { preco: 100, preco_anterior: 110, restaurar: restaurarOrigem })];
    const deps = montar(itens, { A: plano(110) });
    await executarReajuste({ ...OP, origem_id: 'op0' }, deps, OPTS);
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 100, null);
    expect(deps.persistir).toHaveBeenCalledWith('op', 'A', 100, restaurarOrigem);
    expect(itens[0].status).toBe('aplicado');
  });
});

describe('executarReajuste — recuperação', () => {
  const conferindo = (over: Partial<Linha> = {}) =>
    item('A', { status: 'conferindo', etapa: 'escrita_pedida', proxima_conferencia: PASSADO, conferencias: 1, ...over });

  it.each([
    ['lançando', async () => { throw new Error('ML 500'); }],
    ['null', async () => null],
  ])('conferência acha o alvo → aplicado sem checar elegibilidade (promoção %s)', async (_n, promo) => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(110) });
    deps.ml.participaPromocaoML.mockImplementation(promo);
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
    expect(deps.ml.participaPromocaoML).not.toHaveBeenCalled();
  });

  it('conferência acha o anterior → pendente sem etapa; o reenvio passa pelo fluxo normal', async () => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(100) });
    await executarReajuste(OP, deps, OPTS);
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', { status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });
    expect(deps.ml.participaPromocaoML).toHaveBeenCalledTimes(1); // elegibilidade no reenvio
    expect(deps.ml.putPreco).toHaveBeenCalledTimes(1);
    expect(itens[0].status).toBe('aplicado');
  });

  it('desconhecido → conferência falha → conferência acha o anterior: reenvio com tentativas zeradas (falha transitória retenta, não erro)', async () => {
    const itens = [item('A')];
    const vivo = { A: plano(100) };
    const deps = montar(itens, vivo);
    deps.ml.putPreco.mockResolvedValueOnce({ kind: 'desconhecido', mensagem: 'timeout' });
    await executarReajuste(OP, deps, OPTS); // conferindo, conferencias 1
    expect(itens[0]).toMatchObject({ status: 'conferindo', conferencias: 1 });
    itens[0].proxima_conferencia = PASSADO;
    deps.ml.lerVivo.mockRejectedValueOnce(new Error('ML 500'));
    await executarReajuste(OP, deps, OPTS); // re-agenda, conferencias 2
    expect(itens[0]).toMatchObject({ status: 'conferindo', conferencias: 2 });
    itens[0].proxima_conferencia = PASSADO;
    // conferência lê o anterior → pendente (conferencias 0) → reenvio no mesmo laço: lerVivo falha transitório
    deps.ml.lerVivo.mockResolvedValueOnce(plano(100)).mockRejectedValueOnce(new Error('ML 502'));
    await executarReajuste(OP, deps, OPTS);
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', { status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: null, conferencias: 1, mensagem: 'ML 502' });
  });

  it('conferência acha outro valor → erro "terceiros"', async () => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(105) });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'Preço alterado por terceiros durante o reajuste' });
  });

  it('conferência com leitura falhando → segue conferindo (re-agenda)', async () => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(110) });
    deps.ml.lerVivo.mockRejectedValue(new Error('ML 500'));
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida', conferencias: 2 });
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('retomada ml_confirmado → só persiste', async () => {
    const itens = [item('A', { status: 'enviando', parado: true, etapa: 'ml_confirmado' })];
    const deps = montar(itens, { A: plano(110) });
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0].status).toBe('aplicado');
    expect(deps.ml.lerVivo).not.toHaveBeenCalled();
  });

  it('lerItem falha numa retomada com etapa → relança; item segue enviando', async () => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(110) });
    deps.lerItem.mockRejectedValue(new Error('db fora'));
    await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('db fora');
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida' });
  });
});

describe('executarReajuste — fatal (401/403)', () => {
  it('mix: item com etapa → conferindo; sem etapa → erro reconectar; operação não conclui', async () => {
    const itens = [
      item('B', { status: 'conferindo', etapa: 'escrita_pedida', proxima_conferencia: PASSADO }),
      item('A'),
      item('C'),
      item('D', { status: 'enviando', etapa: 'escrita_pedida' }), // outro worker, recente
    ];
    const deps = montar(itens, { A: plano(100), B: plano(110), C: plano(100), D: plano(100) });
    deps.ml.lerVivo.mockRejectedValue(new SemAcessoStatusML('ML 403'));
    expect(await executarReajuste(OP, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(itens.map((i) => [i.ml_item_id, i.status, i.etapa])).toEqual([
      ['B', 'conferindo', 'escrita_pedida'], ['A', 'erro', null], ['C', 'erro', null], ['D', 'conferindo', 'escrita_pedida'],
    ]);
    expect(itens[1].mensagem).toBe(MSG_RECONECTAR);
    expect(itens[0].mensagem).not.toBe(MSG_RECONECTAR);
    expect(deps.encerrarSemEtapa).toHaveBeenCalledWith('op', MSG_RECONECTAR);
    expect(deps.agendarConferencia).toHaveBeenCalled();
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('401 no PUT (etapa já gravada) → conferindo, não erro', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.putPreco.mockRejectedValue(new SemAcessoStatusML('ML 401'));
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('fatal sem etapa e nada a conferir → conclui', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerVivo.mockRejectedValue(new SemAcessoStatusML('ML 403'));
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_RECONECTAR });
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('fatal com agendamento falhando → relança; item enviando com etapa, nada encerrado', async () => {
    const itens = [item('A', { status: 'conferindo', etapa: 'escrita_pedida', proxima_conferencia: PASSADO })];
    const deps = montar(itens, { A: plano(110) });
    deps.ml.lerVivo.mockRejectedValue(new SemAcessoStatusML('ML 403'));
    deps.agendarConferenciaItem.mockRejectedValue(new Error('db fora'));
    await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('db fora');
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida' });
    expect(deps.encerrarSemEtapa).not.toHaveBeenCalled();
  });
});

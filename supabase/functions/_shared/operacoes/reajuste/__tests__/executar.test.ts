import { describe, expect, it, vi } from 'vitest';
import {
  executarReajuste, MSG_COMPENSADO, MSG_FAIXAS_MUDARAM, MSG_FAIXAS_NAO_RESTAURADAS, MSG_FAIXAS_PENDENTES, MSG_FINANCEIRO, MSG_NAO_APLICADO, MSG_SEM_CONFIRMACAO,
  type DepsReajuste, type ItemReajuste, type OperacaoReajusteRow, type ResultadoPersistir,
} from '../executar.ts';
import { resumir } from '../avaliacao.ts';
import { MSG_ATACADO_MUDOU, MSG_ATACADO_POR_COR, type ConfigMlb } from '../faixas.ts';
import { MSG_RECONECTAR } from '../../falhas.ts';
import type { FaixaAtacado } from '../../../canais/contrato.ts';
import { SemAcessoStatusML } from '../../ml-status.ts';
import type { ResultadoPut } from '../ml.ts';
import { oferta } from '../ofertas.ts';
import type { CorAvaliada, EntradaRestauracao, EstadoPasso, FaixaPreco, OfertaVigente, Passo, PrecoAvaliado, VivoItem } from '../tipos.ts';
import type { ItemRow } from '../../tipos.ts';

const AGORA = Date.parse('2026-10-04T12:00:00Z');
const PASSADO = new Date(AGORA - 60_000).toISOString();
type Linha = ItemRow & ItemReajuste & { mensagem?: string | null; parado?: boolean; lease?: string };
const T = expect.any(String); // token do claim

const cor = (over: Partial<CorAvaliada> = {}): CorAvaliada => ({
  variation_id: '1', sku: 'S', custo: 50, piso: 60, origem: 'nacional', aliquota_pct: 8, comissao_pct: 12,
  comissao_fixa: 0, frete: 10, liquido: 30, semaforo: 'verde', motivo: null, ...over,
});
const AVAL = resumir([cor()]);
const RESTAURAR: EntradaRestauracao[] = [{
  variacao_id: 'va', esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false },
  novo: { preco_publicacao: 110, preco_editado_pelo_operador: true },
}];
const base = (anterior: number, alvo: number, estado: EstadoPasso = 'pendente'): Passo => ({ tipo: 'base', anterior, alvo, estado });
const faixas = (anterior: FaixaPreco[], alvo: FaixaPreco[], estado: EstadoPasso = 'pendente', config: FaixaAtacado[] | null = null): Passo => ({ tipo: 'faixas', anterior, alvo, config, estado });
const precoBase = (preco: number, avaliacao = AVAL): PrecoAvaliado => ({ tipo: 'base', chave: 'base', preco, avaliacao });
const precoFaixa = (f: FaixaPreco, avaliacao = AVAL): PrecoAvaliado => ({ tipo: 'faixa', chave: String(f.min_unidades), preco: f.preco, avaliacao });
const ESTADO_DA_ETAPA = { escrita_pedida: 'escrita_pedida', ml_confirmado: 'confirmado' } as const;
const item = (id: string, over: Partial<Linha> = {}): Linha => {
  const preco = over.preco ?? 110, anterior = over.preco_anterior ?? 100;
  return {
    ml_item_id: id, preco, preco_anterior: anterior, status: 'pendente', conferencias: 0, semaforo: null,
    confirmado_risco: false, confirmado_sem_dado: false, proxima_conferencia: null, saida_pedida_em: null,
    etapa: null, restaurar: RESTAURAR, variacoes_ml: null, codigo_pai: 'P', variacao_ids: ['va'],
    passos: [base(anterior, preco, over.etapa ? ESTADO_DA_ETAPA[over.etapa] : 'pendente')], avaliacoes: [precoBase(preco)], ...over,
  };
};
const plano = (preco: number): VivoItem => ({ preco, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false });
const legacy = (...precos: number[]): VivoItem => ({ ...plano(precos[0]), variacoes: precos.map((p, i) => ({ id: String(i + 1), preco: p })) });

function montar(itens: Linha[], vivo: Record<string, VivoItem>, atacado: Record<string, FaixaPreco[]> = {}) {
  let tokens = 0;
  const achar = (id: string) => itens.find((i) => i.ml_item_id === id)!;
  const claimavel = (i: Linha) => i.status === 'pendente' || (i.status === 'enviando' && i.parado === true)
    || (i.status === 'conferindo' && !!i.proxima_conferencia && Date.parse(i.proxima_conferencia) <= AGORA);
  // Mesma regra de `reajuste_item_gravar`/`reajuste_passo_marcar`: só o dono, com o item enviando.
  const dono = (i: Linha, token: string) => i.status === 'enviando' && i.lease === token;
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
      if (!claimavel(i)) return null;
      const lease = `tok-${++tokens}`;
      Object.assign(i, { status: 'enviando', parado: false, lease });
      return lease;
    }),
    itensPendentes: vi.fn(async (_o: string, limite: number) => itens.filter(claimavel).slice(0, limite).map((i) => ({ ...i }))),
    temEnviando: vi.fn(async () => itens.some((i) => i.status === 'enviando')),
    itensAConferir: vi.fn(async () => itens.filter((i) => i.status === 'conferindo' && i.proxima_conferencia).map((i) => ({ ...i }))),
    gravarItem: vi.fn(async (_o: string, id: string, token: string, campos: object) => {
      if (!dono(achar(id), token)) return false;
      Object.assign(achar(id), campos);
      return true;
    }),
    marcarPasso: vi.fn(async (_o: string, id: string, token: string, indice: number, estado: EstadoPasso, recusada?: boolean) => {
      const i = achar(id);
      if (!dono(i, token)) return false;
      const naVolta = i.passos.some((p) => ['volta_pendente', 'volta_pedida', 'compensado'].includes(p.estado));
      if (naVolta && ['pendente', 'escrita_pedida', 'confirmado'].includes(estado)) throw new Error('em compensação não retoma a ida');
      i.passos[indice].estado = estado;
      if (estado === 'escrita_pedida') i.passos[indice].tentativas = (i.passos[indice].tentativas ?? 0) + 1;
      if (recusada) i.passos[indice].recusas_volta = (i.passos[indice].recusas_volta ?? 0) + 1;
      if (estado === 'escrita_pedida' || estado === 'volta_pedida') i.etapa = 'escrita_pedida';
      return true;
    }),
    continuar: vi.fn(async () => {}),
    agendarConferencia: vi.fn(async () => {}),
    concluir: vi.fn(async () => {}),
    ml: {
      lerVivo: vi.fn(async (id: string) => structuredClone(vivo[id])),
      putPreco: vi.fn(async (id: string, alvo: number, ids: string[] | null): Promise<ResultadoPut> => {
        aplicar(id, alvo, ids);
        return { kind: 'ok' };
      }),
      lerOfertas: vi.fn(async (_id: string): Promise<OfertaVigente[] | null> => []),
      lerFaixas: vi.fn(async (id: string): Promise<FaixaPreco[] | null> => structuredClone(atacado[id] ?? [])),
      gravarFaixas: vi.fn(async (id: string, fs: FaixaPreco[]): Promise<ResultadoPut> => {
        atacado[id] = fs;
        return { kind: 'ok' };
      }),
    },
    ofertasBanco: vi.fn(async (ids: string[]) => new Map(ids.map((id): [string, OfertaVigente[]] => [id, []]))),
    lerItem: vi.fn(async (_o: string, id: string) => structuredClone(achar(id))),
    avaliarFresco: vi.fn(async () => AVAL),
    fatos: vi.fn(async () => ({ ehKit: false, familiaPublicando: false, migracaoPxv: false })),
    configAtacado: vi.fn(async (_ids: string[]): Promise<ConfigMlb> => ({ faixas: null, divergente: false })),
    persistir: vi.fn(async (_o: string, id: string, token: string, _p: number, _r: EntradaRestauracao[], mensagem: string | null): Promise<ResultadoPersistir> => {
      const i = achar(id);
      if (i.lease !== token) return 'sem_posse';
      if (i.status === 'aplicado') return 'ja_aplicado';
      Object.assign(i, { status: 'aplicado', etapa: null, mensagem });
      return 'ok';
    }),
    agendarConferenciaItem: vi.fn(async (_o: string, id: string, token: string) => {
      if (!dono(achar(id), token)) return false;
      agendar(achar(id));
      return true;
    }),
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
const of = (preco: number | null) => oferta({ promocao_id: 'P', tipo: 'DEAL', status: 'started', preco, offer_id: null, inicio: null, fim: null });
const resumo = (i: Linha) => ({ status: i.status, etapa: i.etapa, mensagem: i.mensagem ?? null });

describe('executarReajuste — envio novo', () => {
  it('plano/UP: PUT {price} → GET confirma → persiste; etapa gravada antes do PUT; conclui', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    expect(await executarReajuste(OP, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 110, null);
    expect(deps.persistir).toHaveBeenCalledWith('op', 'A', 'tok-1', 110, RESTAURAR, null);
    expect(deps.marcarPasso.mock.calls[0]).toEqual(['op', 'A', 'tok-1', 0, 'escrita_pedida']);
    expect(deps.marcarPasso.mock.invocationCallOrder[0]).toBeLessThan(deps.ml.putPreco.mock.invocationCallOrder[0]);
    expect(deps.marcarPasso).toHaveBeenCalledWith('op', 'A', 'tok-1', 0, 'confirmado');
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', 'tok-1', { etapa: 'ml_confirmado' });
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
    const itens = [item('A', { avaliacoes: [precoBase(110, vermelho)] })];
    const deps = montar(itens, { A: plano(100) });
    deps.avaliarFresco.mockResolvedValue(vermelho);
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toMatchObject({ status: 'mudou', mensagem: MSG_SEM_CONFIRMACAO });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('inelegível na execução (ofertas inconclusivas) → bloqueado sem PUT; preço vivo mudou → mudou', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { A: plano(100), B: plano(105) });
    deps.ml.lerOfertas.mockImplementation(async (id: string) => (id === 'A' ? null : []));
    await executarReajuste(OP, deps, OPTS);
    expect(itens.map(resumo)).toEqual([
      { status: 'bloqueado', etapa: null, mensagem: 'Não foi possível conferir promoções — tente de novo' },
      { status: 'mudou', etapa: null, mensagem: 'O preço mudou desde o preview' },
    ]);
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('banco sem o MLB pedido → bloqueado, sem PUT', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ofertasBanco.mockResolvedValue(new Map());
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0].status).toBe('bloqueado');
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it.each([
    ['do ML', 'ml'],
    ['só do banco', 'banco'],
  ])('oferta %s igual ou acima do alvo → mudou com o motivo, sem etapa nem PUT', async (_n, fonte) => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    if (fonte === 'ml') deps.ml.lerOfertas.mockResolvedValue([of(110)]);
    else deps.ofertasBanco.mockResolvedValue(new Map([['A', [of(110)]]]));
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: 'Preço igual ou abaixo da oferta de R$ 110,00 — ajuste a oferta antes' });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it.each([
    ['LIGHTNING', 'ML pending, banco started', 'pending', 'started'],
    ['LIGHTNING', 'ML started, banco pending', 'started', 'pending'],
    ['SMART_LIGHTNING', 'ML pending, banco started', 'pending', 'started'],
    ['SMART_LIGHTNING', 'ML started, banco pending', 'started', 'pending'],
  ] as const)('%s com a mesma chave, %s → aplica acima da oferta', async (tipo, _n, doML, doBanco) => {
    const r = (status: OfertaVigente['status']) => ({ ...of(39.9), tipo, status, chave: 'OFFER-1', offer_id: 'OFFER-1' });
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerOfertas.mockResolvedValue([r(doML)]);
    deps.ofertasBanco.mockResolvedValue(new Map([['A', [r(doBanco)]]]));
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 110, null);
  });

  it.each(['LIGHTNING', 'SMART_LIGHTNING'])('%s `started` no alvo ou acima → trava, sem PUT', async (tipo) => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerOfertas.mockResolvedValue([{ ...of(110), tipo }]);
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0].status).toBe('mudou');
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('oferta abaixo do alvo não impede a escrita', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: plano(100) });
    deps.ml.lerOfertas.mockResolvedValue([of(80)]);
    await executarReajuste(OP, deps, OPTS);
    expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 110, null);
    expect(itens[0].status).toBe('aplicado');
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
    expect(deps.persistir).toHaveBeenCalledWith('op', 'A', T, 100, restaurarOrigem, null);
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
    deps.ml.lerOfertas.mockImplementation(promo);
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
    expect(deps.ml.lerOfertas).not.toHaveBeenCalled();
  });

  it('conferência acha o anterior → pendente sem etapa; o reenvio passa pelo fluxo normal', async () => {
    const itens = [conferindo()];
    const deps = montar(itens, { A: plano(100) });
    await executarReajuste(OP, deps, OPTS);
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', T, { status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });
    expect(deps.ml.lerOfertas).toHaveBeenCalledTimes(1); // elegibilidade no reenvio
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
    expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', T, { status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });
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

describe('executarReajuste — passos', () => {
  const F80 = [{ min_unidades: 3, preco: 80 }], F72 = [{ min_unidades: 3, preco: 72 }], F88 = [{ min_unidades: 3, preco: 88 }];
  const MSG_TRAVA = 'Preço igual ou abaixo da oferta de R$ 95,00 — ajuste a oferta antes';
  const retomada = (es: EstadoPasso[]) => (es.every((e) => e === 'pendente') ? {} : { status: 'enviando' as const, parado: true, etapa: 'escrita_pedida' as const });
  // Descendo 100 → 90: faixas antes do base. Subindo 100 → 110: base antes das faixas.
  const descendo = (es: [EstadoPasso, EstadoPasso] = ['pendente', 'pendente'], over: Partial<Linha> = {}) => item('A', {
    preco: 90, passos: [faixas(F80, F72, es[0]), base(100, 90, es[1])], avaliacoes: [precoFaixa(F72[0]), precoBase(90)], ...retomada(es), ...over,
  });
  const subindo = (es: [EstadoPasso, EstadoPasso] = ['pendente', 'pendente'], over: Partial<Linha> = {}) => item('A', {
    preco: 110, passos: [base(100, 110, es[0]), faixas(F80, F88, es[1])], avaliacoes: [precoBase(110), precoFaixa(F88[0])], ...retomada(es), ...over,
  });
  const estados = (i: Linha) => i.passos.map((p) => p.estado);
  const semEscrita = (deps: ReturnType<typeof montar>) => {
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
    expect(deps.ml.gravarFaixas).not.toHaveBeenCalled();
  };

  describe('ordem', () => {
    it('descendo: faixas, confere, base, confere, persiste', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F72);
      expect(deps.ml.gravarFaixas.mock.invocationCallOrder[0]).toBeLessThan(deps.ml.putPreco.mock.invocationCallOrder[0]);
      expect(estados(itens[0])).toEqual(['confirmado', 'confirmado']);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    });

    it('subindo: base antes das faixas', async () => {
      const itens = [subindo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco.mock.invocationCallOrder[0]).toBeLessThan(deps.ml.gravarFaixas.mock.invocationCallOrder[0]);
      expect(itens[0].status).toBe('aplicado');
    });

    it('revalida antes de cada escrita', async () => {
      const deps = montar([descendo()], { A: plano(100) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.lerOfertas).toHaveBeenCalledTimes(2);
      expect(deps.ofertasBanco).toHaveBeenCalledTimes(2);
    });

    it('etapa fica escrita_pedida até todos os passos confirmados; só então ml_confirmado', async () => {
      const itens = [descendo()];
      const vivo = { A: plano(100) };
      const deps = montar(itens, vivo, { A: F80 });
      deps.ml.putPreco.mockImplementation(async () => {
        expect(itens[0].etapa).toBe('escrita_pedida');
        vivo.A.preco = 90;
        return { kind: 'ok' };
      });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem.mock.calls.map((c) => c[3])).toEqual([{ etapa: 'ml_confirmado' }]);
    });
  });

  describe('revalidação sem nada escrito', () => {
    it('oferta nova acima do alvo → mudou, nenhuma escrita', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.lerOfertas.mockResolvedValue([of(95)]);
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_TRAVA });
      semEscrita(deps);
    });

    it('lerOfertas null → bloqueado, nenhuma escrita', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.lerOfertas.mockResolvedValue(null);
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'bloqueado', etapa: null, mensagem: 'Não foi possível conferir promoções — tente de novo' });
      semEscrita(deps);
    });

    it('oferta sem preço → mudou com o motivo inconclusivo', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.lerOfertas.mockResolvedValue([of(null)]);
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: 'Não foi possível conferir promoções — tente de novo' });
      semEscrita(deps);
    });

    it('faixas vivas ≠ preview → mudou', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: [{ min_unidades: 3, preco: 79 }] });
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_FAIXAS_MUDARAM });
      semEscrita(deps);
    });

    it('lerFaixas null → bloqueado, nenhuma escrita', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) });
      deps.ml.lerFaixas.mockResolvedValue(null);
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0].status).toBe('bloqueado');
      semEscrita(deps);
    });

    it('sem passo de faixas: faixa viva que ficaria acima do alvo → mudou, sem PUT', async () => {
      const itens = [item('A', { preco: 90 })];
      const deps = montar(itens, { A: plano(100) }, { A: [{ min_unidades: 3, preco: 90 }] });
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0].status).toBe('mudou');
      semEscrita(deps);
    });

    it('mudouPrecos em qualquer preço → mudou com MSG_FINANCEIRO', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.avaliarFresco.mockImplementation(async (_ml: string, preco: number) => (preco === 72 ? resumir([cor({ comissao_pct: 14 })]) : AVAL));
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_FINANCEIRO });
      semEscrita(deps);
    });

    it('🔴 só na faixa, sem confirmado_risco → mudou', async () => {
      const vermelho = resumir([cor({ semaforo: 'vermelho' })]);
      const itens = [descendo(undefined, { avaliacoes: [precoFaixa(F72[0], vermelho), precoBase(90)] })];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.avaliarFresco.mockImplementation(async (_ml: string, preco: number) => (preco === 72 ? vermelho : AVAL));
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toMatchObject({ status: 'mudou', mensagem: MSG_SEM_CONFIRMACAO });
      semEscrita(deps);
    });

    it('item sem passos (preview anterior ao ADR-0196) → mudou, nenhuma escrita', async () => {
      const itens = [item('A', { passos: [] })];
      const deps = montar(itens, { A: plano(100) });
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0].status).toBe('mudou');
      semEscrita(deps);
    });

    it('item sem passos com etapa → conferindo, nunca dá como aplicado', async () => {
      const itens = [item('A', { passos: [], status: 'enviando', parado: true, etapa: 'escrita_pedida' })];
      const deps = montar(itens, { A: plano(110) });
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0].status).toBe('conferindo');
      expect(deps.persistir).not.toHaveBeenCalled();
    });

    it.each(['oferta', 'saida'] as const)('passo %s ainda sem execução → erro claro, nenhuma escrita', async (tipo) => {
      const o = of(50);
      const passo: Passo = tipo === 'saida' ? { tipo, oferta: o, estado: 'pendente' } : { tipo, oferta: o, anterior: 50, alvo: 45, estado: 'pendente' };
      const itens = [item('A', { preco: 90, passos: [passo, base(100, 90)], avaliacoes: [precoBase(90)] })];
      const deps = montar(itens, { A: plano(100) });
      deps.ml.lerOfertas.mockResolvedValue([o]);
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: expect.stringContaining(`passo ${tipo}`) });
      semEscrita(deps);
      expect(deps.marcarPasso).not.toHaveBeenCalled();
    });
  });

  describe('posse', () => {
    it('passo_marcar false → para sem escrever', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.marcarPasso.mockResolvedValue(false);
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(deps.gravarItem).not.toHaveBeenCalled();
    });

    it('perdeu a posse depois da escrita → nada mais é escrito nem gravado', async () => {
      const itens = [descendo()];
      const atacado = { A: F80 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      deps.ml.gravarFaixas.mockImplementation(async (_id, fs) => { atacado.A = fs; itens[0].lease = 'sucessor'; return { kind: 'ok' }; });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(deps.persistir).not.toHaveBeenCalled();
      expect(itens[0]).toMatchObject({ status: 'enviando', lease: 'sucessor' });
    });

    it('item_gravar false → não sobrescreve o sucessor', async () => {
      const itens = [item('A')];
      const deps = montar(itens, { A: plano(105) });
      deps.ml.lerVivo.mockImplementation(async () => { itens[0].lease = 'sucessor'; return plano(105); });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem).toHaveBeenCalledTimes(1);
      expect(itens[0]).toMatchObject({ status: 'enviando', lease: 'sucessor' });
      expect(itens[0].mensagem).toBeUndefined();
    });

    it('persistir sem_posse → para sem relançar', async () => {
      const itens = [item('A', { status: 'enviando', parado: true, etapa: 'ml_confirmado' })];
      const deps = montar(itens, { A: plano(110) });
      deps.persistir.mockResolvedValue('sem_posse');
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem).not.toHaveBeenCalled();
    });

    it.each([
      ['com etapa', () => descendo(['confirmado', 'pendente'])],
      ['sem etapa', () => descendo()],
    ])('SemAcesso depois de perder a posse (%s): não encerra nada', async (_n, novo) => {
      const itens = [novo()];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      deps.ml.lerFaixas.mockImplementation(async () => {
        itens[0].lease = 'sucessor';
        throw new SemAcessoStatusML('ML 401');
      });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.encerrarSemEtapa).not.toHaveBeenCalled();
      expect(itens[0]).toMatchObject({ status: 'enviando', lease: 'sucessor' });
    });

    it('caminho de erro do laço usa o token: exceção vira erro só para o dono', async () => {
      const itens = [item('A'), item('B')];
      const deps = montar(itens, { A: plano(100), B: plano(100) });
      deps.avaliarFresco.mockImplementation(async (ml: string) => {
        if (ml === 'B') itens[1].lease = 'sucessor';
        throw new Error('db fora');
      });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', 'tok-1', { status: 'erro', mensagem: 'db fora' });
      expect(resumo(itens[0])).toMatchObject({ status: 'erro', mensagem: 'db fora' });
      expect(itens[1]).toMatchObject({ status: 'enviando', lease: 'sucessor' });
    });

    it('fatal sem etapa grava com o token', async () => {
      const itens = [item('A')];
      const deps = montar(itens, { A: plano(100) });
      deps.ml.lerVivo.mockRejectedValue(new SemAcessoStatusML('ML 403'));
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', 'tok-1', { status: 'erro', mensagem: MSG_RECONECTAR });
    });
  });

  describe('retomada parcial', () => {
    it('faixas confirmadas, SMART nova acima do alvo → compensa faixas, mudou, base intacto', async () => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const atacado = { A: F72 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      deps.ml.lerOfertas.mockResolvedValue([of(95)]);
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F80);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(atacado.A).toEqual(F80);
      expect(estados(itens[0])).toEqual(['compensado', 'pendente']);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_TRAVA });
    });

    it('custo mudou → mudouPrecos reprova antes do base, só avalia o que falta', async () => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      deps.avaliarFresco.mockResolvedValue(resumir([cor({ custo: 55 })]));
      await executarReajuste(OP, deps, OPTS);
      expect(deps.avaliarFresco.mock.calls).toEqual([['A', 90]]);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F80);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_FINANCEIRO });
    });

    it.each<[string, (d: ReturnType<typeof montar>) => void]>([
      ['ofertas null', (d) => d.ml.lerOfertas.mockResolvedValue(null)],
      ['oferta sem preço', (d) => d.ml.lerOfertas.mockResolvedValue([of(null)])],
      ['atacado ilegível', (d) => d.ml.lerFaixas.mockResolvedValue(null)],
      ['anúncio ilegível', (d) => d.ml.lerVivo.mockRejectedValue(new Error('ML 500'))],
      ['preço ilegível', (d) => d.ml.lerVivo.mockResolvedValue({ ...plano(100), preco: null })],
    ])('%s com faixas escritas: nunca compensa, fica conferindo além das tentativas', async (_n, inconclusivo) => {
      const itens = [descendo(['confirmado', 'pendente'], { conferencias: 2 })];
      const atacado = { A: F72 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      inconclusivo(deps);
      for (const n of [3, 4, 5, 6]) {
        await executarReajuste(OP, deps, OPTS);
        semEscrita(deps);
        expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida', conferencias: n });
        expect(estados(itens[0])).toEqual(['confirmado', 'pendente']);
        itens[0].proxima_conferencia = PASSADO;
      }
      expect(atacado.A).toEqual(F72);
    });

    it('inconclusivo com o base confirmado: conferindo, sem concluir', async () => {
      const itens = [subindo(['confirmado', 'pendente'], { conferencias: 2 })];
      const deps = montar(itens, { A: plano(110) }, { A: F80 });
      deps.ml.lerOfertas.mockResolvedValue(null);
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(deps.persistir).not.toHaveBeenCalled();
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    });

    it('faixas confirmadas e tudo igual → segue para o base', async () => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).not.toHaveBeenCalled();
      expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 90, null);
      expect(itens[0].status).toBe('aplicado');
    });
  });

  describe('reconciliação', () => {
    it('crash antes da escrita de volta (volta_pedida, vivo no alvo) → volta_pendente, reescreve a volta', async () => {
      const itens = [descendo(['volta_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.marcarPasso.mock.calls.map((c) => c[4])).toEqual(['volta_pendente', 'volta_pedida', 'compensado']);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F80);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_COMPENSADO });
    });

    it('crash depois da escrita de volta (volta_pedida, vivo no anterior) → compensado, sem retomar a ida', async () => {
      const itens = [descendo(['volta_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(deps.ml.lerOfertas).not.toHaveBeenCalled();
      expect(estados(itens[0])).toEqual(['compensado', 'pendente']);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_COMPENSADO });
    });

    it('volta_pendente sem escrita feita segue a compensação', async () => {
      const itens = [descendo(['volta_pendente', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F80);
      expect(itens[0].status).toBe('mudou');
    });

    it('crash com faixas escrita_pedida e vivo no alvo → confirmado, sem novo POST, segue para o base', async () => {
      const itens = [descendo(['escrita_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).not.toHaveBeenCalled();
      expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 90, null);
      expect(itens[0].status).toBe('aplicado');
    });

    it('reconcilia antes de qualquer trava: ofertas inconclusivas não impedem a leitura', async () => {
      const itens = [descendo(['confirmado', 'escrita_pedida'])];
      const deps = montar(itens, { A: plano(90) }, { A: F72 });
      deps.ml.lerOfertas.mockResolvedValue(null);
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.lerOfertas).not.toHaveBeenCalled();
      expect(itens[0].status).toBe('aplicado');
    });

    it('crash com faixas escrita_pedida e vivo no anterior → volta a pendente e regrava', async () => {
      const itens = [descendo(['escrita_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.marcarPasso.mock.calls[0]).toEqual(['op', 'A', 'tok-1', 0, 'pendente']);
      expect(deps.gravarItem).toHaveBeenCalledWith('op', 'A', 'tok-1', { status: 'pendente', etapa: null, mensagem: null, conferencias: 0 });
      expect(deps.reivindicar).toHaveBeenCalledTimes(2); // barreiras de novo
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F72);
      expect(itens[0].status).toBe('aplicado');
    });

    it('crash com faixas escrita_pedida e vivo em terceiro valor → conferindo, nada escrito', async () => {
      const itens = [descendo(['escrita_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: [{ min_unidades: 3, preco: 77 }] });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
      expect(estados(itens[0])).toEqual(['escrita_pedida', 'pendente']);
    });

    it('lerFaixas null na reconciliação → conferindo', async () => {
      const itens = [descendo(['escrita_pedida', 'pendente'])];
      const deps = montar(itens, { A: plano(100) });
      deps.ml.lerFaixas.mockResolvedValue(null);
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0].status).toBe('conferindo');
    });

    it('base em terceiro valor com faixas escritas → conferindo, não erro', async () => {
      const itens = [descendo(['confirmado', 'escrita_pedida'])];
      const deps = montar(itens, { A: plano(95) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    });

    it('crash depois do base confirmado, subindo, faixas pendentes → grava faixas, depois persiste', async () => {
      const itens = [subindo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(110) }, { A: F80 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', F88);
      expect(deps.ml.gravarFaixas.mock.invocationCallOrder[0]).toBeLessThan(deps.persistir.mock.invocationCallOrder[0]);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    });

    it('SemAcesso com etapa → conferindo, reserva mantida', async () => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      deps.ml.lerFaixas.mockRejectedValue(new SemAcessoStatusML('ML 401'));
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
      expect(deps.encerrarSemEtapa).toHaveBeenCalledWith('op', MSG_RECONECTAR);
      expect(deps.concluir).not.toHaveBeenCalled();
    });
  });

  describe('falha de escrita', () => {
    it('descendo: faixas confirmadas, base recusado (sem_escrita) → compensa faixas, erro', async () => {
      const itens = [descendo()];
      const atacado = { A: F80 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'price inválido' });
      await executarReajuste(OP, deps, OPTS);
      expect(atacado.A).toEqual(F80);
      expect(deps.ml.gravarFaixas.mock.calls).toEqual([['A', F72], ['A', F80]]);
      expect(estados(itens[0])).toEqual(['compensado', 'pendente']);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'price inválido' });
    });

    it('descendo: base 429 com faixas confirmadas → mantém a etapa e retenta; esgotado, compensa', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 429, mensagem: 'too many' });
      for (const n of [1, 2]) {
        await executarReajuste(OP, deps, OPTS);
        expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida', conferencias: n });
        expect(estados(itens[0])).toEqual(['confirmado', 'pendente']);
        itens[0].parado = true;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'too many' });
      expect(estados(itens[0])).toEqual(['compensado', 'pendente']);
    });

    it('descendo: faixas confirmadas, base desconhecido → NÃO compensa, conferindo', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.putPreco.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(1);
      expect(estados(itens[0])).toEqual(['confirmado', 'escrita_pedida']);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    });

    it('base aceito mas leitura no anterior, com faixas escritas → incerto, conferindo, sem compensar', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.putPreco.mockResolvedValue({ kind: 'ok' });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(1);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    });

    it('primeiro passo recusado → erro sem compensar nada', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'faixa inválida' });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(1);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'faixa inválida' });
    });

    it('faixas desconhecido → conferindo, base intacto', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
    });

    it('POST aceito sem efeito → retenta sem tocar o base; esgotado, erro', async () => {
      const itens = [descendo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'ok' });
      for (const n of [1, 2]) {
        await executarReajuste(OP, deps, OPTS);
        expect(itens[0]).toMatchObject({ status: 'enviando', etapa: null, conferencias: n });
        expect(estados(itens[0])).toEqual(['pendente', 'pendente']);
        itens[0].parado = true;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'erro', etapa: null });
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
    });

    it('subindo: gravarFaixas falha 3x → aplicado + MSG_FAIXAS_PENDENTES', async () => {
      const itens = [subindo()];
      const deps = montar(itens, { A: plano(100) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'faixa inválida' });
      for (const n of [1, 2]) {
        await executarReajuste(OP, deps, OPTS);
        expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida', conferencias: n });
        itens[0].parado = true;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(3);
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(1);
      expect(deps.persistir).toHaveBeenCalledWith('op', 'A', T, 110, RESTAURAR, MSG_FAIXAS_PENDENTES);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: MSG_FAIXAS_PENDENTES });
    });

    it('subindo: revalidação reprovada depois do base segue a regra das faixas, sem compensar', async () => {
      const itens = [subindo(['confirmado', 'pendente'], { conferencias: 2 })];
      const deps = montar(itens, { A: plano(110) }, { A: [{ min_unidades: 3, preco: 79 }] });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: MSG_FAIXAS_PENDENTES });
    });

    it('faixas esgotadas: persiste direto, nunca grava ml_confirmado com passo pendente', async () => {
      const itens = [subindo(['confirmado', 'pendente'], { conferencias: 2 })];
      const deps = montar(itens, { A: plano(110) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'não' });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.gravarItem).not.toHaveBeenCalledWith('op', 'A', T, { etapa: 'ml_confirmado' });
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: MSG_FAIXAS_PENDENTES });
    });

    it('crash antes do persist com faixas esgotadas: segue escrita_pedida e a retomada regrava as faixas', async () => {
      const itens = [subindo(['confirmado', 'pendente'], { conferencias: 2 })];
      const atacado = { A: F80 };
      const deps = montar(itens, { A: plano(110) }, atacado);
      deps.ml.gravarFaixas.mockResolvedValueOnce({ kind: 'sem_escrita', status: 400, mensagem: 'não' });
      deps.persistir.mockRejectedValueOnce(new Error('db fora'));
      await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('db fora');
      expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida' });
      itens[0].parado = true;
      await executarReajuste(OP, deps, OPTS);
      expect(atacado.A).toEqual(F88);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    });

    it('PUT 200 sem efeito com faixas escritas: 3 escritas, depois compensa e termina erro', async () => {
      const itens = [descendo()];
      const atacado = { A: F80 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      deps.ml.putPreco.mockResolvedValue({ kind: 'ok' });
      for (const n of [1, 2, 3]) {
        await executarReajuste(OP, deps, OPTS);
        expect(deps.ml.putPreco).toHaveBeenCalledTimes(n);
        expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
        expect(itens[0].passos[1].tentativas).toBe(n);
        itens[0].proxima_conferencia = PASSADO;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(3);
      expect(atacado.A).toEqual(F80);
      expect(estados(itens[0])).toEqual(['compensado', 'pendente']);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
    });

    it.each<[string, () => Linha, number]>([
      ['com faixas escritas', () => descendo(), 1],
      ['sem mais nada escrito', () => item('A'), 0],
    ])('crash entre marcar pendente e tratar o esgotamento (%s): exatamente 3 escritas, depois falha', async (_n, novo, indice) => {
      const itens = [novo()];
      const atacado = { A: F80 };
      const deps = montar(itens, { A: plano(100) }, atacado);
      deps.ml.putPreco.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
      for (let n = 0; n < 3; n++) {
        await executarReajuste(OP, deps, OPTS);
        itens[0].proxima_conferencia = PASSADO;
      }
      const marcar = deps.marcarPasso.getMockImplementation()!;
      deps.marcarPasso.mockImplementationOnce(async (...args) => {
        await marcar(...args);
        throw new Error('worker morreu');
      });
      await expect(executarReajuste(OP, deps, OPTS)).rejects.toThrow('worker morreu');
      expect(itens[0].passos[indice]).toMatchObject({ estado: 'pendente', tentativas: 3 });
      itens[0].parado = true;
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(3);
      expect(itens[0].passos[indice].tentativas).toBe(3);
      expect(atacado.A).toEqual(F80);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
    });

    describe('passo pendente esgotado: não escreve, reconcilia por GET', () => {
      const esgotado = () => {
        const i = descendo(['confirmado', 'pendente']);
        i.passos[1].tentativas = 3;
        return i;
      };

      it('no alvo → confirmado, sem ler ofertas', async () => {
        const itens = [esgotado()];
        const deps = montar(itens, { A: plano(90) }, { A: F72 });
        await executarReajuste(OP, deps, OPTS);
        semEscrita(deps);
        expect(deps.ml.lerOfertas).not.toHaveBeenCalled();
        expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
      });

      it('no anterior → compensa, erro', async () => {
        const itens = [esgotado()];
        const deps = montar(itens, { A: plano(100) }, { A: F72 });
        await executarReajuste(OP, deps, OPTS);
        expect(deps.ml.putPreco).not.toHaveBeenCalled();
        expect(deps.ml.gravarFaixas.mock.calls).toEqual([['A', F80]]);
        expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
      });

      it.each<[string, (d: ReturnType<typeof montar>) => void]>([
        ['terceiro valor', (d) => d.ml.lerVivo.mockResolvedValue(plano(95))],
        ['ilegível', (d) => d.ml.lerVivo.mockRejectedValue(new Error('ML 500'))],
      ])('%s → conferindo, nada escrito', async (_n, leitura) => {
        const itens = [esgotado()];
        const deps = montar(itens, { A: plano(100) }, { A: F72 });
        leitura(deps);
        await executarReajuste(OP, deps, OPTS);
        semEscrita(deps);
        expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
        expect(estados(itens[0])).toEqual(['confirmado', 'pendente']);
      });

      it('faixas esgotadas com o base confirmado, no anterior → aplicado com o aviso', async () => {
        const itens = [subindo(['confirmado', 'pendente'])];
        itens[0].passos[1].tentativas = 3;
        const deps = montar(itens, { A: plano(110) }, { A: F80 });
        await executarReajuste(OP, deps, OPTS);
        semEscrita(deps);
        expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: MSG_FAIXAS_PENDENTES });
      });
    });

    it('PUT desconhecido sem efeito, sem mais nada escrito: 3 escritas, depois erro', async () => {
      const itens = [item('A')];
      const deps = montar(itens, { A: plano(100) });
      deps.ml.putPreco.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
      for (const n of [1, 2, 3]) {
        await executarReajuste(OP, deps, OPTS);
        expect(deps.ml.putPreco).toHaveBeenCalledTimes(n);
        itens[0].proxima_conferencia = PASSADO;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(3);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_NAO_APLICADO });
    });

    it('faixas sem efeito com o base confirmado: 3 escritas, depois aplicado com o aviso', async () => {
      const itens = [subindo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(110) }, { A: F80 });
      deps.ml.gravarFaixas.mockResolvedValue({ kind: 'desconhecido', mensagem: 'timeout' });
      for (const n of [1, 2, 3]) {
        await executarReajuste(OP, deps, OPTS);
        expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(n);
        itens[0].proxima_conferencia = PASSADO;
      }
      await executarReajuste(OP, deps, OPTS);
      expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(3);
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: MSG_FAIXAS_PENDENTES });
    });

    it('escrita incerta que aplicou conta como confirmada, sem novo PUT', async () => {
      const itens = [descendo(['confirmado', 'escrita_pedida'], { conferencias: 5 })];
      itens[0].passos[1].tentativas = 3;
      const deps = montar(itens, { A: plano(90) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0].status).toBe('aplicado');
    });
  });

  describe('compensação', () => {
    it('base não provado no anterior → conferindo, nada desfeito', async () => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      deps.ml.lerOfertas.mockResolvedValue([of(95)]);
      deps.ml.lerVivo.mockResolvedValueOnce(plano(100)).mockResolvedValue(plano(95));
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(estados(itens[0])).toEqual(['confirmado', 'pendente']);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
    });

    it.each<[string, ResultadoPut, EstadoPasso]>([
      ['recusada', { kind: 'sem_escrita', status: 400, mensagem: 'não' }, 'volta_pendente'],
      ['incerta', { kind: 'desconhecido', mensagem: 'timeout' }, 'volta_pedida'],
    ])('escrita de volta %s → conferindo, reserva mantida', async (_n, r, estado) => {
      const itens = [descendo(['confirmado', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      deps.ml.lerOfertas.mockResolvedValue([of(95)]);
      deps.ml.gravarFaixas.mockResolvedValue(r);
      await executarReajuste(OP, deps, OPTS);
      expect(estados(itens[0])).toEqual([estado, 'pendente']);
      expect(itens[0]).toMatchObject({ status: 'conferindo', etapa: 'escrita_pedida' });
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
    });

    it('faixas alteradas por terceiro → não sobrescreve: conferindo', async () => {
      const itens = [descendo(['volta_pendente', 'pendente'])];
      const deps = montar(itens, { A: plano(100) }, { A: [{ min_unidades: 3, preco: 77 }] });
      await executarReajuste(OP, deps, OPTS);
      semEscrita(deps);
      expect(itens[0].status).toBe('conferindo');
    });
  });

  describe('Reverter', () => {
    const REV = { ...OP, origem_id: 'op0' };

    it('faixas editadas depois da origem → mudou "Não revertível", nenhuma escrita', async () => {
      const itens = [item('A', { preco: 100, preco_anterior: 110, passos: [faixas(F88, F80), base(110, 100)], avaliacoes: [precoFaixa(F80[0]), precoBase(100)] })];
      const deps = montar(itens, { A: plano(110) }, { A: F72 });
      await executarReajuste(REV, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_ATACADO_MUDOU });
      semEscrita(deps);
    });

    it.each<[string, ConfigMlb]>([
      ['outro %', { faixas: [{ min_unidades: 3, desconto_pct: 7 }], divergente: false }],
      ['cores divergentes', { faixas: null, divergente: true }],
    ])('configuração mudou depois do preview, faixas vivas iguais (%s) → mudou, nenhuma escrita', async (_n, config) => {
      const C = [{ min_unidades: 3, desconto_pct: 20 }];
      const itens = [item('A', { preco: 100, preco_anterior: 110, passos: [faixas(F88, F80, 'pendente', C), base(110, 100)], avaliacoes: [precoFaixa(F80[0]), precoBase(100)] })];
      const deps = montar(itens, { A: plano(110) }, { A: F88 });
      deps.configAtacado.mockResolvedValue(config);
      await executarReajuste(REV, deps, OPTS);
      expect(deps.configAtacado).toHaveBeenCalledWith(['va']);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_ATACADO_MUDOU });
      semEscrita(deps);
    });

    it('configuração igual → executa', async () => {
      const C = [{ min_unidades: 3, desconto_pct: 20 }];
      const itens = [item('A', { preco: 100, preco_anterior: 110, passos: [faixas(F88, F80, 'pendente', C), base(110, 100)], avaliacoes: [precoFaixa(F80[0]), precoBase(100)] })];
      const deps = montar(itens, { A: plano(110) }, { A: F88 });
      deps.configAtacado.mockResolvedValue({ faixas: C, divergente: false });
      await executarReajuste(REV, deps, OPTS);
      expect(itens[0].status).toBe('aplicado');
    });

    it.each([
      ['ida', OP, F80, F72],
      ['volta', REV, F72, F80],
    ])('só faixas (%s): sem persistir, preço e marca do operador intactos', async (_n, op, antes, depois) => {
      const itens = [item('A', { preco: 100, preco_anterior: 100, restaurar: [], passos: [faixas(antes, depois)], avaliacoes: [precoFaixa(depois[0])] })];
      const atacado = { A: antes };
      const deps = montar(itens, { A: plano(100) }, atacado);
      await executarReajuste(op, deps, OPTS);
      expect(atacado.A).toEqual(depois);
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
      expect(deps.persistir).not.toHaveBeenCalled();
      expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    });

    it('só faixas: retomada ml_confirmado também não chama a persistência', async () => {
      const itens = [item('A', {
        preco: 100, preco_anterior: 100, restaurar: [], passos: [faixas(F80, F72, 'confirmado')], avaliacoes: [],
        status: 'enviando', parado: true, etapa: 'ml_confirmado',
      })];
      const deps = montar(itens, { A: plano(100) }, { A: F72 });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.persistir).not.toHaveBeenCalled();
      expect(itens[0].status).toBe('aplicado');
    });
  });
});

describe('executarReajuste — atacado por família', () => {
  const ANTES = [{ min_unidades: 2, desconto_pct: 5 }];
  const vivas = [{ min_unidades: 2, preco: 95 }];
  const novas = [{ min_unidades: 2, preco: 90 }];
  const daFamilia = (o: Partial<Extract<Passo, { tipo: 'faixas' }>> = {}): Passo => ({ ...(faixas(vivas, novas, 'pendente', ANTES) as Extract<Passo, { tipo: 'faixas' }>), familia_id: 'f', ...o });
  const irmao = (o: Partial<Linha> = {}) => item('A', { preco: 100, preco_anterior: 100, restaurar: [], passos: [daFamilia()], avaliacoes: [precoFaixa(novas[0])], ...o });
  const montarFamilia = (itens: Linha[], config: ConfigMlb) => {
    const deps = montar(itens, { A: plano(100) }, { A: structuredClone(vivas) });
    deps.configAtacado.mockResolvedValue(config);
    return deps;
  };

  it('anúncio irmão entra como só faixas, sem fixar preço', async () => {
    const itens = [irmao()];
    const deps = montarFamilia(itens, { faixas: ANTES, divergente: false });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'aplicado', etapa: null, mensagem: null });
    expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', novas);
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
    expect(deps.persistir).not.toHaveBeenCalled();
  });

  it.each<[string, ConfigMlb, string]>([
    ['% mudou', { faixas: [{ min_unidades: 2, desconto_pct: 7 }], divergente: false }, MSG_FAIXAS_MUDARAM],
    ['cores divergentes', { faixas: null, divergente: true }, MSG_FAIXAS_MUDARAM],
    ['lotes divergentes', { faixas: null, divergente: true, lotesDivergentes: true }, MSG_FAIXAS_MUDARAM],
    ['cor com config própria', { faixas: ANTES, divergente: false, porCor: true }, MSG_ATACADO_POR_COR],
  ])('ida: configuração revalidada antes de escrever (%s) → mudou, nada escrito', async (_n, config, mensagem) => {
    const itens = [irmao()];
    const deps = montarFamilia(itens, config);
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem });
    expect(deps.ml.gravarFaixas).not.toHaveBeenCalled();
  });

  it('ida fora de edição: a mesma revalidação, cor com config igual passa', async () => {
    const f = faixas(vivas, novas, 'pendente', ANTES);
    const itens = [irmao({ passos: [f] })];
    const deps = montarFamilia(itens, { faixas: ANTES, divergente: false, porCor: true });
    await executarReajuste(OP, deps, OPTS);
    expect(itens[0].status).toBe('aplicado');
  });

  it('cor ganhou config depois das faixas: desfaz antes do base, nunca conclui pela metade', async () => {
    const itens = [item('A', { preco: 90, preco_anterior: 100, passos: [daFamilia({ alvo: [{ min_unidades: 2, preco: 85 }] }), base(100, 90)], avaliacoes: [precoFaixa({ min_unidades: 2, preco: 85 }), precoBase(90)] })];
    const deps = montarFamilia(itens, { faixas: ANTES, divergente: false });
    deps.configAtacado.mockResolvedValueOnce({ faixas: ANTES, divergente: false }).mockResolvedValue({ faixas: ANTES, divergente: false, porCor: true });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_ATACADO_POR_COR });
    expect(deps.ml.gravarFaixas.mock.calls.map(([, fs]) => fs)).toEqual([[{ min_unidades: 2, preco: 85 }], vivas]);
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
  });

  it('faixas já iguais não têm volta: compensar não reescreve nem fica preso', async () => {
    const itens = [item('A', { preco: 99, preco_anterior: 100, passos: [daFamilia({ alvo: vivas }), base(100, 99)], avaliacoes: [precoFaixa(vivas[0]), precoBase(99)] })];
    const deps = montarFamilia(itens, { faixas: ANTES, divergente: false });
    deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'recusado' });
    await executarReajuste(OP, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: 'recusado' });
    expect(deps.ml.gravarFaixas).toHaveBeenCalledTimes(1);
    expect(itens[0].passos[0].estado).toBe('compensado');
  });

  it('Reverter de `nao_aplicado`: desfaz as faixas aplicadas e não mexe em preço', async () => {
    const op = { ...OP, origem_id: 'o' };
    const itens = [irmao({ passos: [faixas(novas, vivas, 'pendente', ANTES)], avaliacoes: [precoFaixa(vivas[0])] })];
    const deps = montar(itens, { A: plano(100) }, { A: structuredClone(novas) });
    deps.configAtacado.mockResolvedValue({ faixas: ANTES, divergente: false });
    await executarReajuste(op, deps, OPTS);
    expect(itens[0].status).toBe('aplicado');
    expect(deps.ml.gravarFaixas).toHaveBeenCalledWith('A', vivas);
    expect(deps.ml.putPreco).not.toHaveBeenCalled();
    expect(deps.persistir).not.toHaveBeenCalled();
  });

  it('Reverter: família mudou sob a reserva → mudou', async () => {
    const op = { ...OP, origem_id: 'o' };
    const itens = [irmao({ passos: [faixas(novas, vivas, 'pendente', ANTES)], avaliacoes: [precoFaixa(vivas[0])] })];
    const deps = montar(itens, { A: plano(100) }, { A: structuredClone(novas) });
    deps.configAtacado.mockResolvedValue({ faixas: [{ min_unidades: 2, desconto_pct: 10 }], divergente: false });
    await executarReajuste(op, deps, OPTS);
    expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_ATACADO_MUDOU });
    expect(deps.ml.gravarFaixas).not.toHaveBeenCalled();
  });

  describe('Reverter de `nao_aplicado` só com base', () => {
    const op = { ...OP, origem_id: 'o' };
    const baseConferido: Passo = { ...base(110, 100), config: ANTES } as Passo;
    const voltar = () => [item('A', { preco: 100, preco_anterior: 110, passos: [structuredClone(baseConferido)], avaliacoes: [precoBase(100)] })];

    it('config intacta → reverte', async () => {
      const itens = voltar();
      const deps = montar(itens, { A: plano(110) });
      deps.configAtacado.mockResolvedValue({ faixas: ANTES, divergente: false });
      await executarReajuste(op, deps, OPTS);
      expect(deps.ml.putPreco).toHaveBeenCalledWith('A', 100, null);
      expect(itens[0].status).toBe('aplicado');
    });

    it.each<[string, ConfigMlb, string]>([
      ['% mudou', { faixas: [{ min_unidades: 2, desconto_pct: 10 }], divergente: false }, MSG_ATACADO_MUDOU],
      ['cor com config própria', { faixas: ANTES, divergente: false, porCor: true }, MSG_ATACADO_POR_COR],
    ])('%s depois do preview → mudou, sem PUT', async (_n, config, mensagem) => {
      const itens = voltar();
      const deps = montar(itens, { A: plano(110) });
      deps.configAtacado.mockResolvedValue(config);
      await executarReajuste(op, deps, OPTS);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem });
      expect(deps.ml.putPreco).not.toHaveBeenCalled();
    });

    it('base sem config da origem não consulta o atacado', async () => {
      const itens = [item('A')];
      const deps = montar(itens, { A: plano(100) });
      await executarReajuste(OP, deps, OPTS);
      expect(deps.configAtacado).not.toHaveBeenCalled();
    });
  });

  describe('recusa na compensação', () => {
    const novasDesc = [{ min_unidades: 2, preco: 85 }];
    const descendo = () => [item('A', { preco: 90, preco_anterior: 100, passos: [daFamilia({ alvo: novasDesc }), base(100, 90)], avaliacoes: [precoFaixa(novasDesc[0]), precoBase(90)] })];
    /** Roda até o item sair de `conferindo`, com a conferência vencida a cada rodada. */
    async function rodadas(itens: Linha[], deps: ReturnType<typeof montar>, n: number) {
      for (let i = 0; i < n && itens[0].status === 'conferindo'; i++) {
        itens[0].proxima_conferencia = PASSADO;
        await executarReajuste(OP, deps, OPTS);
      }
    }
    const montarRecusa = (volta: ResultadoPut) => {
      const itens = descendo();
      const deps = montarFamilia(itens, { faixas: ANTES, divergente: false });
      deps.ml.putPreco.mockResolvedValue({ kind: 'sem_escrita', status: 400, mensagem: 'recusado' });
      const gravar = deps.ml.gravarFaixas.getMockImplementation()!;
      deps.ml.gravarFaixas.mockImplementation(async (id, fs) => (fs === novasDesc || fs[0].preco === 85 ? gravar(id, fs) : volta));
      return { itens, deps };
    };
    const voltas = (deps: ReturnType<typeof montar>) => deps.ml.gravarFaixas.mock.calls.filter(([, fs]) => fs[0].preco === 95).length;

    it('recusa definitiva: repete até o limite, termina `erro` e solta a reserva', async () => {
      const { itens, deps } = montarRecusa({ kind: 'sem_escrita', status: 400, mensagem: 'não' });
      await executarReajuste(OP, deps, OPTS);
      expect(itens[0].status).toBe('conferindo');
      await rodadas(itens, deps, 8);
      expect(resumo(itens[0])).toEqual({ status: 'erro', etapa: null, mensagem: MSG_FAIXAS_NAO_RESTAURADAS });
      expect(voltas(deps)).toBe(3);
      expect(deps.concluir).toHaveBeenCalled();
      expect(deps.ml.putPreco).toHaveBeenCalledTimes(1);
    });

    it('volta incerta segue `conferindo`, sem limite', async () => {
      const { itens, deps } = montarRecusa({ kind: 'desconhecido' });
      await executarReajuste(OP, deps, OPTS);
      await rodadas(itens, deps, 8);
      expect(itens[0].status).toBe('conferindo');
      expect(voltas(deps)).toBeGreaterThan(3);
      expect(deps.concluir).not.toHaveBeenCalled();
    });

    it('recusa e depois aceita: compensa normalmente', async () => {
      const { itens, deps } = montarRecusa({ kind: 'sem_escrita', status: 429, mensagem: 'não' });
      await executarReajuste(OP, deps, OPTS);
      const gravar = deps.ml.gravarFaixas;
      gravar.mockImplementation(async () => ({ kind: 'ok' }));
      deps.ml.lerFaixas.mockResolvedValue(vivas);
      await rodadas(itens, deps, 3);
      expect(resumo(itens[0])).toEqual({ status: 'mudou', etapa: null, mensagem: MSG_COMPENSADO });
    });
  });
});

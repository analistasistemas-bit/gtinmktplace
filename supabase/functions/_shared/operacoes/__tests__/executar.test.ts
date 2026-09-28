import { describe, expect, it, vi } from 'vitest';
import type { Semaforo } from '../../promocoes/tipos.ts';
import { conferir, executar, proximoIntervalo, type ItemRow, type OperacaoRow } from '../executar.ts';
import { SemEscritaPromocoes, type ClienteML } from '../ml.ts';
import type { ItemNaCampanha } from '../tipos.ts';

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const T0 = Date.parse('2026-09-27T12:00:00Z');

type Linha = ItemRow & { mensagem?: string | null; offer_id?: string | null };
const item = (id: string, x: Partial<Linha> = {}): Linha => ({
  ml_item_id: id, preco: 10, status: 'pendente', conferencias: 0, semaforo: 'verde', confirmado_risco: false,
  proxima_conferencia: null, ...x,
});
const conv = (x: Partial<ItemNaCampanha> = {}): ItemNaCampanha =>
  ({ status: 'candidate', preco_min: 5, preco_max: 20, offer_id: null, ...x });

function montar(op: OperacaoRow, itens: Linha[], opts: {
  campanha?: (id: string, chamada: number) => ItemNaCampanha | null;
  post?: (id: string) => { offer_id: string | null };
  semaforo?: Semaforo | null;
  passoMs?: number;
} = {}) {
  let t = T0;
  const leituras = new Map<string, number>();
  const ml: ClienteML = {
    lerNaCampanha: vi.fn(async (_p, _t, id: string) => {
      const n = (leituras.get(id) ?? 0) + 1;
      leituras.set(id, n);
      return opts.campanha ? opts.campanha(id, n) : conv();
    }),
    lerRelacoes: vi.fn(async () => ({ catalog_listing: false, relacionados: [] })),
    post: vi.fn(async (id: string) => (opts.post ? opts.post(id) : { offer_id: null })),
    del: vi.fn(async () => {}),
  };
  const deps = {
    ml,
    agora: () => (t += opts.passoMs ?? 0),
    reivindicar: vi.fn(async (_o: string, id: string) => {
      const it = itens.find((i) => i.ml_item_id === id)!;
      if (it.status !== 'pendente' && it.status !== 'enviando') return false;
      it.status = 'enviando';
      return true;
    }),
    itensPendentes: vi.fn(async (_o: string, limite: number) =>
      itens.filter((i) => i.status === 'pendente').slice(0, limite).map((i) => ({ ...i }))),
    itensAConferir: vi.fn(async () =>
      itens.filter((i) => i.status === 'saida_solicitada' && i.proxima_conferencia).map((i) => ({ ...i }))),
    gravarItem: vi.fn(async (_o: string, id: string, campos: Partial<Linha>) => {
      Object.assign(itens.find((i) => i.ml_item_id === id)!, campos);
    }),
    semaforoAtual: vi.fn(async () => (opts.semaforo === undefined ? 'verde' : opts.semaforo)),
    espelharStatusCentral: vi.fn(async () => {}),
    continuar: vi.fn(async () => {}),
    agendarConferencia: vi.fn(async (_s: number) => {}),
    concluir: vi.fn(async () => {}),
  };
  return { deps, ml, avancar: (ms: number) => { t += ms; } };
}

const DEAL_ADERIR: OperacaoRow = { id: 'op1', org_id: 'o', acao: 'aderir', promocao_id: 'P-1', promocao_tipo: 'DEAL' };
const OPTS = { limiteMs: 60_000, lote: 10 };

describe('proximoIntervalo', () => {
  it('5, 10, 20, 40 min e depois 60 min até 24 h desde a saída pedida', () => {
    expect([0, 1, 2, 3, 4, 5].map(proximoIntervalo)).toEqual([300, 600, 1200, 2400, 3600, 3600]);
    // soma dos intervalos até desistir nunca passa de 24 h
    let total = 0;
    let c = 0;
    for (let s = proximoIntervalo(c); s !== null; s = proximoIntervalo(++c)) total += s;
    expect(total).toBeLessThanOrEqual(86_400);
    expect(total + 3600).toBeGreaterThan(86_400);
    expect(proximoIntervalo(c)).toBeNull();
  });
});

describe('executar — aderir', () => {
  it('DEAL: aplica, relê a campanha e espelha o status real', async () => {
    const itens = [item('MLB1', { preco: 12 })];
    const { deps, ml } = montar(DEAL_ADERIR, itens, { campanha: (_id, n) => (n === 1 ? conv() : conv({ status: 'started' })) });
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 12 });
    expect(itens[0].status).toBe('aplicado');
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'MLB1', 'participando', 'started');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('ainda candidate depois do 201 → espelha pending', async () => {
    const { deps } = montar(DEAL_ADERIR, [item('MLB1')]);
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'MLB1', 'participando', 'pending');
  });

  it('SMART: grava o offer_id novo devolvido pelo POST', async () => {
    const op: OperacaoRow = { ...DEAL_ADERIR, promocao_tipo: 'SMART' };
    const itens = [item('MLB1', { preco: null })];
    const { deps, ml } = montar(op, itens, {
      campanha: () => conv({ offer_id: 'CANDIDATE-MLB1-1' }), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
    await executar(op, deps, OPTS);
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'SMART', offer_id: 'CANDIDATE-MLB1-1' });
    expect(itens[0]).toMatchObject({ status: 'aplicado', offer_id: 'OFFER-MLB1-9' });
  });

  it('retry: item já pending no fresco → ja_estava sem POST', async () => {
    const itens = [item('MLB1', { status: 'enviando' })];
    const { deps, ml } = montar(DEAL_ADERIR, itens, { campanha: () => conv({ status: 'pending' }) });
    deps.itensPendentes.mockImplementation(async () => itens.filter((i) => i.status === 'enviando').map((i) => ({ ...i })));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('ja_estava');
  });

  it('claim perdido → não lê nem escreve no ML', async () => {
    const { deps, ml } = montar(DEAL_ADERIR, [item('MLB1')]);
    deps.reivindicar.mockResolvedValue(false);
    deps.itensPendentes.mockResolvedValueOnce([item('MLB1')]).mockResolvedValue([]);
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 0, continuou: false });
    expect(ml.lerNaCampanha).not.toHaveBeenCalled();
    expect(ml.post).not.toHaveBeenCalled();
  });

  it('semáforo piorou sem confirmar risco → mudou sem POST', async () => {
    const itens = [item('MLB1', { semaforo: 'amarelo' })];
    const { deps, ml } = montar(DEAL_ADERIR, itens, { semaforo: 'vermelho' });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(deps.semaforoAtual).toHaveBeenCalledWith('P-1', 'MLB1', 10);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O resultado piorou desde o preview' });
  });

  it('semáforo piorou mas risco confirmado → posta', async () => {
    const itens = [item('MLB1', { semaforo: 'amarelo', confirmado_risco: true })];
    const { deps, ml } = montar(DEAL_ADERIR, itens, { semaforo: 'vermelho' });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(ml.post).toHaveBeenCalled();
    expect(itens[0].status).toBe('aplicado');
  });

  it('item sumiu da Central (semaforoAtual null) → mudou sem POST', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(DEAL_ADERIR, itens, { semaforo: null });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('mudou');
  });

  it('403 no segundo item → 2º..N viram erro de reconexão, sem continuar', async () => {
    const itens = [item('MLB1'), item('MLB2'), item('MLB3'), item('MLB4')];
    const { deps, ml } = montar(DEAL_ADERIR, itens);
    vi.mocked(ml.post).mockResolvedValueOnce({ offer_id: null }).mockRejectedValue(new SemEscritaPromocoes('ML 403'));
    expect(await executar(DEAL_ADERIR, deps, { limiteMs: 60_000, lote: 2 })).toEqual({ processados: 2, continuou: false });
    expect(itens.map((i) => i.status)).toEqual(['aplicado', 'erro', 'erro', 'erro']);
    expect(itens.slice(1).every((i) => i.mensagem === RECONECTAR)).toBe(true);
    expect(ml.post).toHaveBeenCalledTimes(2);
    expect(deps.continuar).not.toHaveBeenCalled();
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('outro erro no item → erro com a mensagem e segue', async () => {
    const itens = [item('MLB1'), item('MLB2')];
    const { deps, ml } = montar(DEAL_ADERIR, itens);
    vi.mocked(ml.post).mockRejectedValueOnce(new Error('ML 400: preço inválido'));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 400: preço inválido' });
    expect(itens[1].status).toBe('aplicado');
  });

  it('orçamento estourado → continuar uma vez, sem concluir', async () => {
    const itens = Array.from({ length: 5 }, (_, i) => item(`MLB${i}`));
    const { deps } = montar(DEAL_ADERIR, itens, { passoMs: 1000 });
    const r = await executar(DEAL_ADERIR, deps, { limiteMs: 5000, lote: 10 });
    expect(r.continuou).toBe(true);
    expect(r.processados).toBeGreaterThan(0);
    expect(r.processados).toBeLessThan(5);
    expect(deps.continuar).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
    expect(itens.some((i) => i.status === 'pendente')).toBe(true);
  });
});

describe('executar — sair', () => {
  const SAIR: OperacaoRow = { ...DEAL_ADERIR, acao: 'sair' };

  it('DELETE → saida_solicitada com próxima conferência em 5 min + agendarConferencia(300)', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(SAIR, itens, { campanha: () => conv({ status: 'started' }) });
    await executar(SAIR, deps, OPTS);
    expect(ml.del).toHaveBeenCalledWith('MLB1', 'promotion_type=DEAL&promotion_id=P-1&app_version=v2');
    expect(ml.lerRelacoes).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({
      status: 'saida_solicitada', mensagem: 'Saída pedida ao ML; aguardando confirmação', conferencias: 0,
      proxima_conferencia: new Date(T0 + 300_000).toISOString(),
    });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('403 com saída já pedida → marca erro e agenda conferência (não conclui)', async () => {
    const itens = [item('MLB1'), item('MLB2')];
    const { deps, ml } = montar(SAIR, itens, { campanha: () => conv({ status: 'started' }) });
    vi.mocked(ml.del).mockResolvedValueOnce().mockRejectedValue(new SemEscritaPromocoes('ML 403'));
    await executar(SAIR, deps, OPTS);
    expect(itens.map((i) => i.status)).toEqual(['saida_solicitada', 'erro']);
    expect(deps.agendarConferencia).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});

describe('conferir', () => {
  const SAIR_SMART: OperacaoRow = { ...DEAL_ADERIR, acao: 'sair', promocao_tipo: 'SMART' };
  const vencido = (x: Partial<Linha> = {}) =>
    item('MLB1', { status: 'saida_solicitada', proxima_conferencia: new Date(T0).toISOString(), ...x });

  it('fresco null → aplicado, espelha saída e conclui', async () => {
    const itens = [vencido()];
    const { deps } = montar(SAIR_SMART, itens, { campanha: () => null });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 1, pendentes: 0 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null, proxima_conferencia: null });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'MLB1', 'saiu');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('candidate também confirma a saída (DEAL volta a convidado)', async () => {
    const itens = [vencido()];
    const { deps } = montar(DEAL_ADERIR, itens, { campanha: () => conv() });
    expect(await conferir({ ...DEAL_ADERIR, acao: 'sair' }, deps)).toEqual({ confirmados: 1, pendentes: 0 });
  });

  it('ainda participando → conta a conferência e reagenda com o intervalo seguinte', async () => {
    const itens = [vencido({ conferencias: 1 })];
    const { deps } = montar(SAIR_SMART, itens, { campanha: () => conv({ status: 'started' }) });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 2,
      proxima_conferencia: new Date(T0 + 1200_000).toISOString() });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(1200);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('no limite de 24 h → mantém saida_solicitada com a mensagem do Seller Center e conclui', async () => {
    let c = 0;
    while (proximoIntervalo(c + 1) !== null) c++;
    const itens = [vencido({ conferencias: c })];
    const { deps } = montar(SAIR_SMART, itens, { campanha: () => conv({ status: 'pending' }) });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 0 });
    expect(itens[0]).toMatchObject({ status: 'saida_solicitada', mensagem: SELLER_CENTER, proxima_conferencia: null });
    expect(deps.concluir).toHaveBeenCalledTimes(1);
    expect(deps.agendarConferencia).not.toHaveBeenCalled();
  });

  it('item ainda não vencido não é lido; reagenda para quando vencer', async () => {
    const itens = [vencido({ proxima_conferencia: new Date(T0 + 90_000).toISOString() })];
    const { deps, ml } = montar(SAIR_SMART, itens);
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(ml.lerNaCampanha).not.toHaveBeenCalled();
    expect(deps.agendarConferencia).toHaveBeenCalledWith(90);
  });

  it('erro na leitura conta como não confirmado (tenta de novo no próximo intervalo)', async () => {
    const itens = [vencido()];
    const { deps, ml } = montar(SAIR_SMART, itens);
    vi.mocked(ml.lerNaCampanha).mockRejectedValue(new Error('ML 500 em /seller-promotions/promotions'));
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0].conferencias).toBe(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Semaforo } from '../../promocoes/tipos.ts';
import { conferir, executar, proximoIntervalo, type ItemRow, type OperacaoRow } from '../executar.ts';
import { SemEscritaPromocoes, type ClienteML } from '../ml.ts';
import type { ItemNaCampanha, OfertaNoItem } from '../tipos.ts';

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const T0 = Date.parse('2026-09-27T12:00:00Z');
const H = 3_600_000;

type Linha = ItemRow & { mensagem?: string | null; offer_id?: string | null };
const item = (id: string, x: Partial<Linha> = {}): Linha => ({
  ml_item_id: id, preco: 10, status: 'pendente', conferencias: 0, semaforo: 'verde', confirmado_risco: false,
  proxima_conferencia: null, saida_pedida_em: null, ...x,
});
const conv = (x: Partial<ItemNaCampanha> = {}): ItemNaCampanha =>
  ({ status: 'candidate', preco_min: 5, preco_max: 20, offer_id: null, estoque_min: null, ...x });

function montar(itens: Linha[], opts: {
  campanha?: (id: string, chamada: number) => ItemNaCampanha | null;
  post?: (id: string) => { offer_id: string | null };
  put?: (id: string) => void;
  oferta?: (id: string, chamada: number) => OfertaNoItem | null;
  semaforo?: Semaforo | null;
  passoMs?: number;
} = {}) {
  let t = T0;
  const leituras = new Map<string, number>();
  const leiturasOferta = new Map<string, number>();
  const ml: ClienteML = {
    lerNaCampanha: vi.fn(async (_p, _t, id: string) => {
      const n = (leituras.get(id) ?? 0) + 1;
      leituras.set(id, n);
      return opts.campanha ? opts.campanha(id, n) : conv();
    }),
    lerOfertaNoItem: vi.fn(async (_p, id: string) => {
      const n = (leiturasOferta.get(id) ?? 0) + 1;
      leiturasOferta.set(id, n);
      return opts.oferta ? opts.oferta(id, n) : null;
    }),
    lerRelacoes: vi.fn(async () => ({ catalog_listing: false, relacionados: [], disponivel: 180 })),
    post: vi.fn(async (id: string) => (opts.post ? opts.post(id) : { offer_id: null })),
    put: vi.fn(async (id: string) => { if (opts.put) opts.put(id); }),
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
    temEnviando: vi.fn(async () => itens.some((i) => i.status === 'enviando')),
    itensAConferir: vi.fn(async () =>
      itens.filter((i) => i.status === 'saida_solicitada' && i.proxima_conferencia).map((i) => ({ ...i }))),
    gravarItem: vi.fn(async (_o: string, id: string, campos: Partial<Linha>) => {
      Object.assign(itens.find((i) => i.ml_item_id === id)!, campos);
    }),
    semaforoAtual: vi.fn(async () => (opts.semaforo === undefined ? 'verde' : opts.semaforo)),
    espelharStatusCentral: vi.fn(async () => {}),
    espelharPreco: vi.fn(async () => {}),
    recontarCentral: vi.fn(async () => {}),
    continuar: vi.fn(async (_s?: number) => {}),
    agendarConferencia: vi.fn(async (_s: number) => {}),
    concluir: vi.fn(async () => {}),
  };
  return { deps, ml, avancar: (ms: number) => { t += ms; } };
}

const DEAL_ADERIR: OperacaoRow = {
  id: 'op1', org_id: 'o', acao: 'aderir', promocao_id: 'P-1', promocao_tipo: 'DEAL', promocao_status: 'started',
};
const SAIR: OperacaoRow = { ...DEAL_ADERIR, acao: 'sair' };
const SAIR_SMART: OperacaoRow = { ...SAIR, promocao_tipo: 'SMART' };
const OPTS = { limiteMs: 60_000, lote: 10 };

describe('proximoIntervalo', () => {
  it('5, 10, 20, 40 min e depois 60 min', () => {
    expect([0, 1, 2, 3, 4, 5].map((c) => proximoIntervalo(c, 0))).toEqual([300, 600, 1200, 2400, 3600, 3600]);
  });
  it('relógio: nunca passa de 24 h desde a saída pedida; em 24 h → null', () => {
    expect(proximoIntervalo(10, 86_400 - 100)).toBe(100);
    expect(proximoIntervalo(10, 86_400)).toBeNull();
    expect(proximoIntervalo(0, 90_000)).toBeNull(); // conferência atrasada também desiste
  });
});

describe('executar — aderir', () => {
  it('DEAL: aplica, relê a campanha e espelha o status real com o tipo', async () => {
    const itens = [item('MLB1', { preco: 12 })];
    const { deps, ml } = montar(itens, { campanha: (_id, n) => (n === 1 ? conv() : conv({ status: 'pending' })) });
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 12 });
    expect(itens[0].status).toBe('aplicado');
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'pending');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
    expect(ml.lerOfertaNoItem).not.toHaveBeenCalled();
  });

  // Jaquetas da Zaven (03/11): aplicadas a R$ 49,90, Central seguia com R$ 63,72 e "0 participando" até o sync.
  it('espelha o preço aplicado e recalcula a contagem da campanha ao fim', async () => {
    const itens = [item('MLB1', { preco: 12 }), item('MLB2', { preco: 12 })];
    const { deps } = montar(itens, { campanha: (_id, n) => (n % 2 === 1 ? conv() : conv({ status: 'started' })) });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB1', 12);
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB2', 12);
    expect(deps.recontarCentral).toHaveBeenCalledTimes(1);
    expect(deps.recontarCentral).toHaveBeenCalledWith('P-1');
  });

  it('achado Codex P1: SMART não espelha preço (POST só leva offer_id; o preço é do ML), mesmo com preço do preview', async () => {
    const op: OperacaoRow = { ...DEAL_ADERIR, promocao_tipo: 'SMART' };
    // Fluxo real: validarPedido preenche o preço do SMART com o preco_promo do preview.
    const itens = [item('MLB1', { preco: 15 })];
    const { deps } = montar(itens, { campanha: () => conv({ offer_id: 'C-1' }), post: () => ({ offer_id: 'O-1' }) });
    deps.recontarCentral.mockRejectedValue(new Error('db'));
    expect(await executar(op, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(deps.espelharPreco).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('aplicado');
  });

  it('ainda candidate depois do 201 → espelha o status da promoção (ativa: started; futura: pending)', async () => {
    const a = montar([item('MLB1')]);
    await executar(DEAL_ADERIR, a.deps, OPTS);
    expect(a.deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'started');
    const b = montar([item('MLB1')]);
    await executar({ ...DEAL_ADERIR, promocao_status: 'pending' }, b.deps, OPTS);
    expect(b.deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'pending');
  });

  it('releitura falha depois do 201 → ainda aplicado, espelha pelo status da promoção', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.lerNaCampanha).mockResolvedValueOnce(conv()).mockRejectedValueOnce(new Error('ML 500'));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0].status).toBe('aplicado');
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'started');
  });

  it('SMART: grava o offer_id novo devolvido pelo POST', async () => {
    const op: OperacaoRow = { ...DEAL_ADERIR, promocao_tipo: 'SMART' };
    const itens = [item('MLB1', { preco: null })];
    const { deps, ml } = montar(itens, {
      campanha: () => conv({ offer_id: 'CANDIDATE-MLB1-1' }), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
    await executar(op, deps, OPTS);
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'SMART', offer_id: 'CANDIDATE-MLB1-1' });
    expect(itens[0]).toMatchObject({ status: 'aplicado', offer_id: 'OFFER-MLB1-9' });
  });

  it('retry: item já participando no fresco → ja_estava sem POST, grava offer_id e espelha', async () => {
    const op: OperacaoRow = { ...DEAL_ADERIR, promocao_tipo: 'SMART' };
    const itens = [item('MLB1', { status: 'enviando' })];
    const { deps, ml } = montar(itens, { campanha: () => conv({ status: 'pending', offer_id: 'OFFER-MLB1-9' }) });
    deps.itensPendentes.mockImplementation(async () => itens.filter((i) => i.status === 'enviando').map((i) => ({ ...i })));
    await executar(op, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'ja_estava', offer_id: 'OFFER-MLB1-9' });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'SMART', 'MLB1', 'pending');
  });

  it('claim perdido → não lê nem escreve no ML', async () => {
    const { deps, ml } = montar([item('MLB1')]);
    deps.reivindicar.mockResolvedValue(false);
    deps.itensPendentes.mockResolvedValueOnce([item('MLB1')]).mockResolvedValue([]);
    deps.temEnviando.mockResolvedValue(false);
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 0, continuou: false });
    expect(ml.lerNaCampanha).not.toHaveBeenCalled();
    expect(ml.post).not.toHaveBeenCalled();
  });

  it('sem pendentes mas com enviando recente → continuar(150), não conclui', async () => {
    const { deps } = montar([item('MLB1', { status: 'enviando' })]);
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 0, continuou: true });
    expect(deps.continuar).toHaveBeenCalledWith(150);
    expect(deps.concluir).not.toHaveBeenCalled();
    expect(deps.agendarConferencia).not.toHaveBeenCalled();
  });

  it('semáforo piorou sem confirmar risco → mudou sem POST', async () => {
    const itens = [item('MLB1', { semaforo: 'amarelo' })];
    const { deps, ml } = montar(itens, { semaforo: 'vermelho' });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(deps.semaforoAtual).toHaveBeenCalledWith('P-1', 'MLB1', 10);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O resultado piorou desde o preview' });
  });

  it('semáforo piorou mas risco confirmado → posta', async () => {
    const itens = [item('MLB1', { semaforo: 'amarelo', confirmado_risco: true })];
    const { deps, ml } = montar(itens, { semaforo: 'vermelho' });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(ml.post).toHaveBeenCalled();
    expect(itens[0].status).toBe('aplicado');
  });

  it('item sumiu da Central (semaforoAtual null) → mudou com mensagem própria, sem POST', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens, { semaforo: null });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O anúncio saiu da Central desde o preview' });
  });

  it('403 no segundo item → 2º..N viram erro de reconexão, sem continuar', async () => {
    const itens = [item('MLB1'), item('MLB2'), item('MLB3'), item('MLB4')];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.post).mockResolvedValueOnce({ offer_id: null }).mockRejectedValue(new SemEscritaPromocoes('ML 403'));
    expect(await executar(DEAL_ADERIR, deps, { limiteMs: 60_000, lote: 2 })).toEqual({ processados: 2, continuou: false });
    expect(itens.map((i) => i.status)).toEqual(['aplicado', 'erro', 'erro', 'erro']);
    expect(itens.slice(1).every((i) => i.mensagem === RECONECTAR)).toBe(true);
    expect(ml.post).toHaveBeenCalledTimes(2);
    expect(deps.continuar).not.toHaveBeenCalled();
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('outro erro antes da escrita → erro com a mensagem e segue', async () => {
    const itens = [item('MLB1'), item('MLB2')];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.post).mockRejectedValueOnce(new Error('ML 400: preço inválido'));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 400: preço inválido' });
    expect(itens[1].status).toBe('aplicado');
  });

  it('falha ao gravar depois do 201 → relança e o item fica enviando', async () => {
    const itens = [item('MLB1')];
    const { deps } = montar(itens);
    deps.gravarItem.mockRejectedValueOnce(new Error('db caiu'));
    await expect(executar(DEAL_ADERIR, deps, OPTS)).rejects.toThrow('db caiu');
    expect(itens[0].status).toBe('enviando');
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('orçamento estourado → continuar uma vez, sem concluir', async () => {
    const itens = Array.from({ length: 5 }, (_, i) => item(`MLB${i}`));
    const { deps } = montar(itens, { passoMs: 1000 });
    const r = await executar(DEAL_ADERIR, deps, { limiteMs: 5000, lote: 10 });
    expect(r.continuou).toBe(true);
    expect(r.processados).toBeGreaterThan(0);
    expect(r.processados).toBeLessThan(5);
    expect(deps.continuar).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
    expect(itens.some((i) => i.status === 'pendente')).toBe(true);
  });
});

// Relâmpago (spike 02/11): campanha min 8,70 + stock.min 5; visão por item 5,80/26,10/24,65; janela atribuída pelo ML.
describe('executar — LIGHTNING', () => {
  const LGH: OperacaoRow = { ...DEAL_ADERIR, promocao_id: 'LGH-1', promocao_tipo: 'LIGHTNING', promocao_status: 'pending' };
  const LGH_SAIR: OperacaoRow = { ...LGH, acao: 'sair' };
  const convite = conv({ preco_min: 8.7, preco_max: null, offer_id: 'CANDIDATE-MLB1-5', estoque_min: 5 });
  const ofertaConvite: OfertaNoItem = { preco_min: 5.8, preco_max: 26.1, preco_sugerido: 24.65, estoque_min: 5, inicio: null, fim: null };
  const ofertaAgendada: OfertaNoItem = { ...ofertaConvite, estoque_min: null, inicio: '2026-11-06T00:00:00', fim: '2026-11-06T11:59:59' };

  it('aderir: POST com stock e mensagem de janela', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, {
      campanha: (_id, n) => (n === 1 ? convite : conv({ status: 'pending', offer_id: 'OFFER-X-1' })),
      oferta: (_id, n) => (n === 1 ? ofertaConvite : ofertaAgendada),
      post: () => ({ offer_id: 'OFFER-X-1' }),
    });
    await executar(LGH, deps, OPTS);
    expect(ml.lerOfertaNoItem).toHaveBeenCalledWith('LGH-1', 'MLB1');
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'LGH-1', promotion_type: 'LIGHTNING', deal_price: 24.65, stock: 5 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', offer_id: 'OFFER-X-1', mensagem: 'Agendada: 06/11 00:00–11:59' });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('LGH-1', 'LIGHTNING', 'MLB1', 'pending');
  });

  it('janela com fuso explícito → horário de Brasília', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps } = montar(itens, {
      campanha: () => convite,
      oferta: (_id, n) => (n === 1 ? ofertaConvite : { ...ofertaAgendada, inicio: '2026-11-06T03:00:00Z', fim: '2026-11-06T11:59:59-03:00' }),
    });
    await executar(LGH, deps, OPTS);
    expect(itens[0].mensagem).toBe('Agendada: 06/11 00:00–11:59');
  });

  it('releitura da oferta falha depois do POST → aplicado sem mensagem', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, { campanha: () => convite, oferta: () => ofertaConvite });
    vi.mocked(ml.lerOfertaNoItem).mockResolvedValueOnce(ofertaConvite).mockRejectedValueOnce(new Error('ML 500'));
    await executar(LGH, deps, OPTS);
    expect(ml.post).toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null });
  });

  it('visão por item falha antes do POST → erro sem POST', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, { campanha: () => convite });
    vi.mocked(ml.lerOfertaNoItem).mockRejectedValue(new Error('ML 500 em /seller-promotions/items'));
    await executar(LGH, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 500 em /seller-promotions/items' });
  });

  it('18,99 com confirmado_risco não posta', async () => {
    const itens = [item('MLB1', { preco: 18.99, confirmado_risco: true })];
    const { deps, ml } = montar(itens, { campanha: () => convite, oferta: () => ofertaConvite });
    await executar(LGH, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'bloqueado', mensagem: 'Abaixo de R$ 19 o comprador perde o frete grátis' });
  });

  it('estoque disponível 3 < mínimo 5 → bloqueado sem POST', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, { campanha: () => convite, oferta: () => ofertaConvite });
    vi.mocked(ml.lerRelacoes).mockResolvedValue({ catalog_listing: false, relacionados: [], disponivel: 3 });
    await executar(LGH, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'bloqueado', mensagem: 'Estoque disponível (3) menor que o mínimo da Relâmpago (5)' });
  });

  it('sair: DELETE com o OFFER da campanha', async () => {
    const itens = [item('MLB1', { preco: null })];
    const { deps, ml } = montar(itens, { campanha: () => conv({ status: 'pending', offer_id: 'OFFER-X-1' }) });
    await executar(LGH_SAIR, deps, OPTS);
    expect(ml.del).toHaveBeenCalledWith('MLB1', 'promotion_type=LIGHTNING&promotion_id=LGH-1&offer_id=OFFER-X-1&app_version=v2');
    expect(itens[0].status).toBe('saida_solicitada');
  });

  const vencido = () => item('MLB1', {
    status: 'saida_solicitada', saida_pedida_em: new Date(T0 - H).toISOString(), proxima_conferencia: new Date(T0).toISOString(),
  });
  it('conferir: null reagenda (não confirma saída sem prova)', async () => {
    const itens = [vencido()];
    const { deps } = montar(itens, { campanha: () => null });
    expect(await conferir(LGH_SAIR, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 1 });
    expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
  });

  it('conferir: candidate confirma e espelha saiu', async () => {
    const itens = [vencido()];
    const { deps } = montar(itens, { campanha: () => convite });
    expect(await conferir(LGH_SAIR, deps)).toEqual({ confirmados: 1, pendentes: 0 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', proxima_conferencia: null });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('LGH-1', 'LIGHTNING', 'MLB1', 'saiu');
  });
});

describe('executar — teto por contagem (ADR-0173 §4)', () => {
  it('para em maxItens e continua, com o relógio parado', async () => {
    const itens = Array.from({ length: 5 }, (_, i) => item(`MLB${i}`));
    const { deps } = montar(itens);
    const r = await executar(DEAL_ADERIR, deps, { limiteMs: 60_000, lote: 10, maxItens: 2 });
    expect(r).toEqual({ processados: 2, continuou: true });
    expect(deps.continuar).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});

// Emenda ADR-0174 (2026-11-03): alterar o deal_price de item DEAL participando (achados Codex P1 incluídos).
describe('executar — alterar_preco', () => {
  const ALTERAR: OperacaoRow = { ...DEAL_ADERIR, acao: 'alterar_preco' };
  const part = (preco: number, x: Partial<ItemNaCampanha> = {}) => conv({ status: 'started', preco, ...x });

  it('PUT aplicado: guarda o preço lido no ML ANTES de escrever (etapa durável), aplica e espelha', async () => {
    const itens = [item('MLB1', { preco: 43.9 })];
    const { deps, ml } = montar(itens, { campanha: () => part(49.9) });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 43.9 });
    const ordem = deps.gravarItem.mock.calls.map((c) => c[2]);
    expect(ordem[0]).toEqual({ etapa: 'escrita_pedida', preco_anterior: 49.9 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado', preco_anterior: 49.9 });
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB1', 43.9);
    expect(ml.post).not.toHaveBeenCalled();
  });

  it('retry não sobrescreve o preço anterior já gravado', async () => {
    const itens = [item('MLB1', { preco: 43.9, preco_anterior: 49.9 })];
    const { deps } = montar(itens, { campanha: () => part(45) });
    await executar(ALTERAR, deps, OPTS);
    expect(deps.gravarItem.mock.calls[0][2]).toEqual({ etapa: 'escrita_pedida' });
    expect(itens[0].preco_anterior).toBe(49.9);
  });

  it('crash depois do PUT (etapa gravada) e preço vivo = pedido → aplicado (escrita recuperada, revertível)', async () => {
    const itens = [item('MLB1', { preco: 43.9, etapa: 'escrita_pedida', preco_anterior: 49.9 })];
    const { deps, ml } = montar(itens, { campanha: () => part(43.9) });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'aplicado' });
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB1', 43.9);
  });

  it('sem etapa e preço vivo já = pedido → ja_estava (nada escrito)', async () => {
    const itens = [item('MLB1', { preco: 43.9 })];
    const { deps, ml } = montar(itens, { campanha: () => part(43.9) });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('ja_estava');
  });

  it('PUT incerto (erro) mas o ML já mostra o preço → aplicado; recusa 4xx do ML → erro', async () => {
    const a = [item('MLB1', { preco: 43.9 })];
    const ma = montar(a, { campanha: (_id, n) => (n === 1 ? part(49.9) : part(43.9)), put: () => { throw new Error('timeout'); } });
    await executar(ALTERAR, ma.deps, OPTS);
    expect(a[0].status).toBe('aplicado');
    const b = [item('MLB1', { preco: 43.9 })];
    const mb = montar(b, { campanha: () => part(49.9), put: () => { throw new Error('ML 400: deal_price fora da faixa'); } });
    await executar(ALTERAR, mb.deps, OPTS);
    expect(b[0]).toMatchObject({ status: 'erro', mensagem: 'ML 400: deal_price fora da faixa' });
  });

  it('achado Codex P1: PUT incerto (5xx/timeout) e releitura ainda com o preço antigo → mantém enviando (reconfere no retry)', async () => {
    const itens = [item('MLB1', { preco: 43.9 })];
    const { deps } = montar(itens, { campanha: () => part(49.9), put: () => { throw new Error('ML 503: indisponível'); } });
    await expect(executar(ALTERAR, deps, OPTS)).rejects.toThrow('ML 503');
    expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida', preco_anterior: 49.9 });
  });

  it('achado Codex P1: retomada com etapa gravada e falha na leitura → mantém enviando (não vira erro)', async () => {
    const itens = [item('MLB1', { preco: 43.9, etapa: 'escrita_pedida', preco_anterior: 49.9 })];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.lerNaCampanha).mockRejectedValueOnce(new Error('ML 500'));
    await expect(executar(ALTERAR, deps, OPTS)).rejects.toThrow('ML 500');
    expect(itens[0].status).toBe('enviando');
  });

  it('achado Codex P2: sem o preço vivo da oferta antes da 1ª escrita → erro, nada escrito', async () => {
    const itens = [item('MLB1', { preco: 43.9 })];
    const { deps, ml } = montar(itens, { campanha: () => part(49.9, { preco: null }) });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'O ML não informou o preço atual da oferta' });
  });

  it('PUT incerto e a releitura também falha → relança (item fica enviando para o retry)', async () => {
    const itens = [item('MLB1', { preco: 43.9 })];
    const { deps, ml } = montar(itens, { put: () => { throw new Error('timeout'); } });
    vi.mocked(ml.lerNaCampanha).mockResolvedValueOnce(part(49.9)).mockRejectedValueOnce(new Error('ML 500'));
    await expect(executar(ALTERAR, deps, OPTS)).rejects.toThrow('timeout');
    expect(itens[0].status).toBe('enviando');
  });

  it('trava financeira: resultado piorou desde o preview → mudou, sem PUT', async () => {
    const itens = [item('MLB1', { preco: 30, semaforo: 'verde' })];
    const { deps, ml } = montar(itens, { campanha: () => part(49.9), semaforo: 'vermelho' });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('mudou');
  });

  it('Reverter: preço vivo ≠ o que a origem deixou → mudou, sem PUT', async () => {
    const itens = [item('MLB1', { preco: 49.9, preco_esperado: 43.9 })];
    const { deps, ml } = montar(itens, { campanha: () => part(41) });
    await executar(ALTERAR, deps, OPTS);
    expect(ml.put).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O preço mudou desde a alteração original' });
  });
});

describe('executar — sair', () => {
  it('DELETE → saida_solicitada com saida_pedida_em, conferência em 5 min + agendarConferencia(300)', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens, { campanha: () => conv({ status: 'started' }) });
    await executar(SAIR, deps, OPTS);
    expect(ml.del).toHaveBeenCalledWith('MLB1', 'promotion_type=DEAL&promotion_id=P-1&app_version=v2');
    expect(ml.lerRelacoes).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({
      status: 'saida_solicitada', mensagem: 'Saída pedida ao ML; aguardando confirmação', conferencias: 0,
      saida_pedida_em: new Date(T0).toISOString(), proxima_conferencia: new Date(T0 + 300_000).toISOString(),
    });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('retry depois de crash pós-DELETE (SMART já fora) → ja_estava e apaga o espelho', async () => {
    const itens = [item('MLB1', { status: 'enviando' })];
    const { deps, ml } = montar(itens, { campanha: () => null });
    deps.itensPendentes.mockImplementation(async () => itens.filter((i) => i.status === 'enviando').map((i) => ({ ...i })));
    await executar(SAIR_SMART, deps, OPTS);
    expect(ml.del).not.toHaveBeenCalled();
    expect(itens[0].status).toBe('ja_estava');
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'SMART', 'MLB1', 'saiu');
  });

  it('falha ao gravar depois do DELETE → relança, item fica enviando', async () => {
    const itens = [item('MLB1')];
    const { deps } = montar(itens, { campanha: () => conv({ status: 'started' }) });
    deps.gravarItem.mockRejectedValueOnce(new Error('db caiu'));
    await expect(executar(SAIR, deps, OPTS)).rejects.toThrow('db caiu');
    expect(itens[0].status).toBe('enviando');
  });

  it('403 com saída já pedida → marca erro e agenda conferência (não conclui)', async () => {
    const itens = [item('MLB1'), item('MLB2')];
    const { deps, ml } = montar(itens, { campanha: () => conv({ status: 'started' }) });
    vi.mocked(ml.del).mockResolvedValueOnce().mockRejectedValue(new SemEscritaPromocoes('ML 403'));
    await executar(SAIR, deps, OPTS);
    expect(itens.map((i) => i.status)).toEqual(['saida_solicitada', 'erro']);
    expect(deps.agendarConferencia).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});

describe('conferir', () => {
  const vencido = (x: Partial<Linha> = {}) => item('MLB1', {
    status: 'saida_solicitada', saida_pedida_em: new Date(T0 - H).toISOString(),
    proxima_conferencia: new Date(T0).toISOString(), ...x,
  });

  it('fresco null → aplicado, espelha saída com o tipo e conclui', async () => {
    const itens = [vencido()];
    const { deps } = montar(itens, { campanha: () => null });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 1, pendentes: 0 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null, proxima_conferencia: null });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'SMART', 'MLB1', 'saiu');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('candidate também confirma a saída (DEAL volta a convidado)', async () => {
    const itens = [vencido()];
    const { deps } = montar(itens, { campanha: () => conv() });
    expect(await conferir(SAIR, deps)).toEqual({ confirmados: 1, pendentes: 0 });
    expect(deps.gravarItem).toHaveBeenCalledWith('op1', 'MLB1', { status: 'aplicado', mensagem: null, proxima_conferencia: null });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'saiu');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('ainda participando → conta a conferência e reagenda com o intervalo seguinte', async () => {
    const itens = [vencido({ conferencias: 1 })];
    const { deps } = montar(itens, { campanha: () => conv({ status: 'started' }) });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 2,
      proxima_conferencia: new Date(T0 + 1200_000).toISOString() });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(1200);
    expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('24 h de relógio desde a saída pedida → erro com a mensagem do Seller Center e conclui', async () => {
    const itens = [vencido({ conferencias: 3, saida_pedida_em: new Date(T0 - 25 * H).toISOString() })];
    const { deps } = montar(itens, { campanha: () => conv({ status: 'pending' }) });
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 0 });
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: SELLER_CENTER, proxima_conferencia: null });
    expect(deps.concluir).toHaveBeenCalledTimes(1);
    expect(deps.agendarConferencia).not.toHaveBeenCalled();
  });

  it('última conferência cai exatamente em 24 h', async () => {
    const itens = [vencido({ conferencias: 20, saida_pedida_em: new Date(T0 - 23.9 * H).toISOString() })];
    const { deps } = montar(itens, { campanha: () => conv({ status: 'started' }) });
    await conferir(SAIR_SMART, deps);
    expect(deps.agendarConferencia).toHaveBeenCalledWith(360);
  });

  it('item ainda não vencido não é lido; reagenda para quando vencer', async () => {
    const itens = [vencido({ proxima_conferencia: new Date(T0 + 90_000).toISOString() })];
    const { deps, ml } = montar(itens);
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(ml.lerNaCampanha).not.toHaveBeenCalled();
    expect(deps.agendarConferencia).toHaveBeenCalledWith(90);
  });

  it('erro na leitura conta como não confirmado (tenta de novo no próximo intervalo)', async () => {
    const itens = [vencido()];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.lerNaCampanha).mockRejectedValue(new Error('ML 500 em /seller-promotions/promotions'));
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0].conferencias).toBe(1);
  });

  it('401/403 → mensagem de reconexão, não gasta conferência, reagenda', async () => {
    const itens = [vencido({ conferencias: 2 })];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.lerNaCampanha).mockRejectedValue(new SemEscritaPromocoes('ML 401'));
    expect(await conferir(SAIR_SMART, deps)).toEqual({ confirmados: 0, pendentes: 1 });
    expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 2, mensagem: RECONECTAR,
      proxima_conferencia: new Date(T0 + 1200_000).toISOString() });
    expect(deps.agendarConferencia).toHaveBeenCalledWith(1200);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});

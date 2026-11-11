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
  ml_item_id: id, preco: 20, status: 'pendente', conferencias: 0, semaforo: 'verde', confirmado_risco: false,
  proxima_conferencia: null, saida_pedida_em: null, ...x,
});
const conv = (x: Partial<ItemNaCampanha> = {}): ItemNaCampanha =>
  ({ status: 'candidate', preco_min: 5, preco_max: 20, offer_id: null, estoque_min: null, ...x });

function montar(itens: Linha[], opts: {
  campanha?: (id: string, chamada: number) => ItemNaCampanha | null;
  post?: (id: string) => { offer_id: string | null; inicio?: string | null; fim?: string | null };
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
    post: vi.fn(async (id: string) => ({ offer_id: null, inicio: null, fim: null, ...opts.post?.(id) })),
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
    adesaoRecente: vi.fn(async (_p: string, _id: string) => false),
    adquirirEscrita: vi.fn(async (_o: string, id: string, c: Partial<Linha>) => {
      const it = itens.find((i) => i.ml_item_id === id)!;
      if (it.status !== 'enviando' || it.etapa) return false;
      Object.assign(it, c);
      return true;
    }),
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
const SIBLING = 'ML 400: Errors: OFFER_SIBLING_CREATION_IN_PROCESS - Creation of sibling offer in process';

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
    const itens = [item('MLB1', { preco: 19 })];
    const { deps, ml } = montar(itens, { campanha: (_id, n) => (n === 1 ? conv() : conv({ status: 'pending' })) });
    expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 1, continuou: false });
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 19 });
    expect(itens[0].status).toBe('aplicado');
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'pending');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
    expect(ml.lerOfertaNoItem).not.toHaveBeenCalled();
  });

  // Jaquetas da Zaven (03/11): aplicadas a R$ 49,90, Central seguia com R$ 63,72 e "0 participando" até o sync.
  it('espelha o preço aplicado e recalcula a contagem da campanha ao fim', async () => {
    const itens = [item('MLB1', { preco: 19 }), item('MLB2', { preco: 19 })];
    const { deps } = montar(itens, { campanha: (_id, n) => (n % 2 === 1 ? conv() : conv({ status: 'started' })) });
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB1', 19);
    expect(deps.espelharPreco).toHaveBeenCalledWith('P-1', 'MLB2', 19);
    expect(deps.recontarCentral).toHaveBeenCalledTimes(1);
    expect(deps.recontarCentral).toHaveBeenCalledWith('P-1');
  });

  it('achado Codex P1: SMART não espelha preço (POST só leva offer_id; o preço é do ML), mesmo com preço do preview', async () => {
    const op: OperacaoRow = { ...DEAL_ADERIR, promocao_tipo: 'SMART' };
    // Fluxo real: validarPedido preenche o preço do SMART com o preco_promo do preview.
    const itens = [item('MLB1', { preco: 19.5 })];
    const { deps } = montar(itens, { campanha: () => conv({ offer_id: 'C-1', preco: 30 }), post: () => ({ offer_id: 'O-1' }) });
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
      campanha: () => conv({ offer_id: 'CANDIDATE-MLB1-1', preco: 30 }), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
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
    expect(deps.semaforoAtual).toHaveBeenCalledWith('P-1', 'MLB1', 20);
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

  // AVIL 09/11 (Black Friday): o pai legado aderiu e o ML propagou às cópias de catálogo; o POST de cada cópia voltou
  // 400 SIBLING enquanto propagava, e 28 de 30 "erros" já estavam pending.
  it('400 SIBLING e o ML já mostra participando → ja_estava e espelha', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens, { campanha: (_id, n) => (n === 1 ? conv() : conv({ status: 'pending' })) });
    vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'ja_estava', mensagem: 'Inscrito pelo ML junto com o anúncio principal' });
    expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-1', 'DEAL', 'MLB1', 'pending');
  });

  it('400 SIBLING ainda candidate → bloqueado (fora do "Tentar novamente"), não erro', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens);
    vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0].status).toBe('bloqueado');
    expect(itens[0].mensagem).toMatch(/anúncio principal/);
    expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
  });

  it('400 SIBLING e a releitura falha → erro retentável, não bloqueado', async () => {
    const itens = [item('MLB1')];
    const { deps, ml } = montar(itens, { campanha: (_id, n) => { if (n > 1) throw new Error('ML 500: Oops!'); return conv(); } });
    vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
    await executar(DEAL_ADERIR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 500: Oops!' });
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

  // Emenda 2026-11-08 (2): um horário participando e outro convidado.
  const participandoComConvite = conv({ status: 'pending', offer_id: 'OFFER-X-1', convite });
  it('400 SIBLING participando com convite aberto → bloqueado, não ja_estava (o horário pedido não entrou)', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, { campanha: () => participandoComConvite, oferta: () => ofertaConvite });
    vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
    await executar(LGH, deps, OPTS);
    expect(ml.post).toHaveBeenCalledTimes(1);
    expect(itens[0].status).toBe('bloqueado');
    expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
  });

  it('participando em um horário com convite aberto: grava o CANDIDATE antes e posta pelo convite', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, {
      campanha: (_id, n) => (n === 1 ? participandoComConvite : conv({ status: 'pending', offer_id: 'OFFER-X-2' })),
      oferta: () => ofertaConvite, post: () => ({ offer_id: 'OFFER-X-2' }),
    });
    await executar(LGH, deps, OPTS);
    const gravouCandidato = deps.gravarItem.mock.invocationCallOrder[deps.gravarItem.mock.calls.findIndex((c) => c[2].offer_id === 'CANDIDATE-MLB1-5')];
    expect(gravouCandidato).toBeLessThan(vi.mocked(ml.post).mock.invocationCallOrder[0]);
    expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'LGH-1', promotion_type: 'LIGHTNING', deal_price: 24.65, stock: 5 });
    expect(itens[0]).toMatchObject({ status: 'aplicado', offer_id: 'OFFER-X-2' });
  });

  it('retomada com outro convite aberto (CANDIDATE diferente do gravado) → Já estava, sem POST', async () => {
    const itens = [item('MLB1', { preco: 24.65, offer_id: 'CANDIDATE-MLB1-ANTIGO' })];
    const { deps, ml } = montar(itens, { campanha: () => participandoComConvite, oferta: () => ofertaConvite });
    await executar(LGH, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'ja_estava' });
  });

  it('retomada com o mesmo convite gravado → posta', async () => {
    const itens = [item('MLB1', { preco: 24.65, offer_id: 'CANDIDATE-MLB1-5' })];
    const { deps, ml } = montar(itens, { campanha: () => participandoComConvite, oferta: () => ofertaConvite, post: () => ({ offer_id: 'OFFER-X-2' }) });
    await executar(LGH, deps, OPTS);
    expect(ml.post).toHaveBeenCalledTimes(1);
  });

  it('participando sem convite → Já estava', async () => {
    const itens = [item('MLB1', { preco: 24.65 })];
    const { deps, ml } = montar(itens, { campanha: () => conv({ status: 'pending', offer_id: 'OFFER-X-1' }) });
    await executar(LGH, deps, OPTS);
    expect(ml.post).not.toHaveBeenCalled();
    expect(itens[0]).toMatchObject({ status: 'ja_estava' });
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

// Payloads do spike 03/11 (plano 2026-11-03-promo-smart-lightning-price-matching).
describe('ofertas de preço fixo', () => {
  const ERRO_ADESAO = 'Não foi possível confirmar a adesão no ML. Confira no Seller Center.';
  // Status da campanha de propósito oposto ao do item: o espelho não pode usar o da campanha.
  const SL: OperacaoRow = { ...DEAL_ADERIR, promocao_id: 'P-MLB18055120', promocao_tipo: 'SMART_LIGHTNING', promocao_status: 'started' };
  const PM: OperacaoRow = { ...DEAL_ADERIR, promocao_id: 'P-MLB18099366', promocao_tipo: 'PRICE_MATCHING', promocao_status: 'pending' };
  const SAIR_PM: OperacaoRow = { ...PM, acao: 'sair' };
  const SAIR_SL: OperacaoRow = { ...SL, acao: 'sair' };
  const convSL = (x: Partial<ItemNaCampanha> = {}) => conv({ preco_min: null, preco_max: null, offer_id: 'CANDIDATE-MLB1-1', estoque_min: 5, preco: 64, ...x });
  const convPM = (x: Partial<ItemNaCampanha> = {}) => conv({ preco_min: null, preco_max: null, offer_id: 'CANDIDATE-MLB1-2', preco: 69.98, ...x });
  const part = (status: string, preco = 69.98) => conv({ status, preco_min: null, preco_max: null, offer_id: 'OFFER-MLB1-9', preco });
  const etapa = { etapa: 'escrita_pedida' as const };
  const ordem = (f: unknown, n = 0) => vi.mocked(f as () => void).mock.invocationCallOrder[n];
  const RETRY_SEG = [12, 148, 1800]; // intervalos do QStash entre as 4 entregas de uma mensagem
  /** Relógio + claim de 2 min + fila do QStash: 500 reentrega a mesma mensagem (até 4 entregas), `continuar` publica outra. */
  function comFila(op: OperacaoRow, itens: Linha[], opts: Parameters<typeof montar>[1] = {}) {
    const m = montar(itens, opts);
    const { deps, avancar } = m;
    const tocado = new Map<string, number>();
    const acha = (id: string) => itens.find((i) => i.ml_item_id === id)!;
    const toca = (id: string) => tocado.set(id, deps.agora());
    const livre = (i: Linha) => i.status === 'pendente'
      || (i.status === 'enviando' && deps.agora() - (tocado.get(i.ml_item_id) ?? 0) > 120_000);
    deps.reivindicar.mockImplementation(async (_o, id) => {
      if (!livre(acha(id))) return false;
      acha(id).status = 'enviando';
      toca(id);
      return true;
    });
    deps.itensPendentes.mockImplementation(async (_o, limite) => itens.filter(livre).slice(0, limite).map((i) => ({ ...i })));
    deps.gravarItem.mockImplementation(async (_o, id, c) => { Object.assign(acha(id), c); toca(id); });
    deps.adquirirEscrita.mockImplementation(async (_o, id, c) => {
      if (acha(id).status !== 'enviando' || acha(id).etapa) return false;
      Object.assign(acha(id), c);
      toca(id);
      return true;
    });
    const fila = [{ em: deps.agora(), entrega: 1 }];
    deps.continuar.mockImplementation(async (seg = 0) => { fila.push({ em: deps.agora() + seg * 1000, entrega: 1 }); });
    const rodar = async () => {
      const respostas: number[] = [];
      let mortas = 0;
      while (fila.length) {
        expect(respostas.length).toBeLessThan(40);
        fila.sort((a, b) => a.em - b.em);
        const msg = fila.shift()!;
        avancar(Math.max(0, msg.em - deps.agora()));
        try {
          await executar(op, deps, OPTS);
          respostas.push(200);
        } catch {
          respostas.push(500);
          if (msg.entrega < 4) fila.push({ em: deps.agora() + RETRY_SEG[msg.entrega - 1] * 1000, entrega: msg.entrega + 1 });
          else mortas++;
        }
      }
      return { respostas, mortas };
    };
    return { ...m, rodar, tocado };
  }

  describe('aderir', () => {
    it('SMART_LIGHTNING: etapa antes do POST, stock.min, janela do POST, espelho pending com a releitura em candidate', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL(),
        post: () => ({ offer_id: 'OFFER-MLB1-9', inicio: '2026-11-04T12:00:00', fim: '2026-11-04T23:59:59' }) });
      await executar(SL, deps, OPTS);
      expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-MLB18055120', promotion_type: 'SMART_LIGHTNING', offer_id: 'CANDIDATE-MLB1-1', stock: 5 });
      expect(deps.adquirirEscrita).toHaveBeenCalledWith('op1', 'MLB1', { etapa: 'escrita_pedida' });
      expect(ordem(deps.adquirirEscrita)).toBeLessThan(ordem(ml.post));
      expect(itens[0]).toMatchObject({ status: 'aplicado', offer_id: 'OFFER-MLB1-9', etapa: 'ml_confirmado', mensagem: 'Agendada: 04/11 12:00–23:59' });
      expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18055120', 'SMART_LIGHTNING', 'MLB1', 'pending');
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18055120', 'MLB1', 64);
      expect(ml.lerOfertaNoItem).not.toHaveBeenCalled();
    });

    it('PRICE_MATCHING: POST sem stock, sem mensagem de janela, espelho started com a releitura em candidate', async () => {
      const itens = [item('MLB1', { preco: 69.98 })];
      const { deps, ml } = montar(itens, { campanha: () => convPM(), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
      await executar(PM, deps, OPTS);
      expect(ml.post).toHaveBeenCalledWith('MLB1', { promotion_id: 'P-MLB18099366', promotion_type: 'PRICE_MATCHING', offer_id: 'CANDIDATE-MLB1-2' });
      expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null });
      expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18099366', 'PRICE_MATCHING', 'MLB1', 'started');
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18099366', 'MLB1', 69.98);
    });

    it('400 SIBLING → ja_estava com a etapa limpa (retomada não vira aplicado)', async () => {
      const itens = [item('MLB1', { preco: 69.98 })];
      const { deps, ml } = montar(itens, { campanha: (_id, n) => (n === 1 ? convPM() : part('started')) });
      vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
      await executar(PM, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'ja_estava', etapa: null });
    });

    it('400 SIBLING ainda candidate → bloqueado mantendo a etapa (trava de adesaoRecente)', async () => {
      const itens = [item('MLB1', { preco: 69.98 })];
      const { deps, ml } = montar(itens, { campanha: () => convPM() });
      vi.mocked(ml.post).mockRejectedValueOnce(new Error(SIBLING));
      await executar(PM, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'bloqueado', etapa: 'escrita_pedida' });
    });

    it('releitura já participando vale mais que o padrão do tipo', async () => {
      const { deps } = montar([item('MLB1', { preco: 64 })], { campanha: (_id, n) => (n === 1 ? convSL() : part('started', 64)) });
      await executar(SL, deps, OPTS);
      expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18055120', 'SMART_LIGHTNING', 'MLB1', 'started');
    });

    it('Review Focus 1: oferta mudou de preço → mudou, sem etapa e sem POST', async () => {
      const itens = [item('MLB1', { preco: 69.98 })];
      const { deps, ml } = montar(itens, { campanha: () => convPM({ preco: 59.9 }) });
      await executar(PM, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O preço da oferta mudou: agora 59,90' });
      expect(itens[0].etapa).toBeUndefined();
      expect(ml.post).not.toHaveBeenCalled();
      // Sem isto o preview seguia com o preço velho até o sync do dia seguinte e toda nova tentativa dava "mudou".
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18099366', 'MLB1', 59.9, ['candidate']);
    });

    it('Review Focus 2: preço fresco < 19 com risco confirmado → bloqueado, sem POST', async () => {
      const itens = [item('MLB1', { preco: 18.5, confirmado_risco: true })];
      const { deps, ml } = montar(itens, { campanha: () => convPM({ preco: 18.5 }) });
      await executar(PM, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'bloqueado', mensagem: 'Abaixo de R$ 19 o comprador perde o frete grátis' });
      expect(ml.post).not.toHaveBeenCalled();
    });

    it('SMART_LIGHTNING sem stock.min → erro, sem POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL({ estoque_min: null }) });
      await executar(SL, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'O ML não informou o estoque mínimo da oferta' });
      expect(ml.post).not.toHaveBeenCalled();
    });

    it('semáforo piorou sem risco confirmado → mudou, sem etapa e sem POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL(), semaforo: 'vermelho' });
      await executar(SL, deps, OPTS);
      expect(itens[0].status).toBe('mudou');
      expect(itens[0].etapa).toBeUndefined();
      expect(ml.post).not.toHaveBeenCalled();
    });

    it('falha ao gravar a etapa → erro sem POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      deps.adquirirEscrita.mockRejectedValueOnce(new Error('db'));
      await executar(SL, deps, OPTS);
      expect(ml.post).not.toHaveBeenCalled();
      expect(itens[0].status).toBe('erro');
    });

    it('adesão recente de outra operação → mudou, sem etapa e sem POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      deps.adesaoRecente.mockResolvedValue(true);
      await executar(SL, deps, OPTS);
      expect(deps.adesaoRecente).toHaveBeenCalledWith('P-MLB18055120', 'MLB1');
      expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'Adesão recente ainda propagando no ML. Aguarde alguns minutos e tente de novo.' });
      expect(itens[0].etapa).toBeUndefined();
      expect(ml.post).not.toHaveBeenCalled();
    });

    it('segunda operação com o espelho da primeira falho: sem POST na janela de 30 min; depois dela posta', async () => {
      const a = [item('MLB1', { preco: 64 })];
      const op1 = comFila(SL, a, { campanha: () => convSL(), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
      op1.deps.espelharStatusCentral.mockRejectedValue(new Error('db'));
      await op1.rodar();
      expect(a[0].status).toBe('aplicado');

      const segunda = (esperaMs: number) => {
        const b = [item('MLB1', { preco: 64 })];
        const op = comFila({ ...SL, id: 'op2' }, b, { campanha: () => convSL() });
        op.avancar(esperaMs);
        // Mesmo predicado de deps.adesaoRecente: `aplicado` há menos de 30 min.
        op.deps.adesaoRecente.mockImplementation(async () => op.deps.agora() - op1.tocado.get('MLB1')! < 1_800_000);
        return { b, op };
      };
      const cedo = segunda(60_000);
      await cedo.op.rodar();
      expect(cedo.b[0].status).toBe('mudou');
      expect(cedo.op.ml.post).not.toHaveBeenCalled();

      const tarde = segunda(31 * 60_000);
      await tarde.op.rodar();
      expect(tarde.b[0].status).toBe('aplicado');
      expect(tarde.op.ml.post).toHaveBeenCalledTimes(1);
    });

    it('dois workers: claim vencido antes da etapa → um só POST, e quem perdeu não mexe no item', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, avancar, rodar } = comFila(SL, itens, { campanha: () => convSL(), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
      deps.semaforoAtual.mockImplementationOnce(async () => {
        avancar(180_000); // worker A parado: o claim vence e o worker B faz o item inteiro
        await executar(SL, deps, OPTS);
        return 'verde';
      });
      await rodar();
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(itens[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado', offer_id: 'OFFER-MLB1-9' });
    });

    it('contraexemplo: B conclui aplicado, A volta do semáforo com piora → linha segue aplicado e a trava vale', async () => {
      const a = [item('MLB1', { preco: 64 })];
      const op1 = comFila(SL, a, { campanha: () => convSL(), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
      op1.deps.semaforoAtual.mockImplementationOnce(async () => {
        op1.avancar(180_000);
        await executar(SL, op1.deps, OPTS);
        return 'vermelho';
      });
      await op1.rodar();
      expect(op1.ml.post).toHaveBeenCalledTimes(1);
      expect(a[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado', offer_id: 'OFFER-MLB1-9', mensagem: null });

      const b = [item('MLB1', { preco: 64 })];
      const op2 = comFila({ ...SL, id: 'op2' }, b, { campanha: () => convSL() });
      op2.avancar(240_000);
      // Mesmo filtro de deps.adesaoRecente sobre a linha da 1ª operação.
      op2.deps.adesaoRecente.mockImplementation(async () => ['aplicado', 'ja_estava'].includes(a[0].status) || a[0].etapa === 'escrita_pedida');
      await op2.rodar();
      expect(b[0].status).toBe('mudou');
      expect(op2.ml.post).not.toHaveBeenCalled();
    });

    it('late worker: Central sumiu no semáforo ou adesaoRecente não trocam o resultado', async () => {
      const a = [item('MLB1', { preco: 64 })];
      const x = comFila(SL, a, { campanha: () => convSL() });
      x.deps.semaforoAtual.mockImplementationOnce(async () => {
        x.avancar(180_000);
        await executar(SL, x.deps, OPTS);
        return null;
      });
      await x.rodar();
      expect(a[0].status).toBe('aplicado');

      const b = [item('MLB1', { preco: 64 })];
      const y = comFila(SL, b, { campanha: () => convSL() });
      y.deps.adesaoRecente.mockImplementationOnce(async () => {
        y.avancar(180_000);
        await executar(SL, y.deps, OPTS);
        return true;
      });
      await y.rodar();
      expect(b[0].status).toBe('aplicado');
    });

    it.each([['mudou', () => convSL({ preco: 50 })], ['ja_estava', () => part('pending', 64)]])('late worker: leitura velha que daria %s não troca o resultado', async (_n, leitura) => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: () => {
        Object.assign(itens[0], { status: 'aplicado', etapa: 'ml_confirmado' }); // B conclui durante a leitura de A
        return leitura();
      } });
      await rodar();
      expect(itens[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado' });
      expect(ml.post).not.toHaveBeenCalled();
      expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
    });

    it('late worker: exceção antes da escrita não vira erro por cima do aplicado', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, avancar, rodar } = comFila(SL, itens, { campanha: () => convSL() });
      vi.mocked(ml.lerRelacoes).mockImplementationOnce(async () => {
        avancar(180_000);
        await executar(SL, deps, OPTS);
        throw new Error('ML 500 em /items');
      });
      await rodar();
      expect(itens[0].status).toBe('aplicado');
      expect(ml.post).toHaveBeenCalledTimes(1);
    });

    it('exceção antes da escrita sem concorrência → erro com a mensagem; 403 → RECONECTAR e encerra o resto', async () => {
      const a = [item('MLB1', { preco: 64 })];
      const x = montar(a, { campanha: () => convSL() });
      vi.mocked(x.ml.lerRelacoes).mockRejectedValue(new Error('ML 500 em /items'));
      await executar(SL, x.deps, OPTS);
      expect(a[0]).toMatchObject({ status: 'erro', mensagem: 'ML 500 em /items' });

      const b = [item('MLB1', { preco: 64 }), item('MLB2', { preco: 64 })];
      const y = montar(b, { campanha: () => convSL() });
      vi.mocked(y.ml.lerRelacoes).mockRejectedValue(new SemEscritaPromocoes('ML 403'));
      await executar(SL, y.deps, OPTS);
      expect(b.map((i) => [i.status, i.mensagem])).toEqual([['erro', RECONECTAR], ['erro', RECONECTAR]]);
      expect(y.ml.post).not.toHaveBeenCalled();
    });

    it('etapa de outro worker gravada e ainda enviando: quem perdeu não posta e a operação continua', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      deps.adquirirEscrita.mockResolvedValueOnce(false);
      expect(await executar(SL, deps, OPTS)).toEqual({ processados: 1, continuou: true });
      expect(ml.post).not.toHaveBeenCalled();
      expect(deps.continuar).toHaveBeenCalledWith(150);
    });

    it('4xx claro do ML → erro com a mensagem do ML', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      vi.mocked(ml.post).mockRejectedValue(new Error('ML 400: oferta inválida'));
      expect(await executar(SL, deps, OPTS)).toEqual({ processados: 1, continuou: false });
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 400: oferta inválida', etapa: null });
    });

    it('403 → RECONECTAR (fatal), como nos outros tipos', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      vi.mocked(ml.post).mockRejectedValue(new SemEscritaPromocoes('ML 403'));
      await executar(SL, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: RECONECTAR, etapa: null });
    });

    it.each(['timeout', 'ML 500: x', 'ML 429: x'])('resultado incerto (%s): sem 500, continuação publicada, um só POST, etapa mantida', async (msg) => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: () => convSL() });
      vi.mocked(ml.post).mockRejectedValue(new Error(msg));
      const r = await rodar();
      expect(r).toEqual({ respostas: [200, 200, 200, 200, 200, 200], mortas: 0 });
      expect(deps.continuar).toHaveBeenCalledWith(150);
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(itens[0].etapa).toBe('escrita_pedida');
    });

    it('fila: 4 itens com timeout na mesma mensagem não a matam; nenhum POST repetido', async () => {
      const itens = ['MLB1', 'MLB2', 'MLB3', 'MLB4'].map((id) => item(id, { preco: 64 }));
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: () => convSL() });
      vi.mocked(ml.post).mockRejectedValue(new Error('timeout'));
      const r = await rodar();
      expect(r.mortas).toBe(0);
      expect(r.respostas).not.toContain(500);
      expect(deps.continuar).toHaveBeenNthCalledWith(1, 150);
      expect(ml.post).toHaveBeenCalledTimes(4);
      expect(new Set(vi.mocked(ml.post).mock.calls.map((c) => c[0])).size).toBe(4);
      expect(itens.every((i) => i.status === 'erro' && i.etapa === 'escrita_pedida')).toBe(true);
      expect(deps.concluir).toHaveBeenCalledTimes(1);
    });

    it('crash ao gravar pós-POST: 500; a reentrega continua e confirma sem novo POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: (_id, n) => (n === 1 ? convSL() : part('pending', 64)), post: () => ({ offer_id: 'OFFER-MLB1-9' }) });
      deps.gravarItem.mockRejectedValueOnce(new Error('db'));
      expect((await rodar()).respostas).toEqual([500, 200, 200]);
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(itens[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado', offer_id: 'OFFER-MLB1-9' });
    });

    it('DEAL não grava etapa e falha incerta segue virando erro', async () => {
      const itens = [item('MLB1', { preco: 19 })];
      const { deps, ml } = montar(itens);
      vi.mocked(ml.post).mockRejectedValue(new Error('timeout'));
      expect(await executar(DEAL_ADERIR, deps, OPTS)).toEqual({ processados: 1, continuou: false });
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'timeout' });
      expect(itens[0].etapa).toBeUndefined();
      expect(deps.adesaoRecente).not.toHaveBeenCalled();
      expect(deps.adquirirEscrita).not.toHaveBeenCalled();
    });
  });

  describe('retomada de aderir', () => {
    it('participando → aplicado com o offer_id lido + espelhos, sem POST', async () => {
      const itens = [item('MLB1', { preco: 64, ...etapa })];
      const { deps, ml } = montar(itens, { campanha: () => part('pending', 64) });
      expect(await executar(SL, deps, OPTS)).toEqual({ processados: 1, continuou: false });
      expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null, offer_id: 'OFFER-MLB1-9', etapa: 'ml_confirmado' });
      expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18055120', 'SMART_LIGHTNING', 'MLB1', 'pending');
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18055120', 'MLB1', 64);
      expect(ml.post).not.toHaveBeenCalled();
    });

    it.each([['candidate', () => convSL()], ['fora da campanha', () => null]])('%s: conta a tentativa e continua com 200, sem POST', async (_n, campanha) => {
      const itens = [item('MLB1', { preco: 64, ...etapa })];
      const { deps, ml } = montar(itens, { campanha });
      expect(await executar(SL, deps, OPTS)).toEqual({ processados: 1, continuou: true });
      expect(itens[0]).toMatchObject({ status: 'enviando', etapa: 'escrita_pedida', conferencias: 1 });
      expect(deps.continuar).toHaveBeenCalledWith(150);
      expect(ml.post).not.toHaveBeenCalled();
      expect(ml.lerRelacoes).not.toHaveBeenCalled();
      expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
    });

    it('não espera por outro item: o laço segue para os próximos', async () => {
      const itens = [item('MLB1', { preco: 64, ...etapa }), item('MLB2', { preco: 64 })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      await executar(SL, deps, OPTS);
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(itens[1].status).toBe('aplicado');
    });

    it('fila: ML sempre candidate → continuações com 200 e erro na 5ª tentativa', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: () => convSL() });
      vi.mocked(ml.post).mockRejectedValue(new Error('timeout'));
      expect(await rodar()).toEqual({ respostas: [200, 200, 200, 200, 200, 200], mortas: 0 });
      expect(deps.continuar.mock.calls).toEqual([[150], [150], [150], [150], [150]]);
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: ERRO_ADESAO, conferencias: 5, etapa: 'escrita_pedida' });
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(deps.concluir).toHaveBeenCalledTimes(1);
    });

    it('fila: confirma depois do atraso do ML, sem novo POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { ml, rodar } = comFila(SL, itens, { campanha: (_id, n) => (n <= 2 ? convSL() : part('pending', 64)) });
      vi.mocked(ml.post).mockRejectedValue(new Error('timeout'));
      expect(await rodar()).toEqual({ respostas: [200, 200, 200], mortas: 0 });
      expect(itens[0]).toMatchObject({ status: 'aplicado', etapa: 'ml_confirmado', conferencias: 1 });
      expect(ml.post).toHaveBeenCalledTimes(1);
    });

    it('fila: leitura sempre falhando gasta as mesmas 5 tentativas, sem 500 e sem POST', async () => {
      const itens = [item('MLB1', { preco: 64 })];
      const { deps, ml, rodar } = comFila(SL, itens, { campanha: (_id, n) => {
        if (n > 1) throw new Error('ML 500 em /seller-promotions/promotions');
        return convSL();
      } });
      vi.mocked(ml.post).mockRejectedValue(new Error('timeout'));
      expect(await rodar()).toEqual({ respostas: [200, 200, 200, 200, 200, 200], mortas: 0 });
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: ERRO_ADESAO, conferencias: 5, etapa: 'escrita_pedida' });
      expect(ml.post).toHaveBeenCalledTimes(1);
      expect(deps.concluir).toHaveBeenCalledTimes(1);
    });

    it('fila: lote em retomada não esgota as entregas da mensagem', async () => {
      const itens = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5', 'MLB6'].map((id) => item(id, { preco: 64, ...etapa }));
      const { ml, rodar } = comFila(SL, itens, { campanha: () => convSL() });
      const r = await rodar();
      expect(r.mortas).toBe(0);
      expect(r.respostas).not.toContain(500);
      expect(itens.every((i) => i.status === 'erro' && i.etapa === 'escrita_pedida')).toBe(true);
      expect(ml.post).not.toHaveBeenCalled();
    });

    it('falha ao gravar a tentativa → 500 e fica enviando; 401/403 na leitura segue fatal', async () => {
      const a = [item('MLB1', { preco: 64, ...etapa })];
      const x = montar(a, { campanha: () => convSL() });
      x.deps.gravarItem.mockRejectedValueOnce(new Error('db'));
      await expect(executar(SL, x.deps, OPTS)).rejects.toThrow('db');
      expect(a[0]).toMatchObject({ status: 'enviando', conferencias: 0 });

      const b = [item('MLB1', { preco: 64, ...etapa })];
      const y = montar(b);
      vi.mocked(y.ml.lerNaCampanha).mockRejectedValue(new SemEscritaPromocoes('ML 403'));
      await executar(SL, y.deps, OPTS);
      expect(b[0]).toMatchObject({ status: 'erro', mensagem: RECONECTAR, etapa: 'escrita_pedida' });
      expect(y.ml.post).not.toHaveBeenCalled();
    });

    it('etapa gravada em DEAL não muda o caminho (a retomada é só dos tipos novos)', async () => {
      const itens = [item('MLB1', { preco: 19, ...etapa })];
      const { deps, ml } = montar(itens);
      await executar(DEAL_ADERIR, deps, OPTS);
      expect(ml.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('sair', () => {
    it('grava etapa + OFFER observado antes do DELETE e entra na escada', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml } = montar(itens, { campanha: () => part('started') });
      await executar(SAIR_PM, deps, OPTS);
      expect(deps.adquirirEscrita).toHaveBeenCalledWith('op1', 'MLB1', { etapa: 'escrita_pedida', offer_id: 'OFFER-MLB1-9' });
      expect(ordem(deps.adquirirEscrita)).toBeLessThan(ordem(ml.del));
      expect(deps.adesaoRecente).not.toHaveBeenCalled();
      expect(ml.del).toHaveBeenCalledWith('MLB1', 'promotion_type=PRICE_MATCHING&promotion_id=P-MLB18099366&offer_id=OFFER-MLB1-9&app_version=v2');
      expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 0, proxima_conferencia: new Date(T0 + 300_000).toISOString() });
      expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
    });

    it('Review Focus 3: candidate sem evidência → mudou; sem DELETE, sem espelho, nunca ja_estava', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml } = montar(itens, { campanha: () => convSL() });
      await executar(SAIR_SL, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'mudou', mensagem: 'O ML ainda mostra este anúncio como convidado. Se aderiu agora há pouco, aguarde 2 minutos e tente de novo.' });
      expect(ml.del).not.toHaveBeenCalled();
      expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
      expect(deps.espelharPreco).not.toHaveBeenCalled();
    });

    it('4xx claro → erro com a mensagem do ML', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml } = montar(itens, { campanha: () => part('started') });
      vi.mocked(ml.del).mockRejectedValue(new Error('ML 400: não pode'));
      await executar(SAIR_PM, deps, OPTS);
      expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML 400: não pode' });
    });

    it('fila: timeout no DELETE, reentrega com candidate → aplicado + saiu, sem novo DELETE', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml, rodar } = comFila(SAIR_PM, itens, { campanha: (_id, n) => (n === 1 ? part('started') : convPM({ preco: 72 })) });
      vi.mocked(ml.del).mockRejectedValue(new Error('timeout'));
      expect(await rodar()).toEqual({ respostas: [200, 200], mortas: 0 });
      expect(ml.del).toHaveBeenCalledTimes(1);
      expect(itens[0]).toMatchObject({ status: 'aplicado', mensagem: null, etapa: 'ml_confirmado' });
      expect(deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18099366', 'PRICE_MATCHING', 'MLB1', 'saiu');
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18099366', 'MLB1', 72);
      expect(ordem(deps.espelharPreco)).toBeLessThan(ordem(deps.espelharStatusCentral));
    });

    it('fila: timeout no DELETE e leitura sempre falhando → escada de 24 h, sem novo DELETE', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml, rodar } = comFila(SAIR_PM, itens, { campanha: (_id, n) => {
        if (n > 1) throw new Error('ML 500 em /seller-promotions/promotions');
        return part('started');
      } });
      vi.mocked(ml.del).mockRejectedValue(new Error('timeout'));
      expect(await rodar()).toEqual({ respostas: [200, 200], mortas: 0 });
      expect(ml.del).toHaveBeenCalledTimes(1);
      expect(itens[0].status).toBe('saida_solicitada');
      expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
    });

    it.each([['participando', () => part('started')], ['fora da campanha', () => null]])('retomada %s → saida_solicitada com a escada, sem DELETE', async (_n, campanha) => {
      const itens = [item('MLB1', { preco: null, ...etapa })];
      const { deps, ml } = montar(itens, { campanha });
      await executar(SAIR_PM, deps, OPTS);
      expect(ml.del).not.toHaveBeenCalled();
      expect(itens[0]).toMatchObject({ status: 'saida_solicitada', conferencias: 0, saida_pedida_em: new Date(T0).toISOString(), mensagem: 'Saída pedida ao ML; aguardando confirmação' });
      expect(deps.agendarConferencia).toHaveBeenCalledWith(300);
      expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
    });

    it('fila: crash ao gravar pós-DELETE não repete o DELETE', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml, rodar } = comFila(SAIR_PM, itens, { campanha: () => part('started') });
      deps.gravarItem.mockRejectedValueOnce(new Error('db'));
      expect((await rodar()).respostas).toEqual([500, 200, 200]);
      expect(ml.del).toHaveBeenCalledTimes(1);
      expect(itens[0].status).toBe('saida_solicitada');
    });

    it('dois workers: claim vencido antes da etapa → um só DELETE', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps, ml, avancar, rodar } = comFila(SAIR_PM, itens, { campanha: () => part('started') });
      const adquirir = deps.adquirirEscrita.getMockImplementation()!;
      deps.adquirirEscrita.mockImplementationOnce(async (...a) => {
        avancar(180_000); // worker A parado: o claim vence e o worker B faz o item inteiro
        await executar(SAIR_PM, deps, OPTS);
        return adquirir(...a);
      });
      await rodar();
      expect(ml.del).toHaveBeenCalledTimes(1);
      expect(itens[0].status).toBe('saida_solicitada');
    });

    it('DEAL/SMART seguem sem etapa antes do DELETE', async () => {
      const itens = [item('MLB1', { preco: null })];
      const { deps } = montar(itens, { campanha: () => conv({ status: 'started', offer_id: 'OFFER-1' }) });
      await executar(SAIR_SMART, deps, OPTS);
      expect(itens[0].etapa).toBeUndefined();
      expect(itens[0].status).toBe('saida_solicitada');
      expect(deps.adquirirEscrita).not.toHaveBeenCalled();
    });
  });

  describe('conferir', () => {
    const vencido = () => item('MLB1', { preco: null, status: 'saida_solicitada', saida_pedida_em: new Date(T0 - H).toISOString(), proxima_conferencia: new Date(T0).toISOString() });

    it('candidate confirma; preço do convite espelhado ANTES do status (espelharPreco só grava em participando)', async () => {
      const itens = [vencido()];
      const { deps } = montar(itens, { campanha: () => convPM({ preco: 72 }) });
      expect(await conferir(SAIR_PM, deps)).toEqual({ confirmados: 1, pendentes: 0 });
      expect(itens[0].status).toBe('aplicado');
      expect(deps.espelharPreco).toHaveBeenCalledWith('P-MLB18099366', 'MLB1', 72);
      expect(ordem(deps.espelharPreco)).toBeLessThan(ordem(deps.espelharStatusCentral));
    });

    it('sem preço no convite → não espelha preço; falha no espelho de preço não trava a saída', async () => {
      const a = montar([vencido()], { campanha: () => convSL({ preco: null }) });
      await conferir(SAIR_SL, a.deps);
      expect(a.deps.espelharPreco).not.toHaveBeenCalled();
      expect(a.deps.espelharStatusCentral).toHaveBeenCalledWith('P-MLB18055120', 'SMART_LIGHTNING', 'MLB1', 'saiu');

      const b = montar([vencido()], { campanha: () => convSL() });
      b.deps.espelharPreco.mockRejectedValue(new Error('db'));
      expect(await conferir(SAIR_SL, b.deps)).toEqual({ confirmados: 1, pendentes: 0 });
      expect(b.deps.espelharStatusCentral).toHaveBeenCalled();
    });

    it('null não confirma (regra da Relâmpago): reagenda', async () => {
      const itens = [vencido()];
      const { deps } = montar(itens, { campanha: () => null });
      expect(await conferir(SAIR_SL, deps)).toEqual({ confirmados: 0, pendentes: 1 });
      expect(itens[0].status).toBe('saida_solicitada');
      expect(deps.espelharStatusCentral).not.toHaveBeenCalled();
    });

    it('DEAL não espelha preço ao confirmar a saída', async () => {
      const itens = [vencido()];
      const { deps } = montar(itens, { campanha: () => conv({ preco: 50 }) });
      await conferir(SAIR, deps);
      expect(deps.espelharPreco).not.toHaveBeenCalled();
    });
  });
});


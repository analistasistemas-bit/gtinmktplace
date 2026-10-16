import { describe, it, expect, vi } from 'vitest';
import { intervaloDoMes, urlLote, baixarLoteMes, type DepsNotasVenda } from '../processar';

const AG = new Date('2026-10-16T12:00:00-03:00');
const INDISP = 'Mercado Livre indisponível — o pacote não foi gerado.';
const AMBIG = 'Não foi possível confirmar as notas do mês.';

/** Trava em memória com a mesma semântica do Redis (SET NX / SET EX). */
function deps(resposta: () => Promise<Response>, token: () => Promise<string> = async () => 'TOK') {
  const chaves = new Map<string, number>();
  const d = {
    travar: vi.fn(async (k: string, ttl: number) => { if (chaves.has(k)) return false; chaves.set(k, ttl); return true; }),
    liberar: vi.fn(async (k: string, s: number) => { chaves.set(k, s); }),
    token: vi.fn(token),
    fetchMl: vi.fn(async (_u: string, _t: string, _s: AbortSignal) => resposta()),
  } satisfies DepsNotasVenda;
  return { d, chaves };
}
const p = (extra: Partial<Parameters<typeof baixarLoteMes>[1]> = {}) =>
  ({ conexaoId: 'cx1', conta: '123', mes: '2026-09', agora: AG, signal: new AbortController().signal, ...extra });
const zipResp = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200, headers: { 'Content-Type': 'application/zip' } });
const ler = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

describe('intervaloDoMes e urlLote', () => {
  it('mês inteiro, fevereiro bissexto, futuro recusado no fuso de SP', () => {
    expect(intervaloDoMes('2026-09', AG)).toEqual({ start: '20260901', end: '20260930' });
    expect(intervaloDoMes('2028-02', new Date('2028-03-05T12:00:00-03:00'))).toEqual({ start: '20280201', end: '20280229' });
    expect(intervaloDoMes('2026-11', AG)).toEqual({ erro: 'Mês futuro não tem notas.' });
    expect(intervaloDoMes('2026-13', AG)).toEqual({ erro: 'Mês inválido.' });
    expect(intervaloDoMes('2026-11', new Date('2026-11-01T02:00:00Z'))).toEqual({ erro: 'Mês futuro não tem notas.' });
  });
  it('url com todos os filtros e sem CT-e', () => {
    expect(urlLote('123', '20260901', '20260930')).toBe('https://api.mercadolibre.com/users/123/invoices/sites/MLB/batch_request/period/stream?start=20260901&end=20260930&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false');
  });
});

describe('baixarLoteMes', () => {
  it('trava durante o stream inteiro; cooldown de 60 s só ao terminar', async () => {
    const { d, chaves } = deps(async () => zipResp());
    const r1 = await baixarLoteMes(d, p());
    expect(r1.tipo).toBe('zip');
    expect(d.travar).toHaveBeenCalledWith('lock:notas-venda:cx1', 460);
    const r2 = await baixarLoteMes(d, p());       // primeiro stream ainda aberto
    expect(r2).toEqual({ tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos.' });
    expect(d.fetchMl).toHaveBeenCalledTimes(1);
    expect(d.liberar).not.toHaveBeenCalled();
    if (r1.tipo !== 'zip') throw new Error('esperava zip');
    expect(await ler(r1.body)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
    expect(chaves.get('lock:notas-venda:cx1')).toBe(60);
  });
  it('resposta não-zip depois de travar também deixa cooldown', async () => {
    const { d } = deps(async () => new Response('', { status: 404 }));
    expect(await baixarLoteMes(d, p())).toEqual({ tipo: 'vazio' });
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
  });
  it('mapeia status do ML', async () => {
    const caso = async (r: () => Promise<Response>) => baixarLoteMes(deps(r).d, p());
    expect(await caso(async () => new Response('{"x":1}', { status: 404 }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('Invalid input.', { status: 400 }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response(null, { status: 200, headers: { 'Content-Type': 'application/zip' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('', { status: 200, headers: { 'Content-Type': 'application/zip' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('', { status: 429 }))).toEqual({ tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' });
    expect(await caso(async () => new Response('', { status: 403 }))).toEqual({ tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' });
    expect(await caso(async () => new Response('', { status: 503 }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
    expect(await caso(async () => { throw new Error('rede'); })).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
  });
  it('sinal já abortado: não trava nem chama o ML', async () => {
    const { d } = deps(async () => zipResp());
    const ac = new AbortController(); ac.abort();
    expect(await baixarLoteMes(d, p({ signal: ac.signal }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
    expect(d.travar).not.toHaveBeenCalled();
    expect(d.fetchMl).not.toHaveBeenCalled();
  });
  it('abort durante a trava: sem token nem ML, cooldown uma vez', async () => {
    const { d } = deps(async () => zipResp());
    let soltar: (v: boolean) => void = () => {};
    d.travar.mockImplementationOnce(() => new Promise<boolean>((r) => { soltar = r; }));
    const ac = new AbortController();
    const pend = baixarLoteMes(d, p({ signal: ac.signal }));
    ac.abort(); soltar(true);
    expect(await pend).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
    expect(d.token).not.toHaveBeenCalled();
    expect(d.fetchMl).not.toHaveBeenCalled();
    expect(d.liberar).toHaveBeenCalledTimes(1);
  });
  it('prazo cobre token pendente, headers sem bytes e 404 sem fim', async () => {
    const nunca = () => new Promise<never>(() => {});
    const semBytes = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    const corpo404 = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 404 }));
    for (const [resp, tok] of [[async () => zipResp(), nunca], [semBytes, undefined], [corpo404, undefined]] as const) {
      const { d } = deps(resp, tok);
      expect(await baixarLoteMes(d, p({ prazoMs: 30 }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
      expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
    }
  });
  it('cancelar o corpo libera a trava com cooldown', async () => {
    const { d } = deps(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } }), { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    const r = await baixarLoteMes(d, p());
    if (r.tipo !== 'zip') throw new Error('esperava zip');
    await r.body.cancel('cliente saiu');
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
  });
  it('mês inválido não trava nem chama o ML', async () => {
    const { d } = deps(async () => zipResp());
    expect(await baixarLoteMes(d, p({ mes: '2026-12' }))).toMatchObject({ tipo: 'erro', status: 400 });
    expect(d.travar).not.toHaveBeenCalled();
  });
});

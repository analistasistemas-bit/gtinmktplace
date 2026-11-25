import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as redis from '../../redis/client.ts';
import { LIMITE_RECUSAS_DIA, registrarRecusa } from '../recusas.ts';

vi.mock('../../redis/client.ts', () => ({ redisEvalInteiro: vi.fn(), redisSet: vi.fn() }));
const evalRedis = vi.mocked(redis.redisEvalInteiro);
const setRedis = vi.mocked(redis.redisSet);

/** Redis em memória que executa a regra do script: conta, e acima do limite reserva o aviso por 60 s. */
function redisFalso(inicial = 0) {
  const cont = new Map<string, number>();
  const aviso = new Map<string, number>();
  const relogio = { s: 0 };
  evalRedis.mockImplementation(async (_s, [kCont, kAviso], [limite, , reserva]) => {
    const n = (cont.get(kCont) ?? inicial) + 1;
    cont.set(kCont, n);
    if (n > Number(limite) && (aviso.get(kAviso) ?? -1) <= relogio.s) {
      aviso.set(kAviso, relogio.s + Number(reserva));
      return 1;
    }
    return 0;
  });
  setRedis.mockImplementation(async (k, _v, ttl) => { aviso.set(k, relogio.s + ttl!); });
  return { relogio, cont };
}

const DIA = new Date('2026-11-25T12:00:00Z');
beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => { vi.restoreAllMocks(); evalRedis.mockReset(); setRedis.mockReset(); });

describe('registrarRecusa', () => {
  it('até 1.000 não avisa; na 1.001ª avisa uma vez, sem chave, IP ou organização', async () => {
    redisFalso();
    const enviar = vi.fn(async (_t: string) => true);
    for (let i = 0; i < LIMITE_RECUSAS_DIA; i++) await registrarRecusa(DIA, enviar);
    expect(enviar).not.toHaveBeenCalled();
    for (let i = 0; i < 300; i++) await registrarRecusa(DIA, enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toContain('1.000 recusas');
    expect(enviar.mock.calls[0][0]).not.toMatch(/pai_|org|\d+\.\d+\.\d+\.\d+/);
  });

  it('recusas concorrentes ao cruzar o limite: um envio só', async () => {
    redisFalso(LIMITE_RECUSAS_DIA);
    const enviar = vi.fn(async () => true);
    await Promise.all(Array.from({ length: 50 }, () => registrarRecusa(DIA, enviar)));
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('envio que falha ou lança: nova tentativa só depois de 60 s; confirmado, não repete no dia', async () => {
    const { relogio } = redisFalso(LIMITE_RECUSAS_DIA);
    const enviar = vi.fn<(t: string) => Promise<boolean>>().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('rede')).mockResolvedValue(true);
    const recusa = () => registrarRecusa(DIA, enviar);
    await recusa(); await recusa();
    expect(enviar).toHaveBeenCalledTimes(1);
    relogio.s = 60; await recusa(); await recusa();
    expect(enviar).toHaveBeenCalledTimes(2);
    relogio.s = 120; await recusa();
    relogio.s = 4000; await recusa();
    expect(enviar).toHaveBeenCalledTimes(3);
  });

  it('o dia é o de Brasília e o contador tem validade', async () => {
    const { cont } = redisFalso();
    await registrarRecusa(new Date('2026-11-26T02:59:00Z'), async () => true);
    await registrarRecusa(new Date('2026-11-26T03:00:00Z'), async () => true);
    expect([...cont.keys()]).toEqual(['agt:rec:v1:20261125', 'agt:rec:v1:20261126']);
    const [script, chaves, args] = evalRedis.mock.calls[0];
    expect(chaves).toEqual(['agt:rec:v1:20261125', 'agt:rec:aviso:v1:20261125']);
    expect(args).toEqual([1000, 172800, 60]);
    for (const t of ["'INCR'", "'EXPIRE'", "'NX'"]) expect(script).toContain(t);
  });

  it('Redis fora: não lança, não avisa', async () => {
    evalRedis.mockRejectedValue(new Error('segredo no erro'));
    const enviar = vi.fn(async () => true);
    await expect(registrarRecusa(DIA, enviar)).resolves.toBeUndefined();
    expect(enviar).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('segredo');
  });

  it('data inválida não lança', async () => {
    await expect(registrarRecusa(new Date(NaN), async () => true)).resolves.toBeUndefined();
  });
});

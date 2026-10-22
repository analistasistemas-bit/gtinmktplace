// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { esperarPaginaEstavel, lerComReleitura, paginaDeBloqueio } from '../leitura-estavel';
import type { ResultadoLeitura } from '../../leitura/pdp';

const ok: ResultadoLeitura = { ok: true, dados: { mlItemId: 'MLB1' } as never };
const semEstado: ResultadoLeitura = { ok: false, motivo: 'estado_nao_encontrado' };
const fixo = (p: string) => () => p;

afterEach(() => vi.useRealTimers());

describe('lerComReleitura (erros de leitura que não são quebra de layout)', () => {
  it('caminho normal: estado na primeira leitura, sem esperar', async () => {
    const esperar = vi.fn(async () => true);
    expect(await lerComReleitura(() => ok, esperar, fixo('/MLB-1'))).toEqual(ok);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('estado aparece na releitura: não registra erro', async () => {
    const ler = vi.fn().mockReturnValueOnce(semEstado).mockReturnValueOnce(ok);
    expect(await lerComReleitura(ler, async () => true, fixo('/MLB-1'))).toEqual(ok);
  });

  it('continua sem estado na mesma página: registra (uma releitura só)', async () => {
    const ler = vi.fn(() => semEstado);
    expect(await lerComReleitura(ler, async () => true, fixo('/MLB-1'))).toEqual(semEstado);
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it('outro motivo (campo ausente) não espera nem relê', async () => {
    const campo: ResultadoLeitura = { ok: false, motivo: 'campo_ausente:preco' };
    const esperar = vi.fn(async () => true);
    expect(await lerComReleitura(() => campo, esperar, fixo('/MLB-1'))).toEqual(campo);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('inconclusivo não registra: espera falhou, página navegou ou virou bloqueio durante a espera', async () => {
    expect(await lerComReleitura(() => semEstado, async () => false, fixo('/MLB-1'))).toBeNull();
    const navega = vi.fn().mockReturnValueOnce('/MLB-1').mockReturnValue('/up/MLBU1');
    expect(await lerComReleitura(() => semEstado, async () => true, navega)).toBeNull();
    const bloqueia = vi.fn().mockReturnValueOnce('/MLB-1').mockReturnValue('/captcha/wall');
    expect(await lerComReleitura(() => semEstado, async () => true, bloqueia)).toBeNull();
  });

  it('página de bloqueio/verificação já na abertura: não registra', async () => {
    expect(await lerComReleitura(() => semEstado, async () => true, fixo('/captcha/wall'))).toBeNull();
    expect(await lerComReleitura(() => semEstado, async () => true, fixo('/gz/account-verification?go=x'))).toBeNull();
    expect(paginaDeBloqueio('/MLB-123-produto')).toBe(false);
  });
});

describe('esperarPaginaEstavel', () => {
  const doc = (estado: DocumentReadyState) => ({ readyState: estado }) as Document;

  it('página completa: estável depois de 1,5 s', async () => {
    vi.useFakeTimers();
    const p = esperarPaginaEstavel(doc('complete'), window);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe(true);
  });

  it('load não chega em 8 s: inconclusivo (false), não registra com a página carregando', async () => {
    vi.useFakeTimers();
    const p = esperarPaginaEstavel(doc('interactive'), window);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBe(false);
  });

  it('load chega: estável 1,5 s depois; pagehide antes disso: false', async () => {
    vi.useFakeTimers();
    const p = esperarPaginaEstavel(doc('interactive'), window);
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe(true);
    const q = esperarPaginaEstavel(doc('complete'), window);
    window.dispatchEvent(new Event('pagehide'));
    await expect(q).resolves.toBe(false);
  });
});

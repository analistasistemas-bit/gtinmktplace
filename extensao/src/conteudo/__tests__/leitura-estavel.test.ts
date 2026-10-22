import { describe, expect, it, vi } from 'vitest';
import { lerComReleitura, paginaDeBloqueio } from '../leitura-estavel';
import type { ResultadoLeitura } from '../../leitura/pdp';

const ok: ResultadoLeitura = { ok: true, dados: { mlItemId: 'MLB1' } as never };
const semEstado: ResultadoLeitura = { ok: false, motivo: 'estado_nao_encontrado' };

describe('lerComReleitura (erros de leitura que não são quebra de layout)', () => {
  it('estado aparece na releitura: não registra erro', async () => {
    const ler = vi.fn().mockReturnValueOnce(semEstado).mockReturnValueOnce(ok);
    const esperar = vi.fn(async () => {});
    expect(await lerComReleitura(ler, esperar, () => '/MLB-1')).toEqual(ok);
    expect(esperar).toHaveBeenCalledTimes(1);
  });

  it('continua sem estado na mesma página: registra (uma releitura só)', async () => {
    const ler = vi.fn(() => semEstado);
    expect(await lerComReleitura(ler, async () => {}, () => '/MLB-1')).toEqual(semEstado);
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it('outro motivo (campo ausente) não espera nem relê', async () => {
    const campo: ResultadoLeitura = { ok: false, motivo: 'campo_ausente:preco' };
    const esperar = vi.fn(async () => {});
    expect(await lerComReleitura(() => campo, esperar, () => '/MLB-1')).toEqual(campo);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('página de bloqueio/verificação do ML: não registra como layout (null)', async () => {
    expect(await lerComReleitura(() => semEstado, async () => {}, () => '/captcha/wall')).toBeNull();
    expect(await lerComReleitura(() => semEstado, async () => {}, () => '/gz/account-verification')).toBeNull();
  });

  it('paginaDeBloqueio só reconhece os caminhos observados', () => {
    expect(paginaDeBloqueio('/captcha/wall')).toBe(true);
    expect(paginaDeBloqueio('/MLB-123-produto')).toBe(false);
  });
});

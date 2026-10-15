import { describe, expect, it, vi } from 'vitest';
import { buscarCep } from '../cep';
import { UFS } from '../fiscal';

const resposta = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buscarCep (ViaCEP)', () => {
  it('mapeia a resposta para os campos de empresa_fiscal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const f = resposta({
      cep: '51021-530', logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      localidade: 'Recife', uf: 'PE', ibge: '2611606',
    });
    expect(await buscarCep('51021530', f)).toEqual({
      logradouro: 'Rua Padre Luiz Marques Teixeira', bairro: 'Boa Viagem',
      municipio: 'Recife', uf: 'PE', municipio_ibge: '2611606',
    });
    expect(f).toHaveBeenCalledWith('https://viacep.com.br/ws/51021530/json/', { signal: expect.any(AbortSignal) });
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });
  it('CEP inexistente ({erro:true}) devolve null', async () => {
    expect(await buscarCep('99999999', resposta({ erro: true }))).toBeNull();
  });
  it('HTTP 400 devolve null; 5xx lança', async () => {
    expect(await buscarCep('00000000', resposta({}, 400))).toBeNull();
    await expect(buscarCep('51021530', resposta({}, 503))).rejects.toThrow();
  });
  it('CEP geral de cidade: logradouro/bairro vazios chegam como string vazia', async () => {
    const r = await buscarCep('55000000', resposta({ logradouro: '', bairro: '', localidade: 'Caruaru', uf: 'PE', ibge: '2604106' }));
    expect(r).toEqual({ logradouro: '', bairro: '', municipio: 'Caruaru', uf: 'PE', municipio_ibge: '2604106' });
  });
});

describe('UFS', () => {
  it('tem as 27 unidades federativas, sem repetição', () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    expect(UFS).toContain('PE');
    expect(UFS).toContain('DF');
  });
});

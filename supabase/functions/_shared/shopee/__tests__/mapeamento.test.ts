import { describe, it, expect } from 'vitest';
import { classificarErroShopee } from '../mapeamento';

describe('classificarErroShopee', () => {
  it('error_auth → AUTENTICACAO retentável', () => {
    const r = classificarErroShopee({ error: 'error_auth', message: 'token expirado', request_id: 'x' });
    expect(r.codigo).toBe('AUTENTICACAO');
    expect(r.retentavel).toBe(true);
    expect(r.mensagemOperador).toMatch(/token expirado/);
  });

  it('error_permission → AUTENTICACAO não-retentável', () => {
    const r = classificarErroShopee({ error: 'error_permission' });
    expect(r.codigo).toBe('AUTENTICACAO');
    expect(r.retentavel).toBe(false);
  });

  it('error_param → ATRIBUTO não-retentável', () => {
    const r = classificarErroShopee({ error: 'error_param', message: 'param ruim' });
    expect(r.codigo).toBe('ATRIBUTO');
    expect(r.retentavel).toBe(false);
  });

  it('error_not_found → INDISPONIVEL não-retentável', () => {
    const r = classificarErroShopee({ error: 'error_not_found' });
    expect(r.codigo).toBe('INDISPONIVEL');
    expect(r.retentavel).toBe(false);
  });

  it('error_server → INDISPONIVEL retentável', () => {
    const r = classificarErroShopee({ error: 'error_server' });
    expect(r.codigo).toBe('INDISPONIVEL');
    expect(r.retentavel).toBe(true);
  });

  it('rate-limit → RATE_LIMIT retentável', () => {
    const r = classificarErroShopee({ error: 'error_rate_limit' });
    expect(r.codigo).toBe('RATE_LIMIT');
    expect(r.retentavel).toBe(true);
  });

  it('categoria → CATEGORIA', () => {
    expect(classificarErroShopee({ error: 'error_category_invalid' }).codigo).toBe('CATEGORIA');
  });

  it('imagem → FOTO', () => {
    expect(classificarErroShopee({ error: 'error_image_id_invalid' }).codigo).toBe('FOTO');
  });

  it('error desconhecido → DESCONHECIDO não-retentável', () => {
    const r = classificarErroShopee({ error: 'error_qualquer_coisa_nova' });
    expect(r.codigo).toBe('DESCONHECIDO');
    expect(r.retentavel).toBe(false);
  });

  it('HTTP 5xx → retentável mesmo sem error mapeado', () => {
    const r = classificarErroShopee({}, 503);
    expect(r.retentavel).toBe(true);
    expect(r.status).toBe(503);
  });

  it('HTTP 429 → RATE_LIMIT retentável', () => {
    const r = classificarErroShopee({}, 429);
    expect(r.codigo).toBe('RATE_LIMIT');
    expect(r.retentavel).toBe(true);
  });

  it('body nulo → DESCONHECIDO', () => {
    const r = classificarErroShopee(null);
    expect(r.codigo).toBe('DESCONHECIDO');
    expect(r.retentavel).toBe(false);
  });
});

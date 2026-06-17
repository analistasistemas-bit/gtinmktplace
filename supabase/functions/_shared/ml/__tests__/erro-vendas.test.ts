import { describe, expect, it } from 'vitest';

import { humanizarErroVendasML } from '../erro-vendas.ts';

describe('humanizarErroVendasML', () => {
  it('traduz erro de permissão em /orders para instrução acionável', () => {
    const msg = humanizarErroVendasML('ML /orders 403: {"message":"forbidden","error":"forbidden"}');
    expect(msg).toContain('Sem acesso aos pedidos do Mercado Livre');
    expect(msg).toContain('Dev Center');
    expect(msg).toContain('Configurações');
  });

  it('aponta ausência de scope read quando disponível', () => {
    const msg = humanizarErroVendasML('ML /orders 403: forbidden', 'offline_access write');
    expect(msg).toContain('escopo OAuth `read`');
  });

  it('traduz falha de token para reconexão', () => {
    const msg = humanizarErroVendasML('ML /users/me 401');
    expect(msg).toContain('Reconecte a conta em Configurações');
  });

  it('preserva erro desconhecido', () => {
    expect(humanizarErroVendasML('falha inesperada xyz')).toBe('falha inesperada xyz');
  });
});

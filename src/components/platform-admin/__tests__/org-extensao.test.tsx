import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgExtensao } from '../org-extensao';
import type { ExtensaoUsage } from '@/lib/platform-admin';

const mocks = vi.hoisted(() => ({ useUso: vi.fn() }));
vi.mock('@/hooks/usePlatformAdmin', () => ({ usePlatformExtensaoUsage: mocks.useUso }));

function uso(over: Partial<ExtensaoUsage> = {}): ExtensaoUsage {
  return {
    analises: 8, por_tipo: { anuncio: 6, busca: 0, catalogo: 2 }, pessoas_ativas: 2, dias_com_uso: 2, vinculos: 3,
    pessoas: [
      { actor_id: 'u1', actor_name: 'Diego', analises: 7, ultimo_dia: '2026-10-22' },
      { actor_id: 'u2', actor_name: null, analises: 1, ultimo_dia: '2026-10-21' },
    ],
    erros: [{ dia: '2026-10-22', tipo_pagina: 'catalogo', versao: '0.1.0', motivo: 'campo_ausente:preco', ocorrencias: 2, ultimo_ml_item_id: 'MLB1' }],
    erros_total: 2, primeiro_uso: '2026-10-21',
    ...over,
  };
}
const responder = (data: ExtensaoUsage | undefined, extra: Record<string, unknown> = {}) =>
  mocks.useUso.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra });

beforeEach(() => { mocks.useUso.mockReset(); responder(uso()); });
afterEach(() => cleanup());

describe('OrgExtensao (Central, Task 25)', () => {
  it('indicadores do mês, divisão por página, pessoas e erros legíveis', () => {
    render(<OrgExtensao orgId="org-a" month="2026-10" />);
    expect(mocks.useUso).toHaveBeenCalledWith('org-a', '2026-10');
    screen.getByText('Análises no mês');
    screen.getByText('Pessoas ativas');
    screen.getByText('Vínculos de produto');
    screen.getByText('Erros de leitura');
    const tipos = screen.getByRole('list', { name: 'Análises por tipo de página' });
    within(tipos).getByText('Anúncio');
    within(tipos).getByText('Catálogo');
    screen.getByText('Diego');
    screen.getByText('u2');
    screen.getByText('Preço ausente');
    screen.getByText('campo_ausente:preco');
    screen.getByText('MLB1');
    screen.getByText(/Em uso desde 21\/10\/2026/);
  });

  it('mês sem uso: estados vazios que explicam o que falta', () => {
    responder(uso({ analises: 0, por_tipo: { anuncio: 0, busca: 0, catalogo: 0 }, pessoas_ativas: 0, dias_com_uso: 0, pessoas: [], erros: [], erros_total: 0, primeiro_uso: null }));
    render(<OrgExtensao orgId="org-a" month="2026-10" />);
    screen.getByText('Ninguém usou a extensão neste mês');
    screen.getByText('Nenhum erro de leitura no mês');
  });

  it('vínculos indisponíveis explicam a falha; falha sem dado oferece tentar de novo', () => {
    responder(uso({ vinculos: null }));
    render(<OrgExtensao orgId="org-a" month="2026-10" />);
    screen.getByText('Contagem indisponível');
    cleanup();
    responder(undefined, { isError: true });
    render(<OrgExtensao orgId="org-a" month="2026-10" />);
    screen.getByText('Não foi possível carregar o uso da extensão.');
    screen.getByRole('button', { name: 'Tentar novamente' });
  });

  it('falha de atualização com dados em cache: avisa e mantém os dados', () => {
    responder(uso(), { isError: true });
    render(<OrgExtensao orgId="org-a" month="2026-10" />);
    screen.getByText('A atualização do uso falhou; os últimos dados disponíveis permanecem na tela.');
    screen.getByText('Diego');
  });
});

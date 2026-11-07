import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classificarCest, useSugestaoCest, type CestCandidato } from '../useCestOficial';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

const c = (cest: string, ncm_prefixo: string): CestCandidato =>
  ({ cest, ncm_prefixo, descricao: `d${cest}`, exato: ncm_prefixo.length === 8 });

const TABELA: Record<string, CestCandidato[]> = {
  '33049910': [c('2001400', '33049910')],
  '33051000': [c('2001700', '33051000')],
  '33049990': [c('2001500', '33049990'), c('2001600', '33049990')],
};

function montar(inicial: { ncm: string; cest: string; ativo?: boolean }) {
  const mudar = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  const r = renderHook(
    (p: { ncm: string; cest: string; ativo?: boolean }) => useSugestaoCest({ ativo: p.ativo ?? true, ncm: p.ncm, cest: p.cest, mudar }),
    { wrapper, initialProps: inicial },
  );
  return { ...r, mudar };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((_: string, a: { p_ncm: string }) => Promise.resolve({ data: TABELA[a.p_ncm] ?? [], error: null }));
});

describe('classificarCest (ADR-0197 D-3)', () => {
  it('nenhum candidato é sem', () => expect(classificarCest([])).toBe('sem'));
  it('um CEST exato é unico_exato, mesmo repetido por prefixo', () => {
    expect(classificarCest([c('1', '33049910')])).toBe('unico_exato');
    expect(classificarCest([c('1', '33049910'), c('1', '3304')])).toBe('unico_exato');
  });
  it('um CEST só por prefixo é varios: prefixo não prova enquadramento', () => {
    expect(classificarCest([c('1', '3304')])).toBe('varios');
  });
  it('exato com outro CEST por prefixo é varios: não vira falso único', () => {
    expect(classificarCest([c('1701400', '19011010'), c('2300200', '1901')])).toBe('varios');
  });
});

describe('useSugestaoCest (ADR-0197 D-5)', () => {
  it('preenche o candidato único', async () => {
    const { mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith({ cest: '2001400' }));
  });

  it('com vários candidatos não preenche', async () => {
    const { result, mudar } = montar({ ncm: '33049990', cest: '' });
    await waitFor(() => expect(result.current.status).toBe('varios'));
    expect(mudar).not.toHaveBeenCalled();
    expect(result.current.candidatos.map((x) => x.cest)).toEqual(['2001500', '2001600']);
  });

  it('não sobrescreve digitação, nem depois que o operador apaga', async () => {
    const { result, rerender, mudar } = montar({ ncm: '33049910', cest: '1234567' });
    await waitFor(() => expect(result.current.status).toBe('unico_exato'));
    rerender({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(result.current.status).toBe('unico_exato'));
    expect(mudar).not.toHaveBeenCalled();
  });

  it('apagar o valor sugerido não o devolve', async () => {
    const { rerender, mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledTimes(1));
    rerender({ ncm: '33049910', cest: '2001400' });
    rerender({ ncm: '33049910', cest: '' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mudar).toHaveBeenCalledTimes(1);
  });

  it('trocar o NCM limpa o valor automático e reavalia', async () => {
    const { rerender, mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith({ cest: '2001400' }));
    rerender({ ncm: '33049910', cest: '2001400' });
    rerender({ ncm: '33051000', cest: '2001400' });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith({ cest: '' }));
    rerender({ ncm: '33051000', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledWith({ cest: '2001700' }));
  });

  it('trocar o NCM preserva CEST digitado', async () => {
    const { result, rerender, mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledTimes(1));
    rerender({ ncm: '33049910', cest: '1234567' });
    rerender({ ncm: '33051000', cest: '1234567' });
    await waitFor(() => expect(result.current.status).toBe('unico_exato'));
    expect(mudar).toHaveBeenCalledTimes(1);
  });

  it('reabrir reavalia', async () => {
    const { rerender, mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(mudar).toHaveBeenCalledTimes(1));
    rerender({ ncm: '33049910', cest: '', ativo: false });
    rerender({ ncm: '33049910', cest: '', ativo: true });
    await waitFor(() => expect(mudar).toHaveBeenCalledTimes(2));
  });

  it('inativo não consulta; erro de leitura não preenche', async () => {
    montar({ ncm: '33049910', cest: '', ativo: false });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: new Error('falha') });
    const { result, mudar } = montar({ ncm: '33049910', cest: '' });
    await waitFor(() => expect(result.current.status).toBe('erro'));
    expect(mudar).not.toHaveBeenCalled();
  });
});

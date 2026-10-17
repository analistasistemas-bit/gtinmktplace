// ADR-0181 — resposta atrasada de "cadastrados desta nota" não pode contaminar outra leitura.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ cadastrados: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/notas-compra', () => ({
  buscarVinculos: async () => [], entradasPreviasDaNota: async () => [], importarNotaCompra: vi.fn(),
  produtosPorGtin: async () => ({}), statusDaNota: async () => null, produtosCadastradosDaNota: m.cadastrados,
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({ ...(await orig<object>()), fetchProdutosEstoqueResumo: async () => ({ produtos: [] }) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useEmpresaFiscal: () => ({ data: { cnpj: '11444777000161' } }) }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({ useTiposProdutoHabilitados: () => ({ data: [], isLoading: false }) }));
vi.mock('@/components/estoque/dialog-cadastro-produto', () => ({ DialogCadastroProduto: () => null }));
vi.mock('@/components/estoque/dialog-cadastro-grade', () => ({ DialogCadastroGrade: () => null }));
vi.mock('../../../../../supabase/functions/_shared/nfe/ler-nfe.ts', () => ({
  lerNfe: (xml: string) => ({ ok: true, nota: {
    chave: xml.padEnd(44, '0'), numero: 1, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T00:00:00-03:00',
    emitenteCnpj: '11222333000181', emitenteNome: 'F', destinatarioCnpj: '11444777000161', assinada: false, cStat: 100,
    totais: { vProd: 10, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 10 },
    itens: [{ nItem: 1, cProd: 'R', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 1,
      vProd: 10, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 }],
  } }),
}));

import { DialogImportarNota } from '../dialog-importar-nota';

const arquivo = (txt: string) => new File([txt], `${txt}.xml`, { type: 'text/xml' });
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (a: boolean) => <QueryClientProvider client={qc}><DialogImportarNota aberto={a} onFechar={() => {}} /></QueryClientProvider>;
  const r = render(ui(true));
  return { reabrir: (a: boolean) => r.rerender(ui(a)) };
}

beforeEach(() => m.cadastrados.mockReset());
afterEach(cleanup);

describe('DialogImportarNota — corrida da consulta de cadastrados', () => {
  it('resposta da nota A, chegando depois da leitura da nota B, é descartada', async () => {
    let resolverA!: (v: unknown) => void;
    m.cadastrados.mockImplementationOnce(() => new Promise((r) => { resolverA = r; })).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    montar();
    await user.upload(screen.getByTestId('nfe-input'), arquivo('A'));
    await waitFor(() => expect(m.cadastrados).toHaveBeenCalledTimes(1));
    await user.upload(screen.getByTestId('nfe-input'), arquivo('B'));
    await waitFor(() => expect(m.cadastrados).toHaveBeenCalledTimes(2));
    resolverA([{ nItem: 1, codigosPai: ['PRODUTO-DA-A'] }]);
    await new Promise((r) => setTimeout(r, 20));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.queryByText(/PRODUTO-DA-A/)).not.toBeInTheDocument();
    expect(screen.getByText(/escolha ou cadastre o produto/i)).toBeInTheDocument();
  });

  it('resposta atrasada após fechar o diálogo é descartada', async () => {
    let resolverA!: (v: unknown) => void;
    m.cadastrados.mockImplementationOnce(() => new Promise((r) => { resolverA = r; }));
    const user = userEvent.setup();
    const { reabrir } = montar();
    await user.upload(screen.getByTestId('nfe-input'), arquivo('A'));
    await waitFor(() => expect(m.cadastrados).toHaveBeenCalledTimes(1));
    reabrir(false); reabrir(true);
    resolverA([{ nItem: 1, codigosPai: ['PRODUTO-DA-A'] }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/PRODUTO-DA-A/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });

  it('enquanto a consulta está pendente, Avançar fica travado; depois, o produto da nota vale', async () => {
    let resolverA!: (v: unknown) => void;
    m.cadastrados.mockImplementationOnce(() => new Promise((r) => { resolverA = r; }));
    const user = userEvent.setup();
    montar();
    await user.upload(screen.getByTestId('nfe-input'), arquivo('A'));
    await waitFor(() => expect(m.cadastrados).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Conferindo produtos já cadastrados desta nota…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
    resolverA([{ nItem: 1, codigosPai: ['PRODUTO-B'] }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect((await screen.findAllByText(/PRODUTO-B/)).length).toBeGreaterThan(0);
  });

  it('consulta que falha não trava o Avançar', async () => {
    m.cadastrados.mockRejectedValueOnce(new Error('rede'));
    const user = userEvent.setup();
    montar();
    await user.upload(screen.getByTestId('nfe-input'), arquivo('A'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).toBeEnabled());
  });
});

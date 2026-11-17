// ADR-0207 §16: a nota de compra pré-seleciona o pedido aberto do fornecedor do CNPJ emitente e o repassa
// à importação. Org sem o módulo reposicao vê o assistente como sempre.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PedidoDTO } from '../../../../../supabase/functions/_shared/reposicao/tipos';
import { abrirSelect, escolherNoSelect } from '@/test/select';

const m = vi.hoisted(() => ({
  importar: vi.fn(), modulos: ['estoque'] as string[], pedidos: [] as unknown[], enabled: [] as boolean[],
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/notas-compra', () => ({
  buscarVinculos: async () => [], entradasPreviasDaNota: async () => [], importarNotaCompra: m.importar,
  produtosPorGtin: async () => ({}), statusDaNota: async () => null,
  produtosCadastradosDaNota: async () => [{ nItem: 1, codigosPai: ['00000043'], sugestao: { fator: 1, linhas: [{ codigo: 'S1', quantidade: 32 }] } }],
  primeiraEntradaComprovada: async () => false,
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<object>()), fetchProdutosEstoqueResumo: async () => ({ produtos: [] }), fetchVariacoesProduto: async () => [{ codigo: 'S1' }],
}));
vi.mock('@/hooks/useConfiguracoes', () => ({ useEmpresaFiscal: () => ({ data: { cnpj: '11444777000161' } }) }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({ useTiposProdutoHabilitados: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: m.modulos }) }));
vi.mock('@/hooks/useReposicao', () => ({
  useReposicao: (o: { enabled?: boolean }) => {
    m.enabled.push(!!o.enabled);
    return { data: o.enabled ? { pedidos: m.pedidos } : undefined, refetch: async () => ({ data: { pedidos: m.pedidos } }), encerrarSaldo: vi.fn() };
  },
}));
vi.mock('@/components/estoque/dialog-cadastro-produto', () => ({ DialogCadastroProduto: () => null }));
vi.mock('@/components/estoque/dialog-cadastro-grade', () => ({ DialogCadastroGrade: () => null }));
vi.mock('../../../../../supabase/functions/_shared/nfe/ler-nfe.ts', () => ({
  lerNfe: () => ({ ok: true, nota: {
    chave: '3'.repeat(44), numero: 1, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T00:00:00-03:00',
    emitenteCnpj: '11222333000181', emitenteNome: 'F', emitenteUf: null, destinatarioCnpj: '11444777000161', assinada: false, cStat: 100,
    totais: { vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 320 },
    itens: [{ nItem: 1, cProd: 'R', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 32,
      vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, icmsGrupo: null, csosn: null, cstIcms: null, cest: null, nFci: null }],
  } }),
}));

import { DialogImportarNota } from '../dialog-importar-nota';

function pedido(id: string, cnpj: string | null): PedidoDTO {
  return {
    id, fornecedor: { id: `f${id}`, nome: `Fornecedor ${id}`, cnpj }, status: 'enviado', previstoPara: null, atrasado: false,
    salvoPor: null, salvoEm: null, aprovadoPor: null, enviadoEm: null, alteradoPor: null, alteradoEm: null,
    itens: [{ codigo: 'S1', codigoPai: '00000043', quantidade: 40, sugerida: 40, recebida: 0, encerrado: false, codigoFornecedor: null }],
  };
}

async function irAoResumo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><DialogImportarNota aberto onFechar={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.upload(screen.getByTestId('nfe-input'), new File(['x'], 'n.xml', { type: 'text/xml' }));
  for (let i = 0; i < 3; i++) {
    const avancar = screen.getByRole('button', { name: 'Avançar' });
    await vi.waitFor(() => expect(avancar).toBeEnabled());
    await user.click(avancar);
  }
  return user;
}

afterEach(() => { cleanup(); m.importar.mockReset(); m.modulos = ['estoque']; m.pedidos = []; m.enabled = []; });

describe('DialogImportarNota — pedido de compra', () => {
  it('aceite 4 — pré-seleção escolhe o pedido do CNPJ emitente (B) e a importação o leva', async () => {
    m.modulos = ['estoque', 'reposicao'];
    m.pedidos = [pedido('A', '99888777000166'), pedido('B', '11222333000181')];
    m.importar.mockResolvedValue({ notaId: 'n', duplicada: false, pushOk: true });
    const user = await irAoResumo();
    expect(await screen.findByRole('combobox', { name: 'De qual pedido?' })).toHaveTextContent('Fornecedor B');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await vi.waitFor(() => expect(m.importar).toHaveBeenCalledTimes(1));
    expect(m.importar.mock.calls[0]![0].pedidoCompraId).toBe('B');
  });

  it('pedido de fornecedor com OUTRO CNPJ não aparece em "De qual pedido?"', async () => {
    m.modulos = ['estoque', 'reposicao'];
    m.pedidos = [pedido('A', '99888777000166'), pedido('B', '11222333000181'), pedido('C', null)];
    const user = await irAoResumo();
    await screen.findByRole('combobox', { name: 'De qual pedido?' });
    await abrirSelect(user, 'De qual pedido?');
    const nomes = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(nomes.some((n) => n?.includes('Fornecedor A'))).toBe(false);
    expect(nomes.some((n) => n?.includes('Fornecedor B'))).toBe(true);
    expect(nomes.some((n) => n?.includes('Fornecedor C'))).toBe(true);
  });

  it('pedido de fornecedor SEM CNPJ: pede confirmação; Voltar não importa, Confirmar manda vincularCnpj', async () => {
    m.modulos = ['estoque', 'reposicao'];
    m.pedidos = [pedido('C', null)];
    m.importar.mockResolvedValue({ notaId: 'n', duplicada: false, pushOk: true });
    const user = await irAoResumo();
    await screen.findByRole('combobox', { name: 'De qual pedido?' });
    await escolherNoSelect(user, 'De qual pedido?', 'Fornecedor C · faltam 40 de 40');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    let alerta = await screen.findByRole('alertdialog');
    expect(alerta).toHaveTextContent('O fornecedor Fornecedor C passa a ser identificado pelo CNPJ 11222333000181 (F). Confirmar?');
    await user.click(within(alerta).getByRole('button', { name: 'Voltar' }));
    expect(m.importar).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    alerta = await screen.findByRole('alertdialog');
    await user.click(within(alerta).getByRole('button', { name: 'Confirmar' }));
    await vi.waitFor(() => expect(m.importar).toHaveBeenCalledTimes(1));
    expect(m.importar.mock.calls[0]![0]).toMatchObject({ pedidoCompraId: 'C', vincularCnpj: true });
  });

  it('pedido do mesmo CNPJ: importa direto, sem confirmação nem vincularCnpj', async () => {
    m.modulos = ['estoque', 'reposicao'];
    m.pedidos = [pedido('B', '11222333000181')];
    m.importar.mockResolvedValue({ notaId: 'n', duplicada: false, pushOk: true });
    const user = await irAoResumo();
    await screen.findByRole('combobox', { name: 'De qual pedido?' });
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await vi.waitFor(() => expect(m.importar).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect('vincularCnpj' in m.importar.mock.calls[0]![0]).toBe(false);
  });

  it('org sem o módulo: sem campo, sem consulta e payload de sempre', async () => {
    m.pedidos = [pedido('B', '11222333000181')];
    m.importar.mockResolvedValue({ notaId: 'n', duplicada: false, pushOk: true });
    const user = await irAoResumo();
    await screen.findByRole('button', { name: 'Confirmar' });
    expect(screen.queryByRole('combobox', { name: 'De qual pedido?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await vi.waitFor(() => expect(m.importar).toHaveBeenCalledTimes(1));
    expect('pedidoCompraId' in m.importar.mock.calls[0]![0]).toBe(false);
    expect(m.enabled.every((x) => !x)).toBe(true);
  });
});

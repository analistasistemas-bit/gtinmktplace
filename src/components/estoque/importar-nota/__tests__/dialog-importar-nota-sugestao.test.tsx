// ADR-0181 (emenda 2026-10-17): a sugestão de distribuição chega à importação ao cadastrar (sessão)
// e ao reabrir a nota (gravada), com os códigos validados contra os SKUs atuais do produto.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ cadastrados: vi.fn(), skus: vi.fn(), resposta: null as unknown }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/notas-compra', () => ({
  buscarVinculos: async () => [], entradasPreviasDaNota: async () => [], importarNotaCompra: vi.fn(),
  produtosPorGtin: async () => ({}), statusDaNota: async () => null, produtosCadastradosDaNota: m.cadastrados,
  primeiraEntradaComprovada: async () => false,
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<object>()), fetchProdutosEstoqueResumo: async () => ({ produtos: [] }), fetchVariacoesProduto: m.skus,
}));
vi.mock('@/hooks/useConfiguracoes', () => ({ useEmpresaFiscal: () => ({ data: { cnpj: '11444777000161' } }) }));
vi.mock('@/hooks/useTiposProdutoHabilitados', () => ({ useTiposProdutoHabilitados: () => ({ data: [], isLoading: false }) }));
vi.mock('@/components/estoque/dialog-cadastro-produto', () => ({
  DialogCadastroProduto: ({ aberto, onCadastrado }: { aberto: boolean; onCadastrado: (r: unknown) => void }) =>
    (aberto ? <button type="button" onClick={() => onCadastrado(m.resposta)}>simular cadastro</button> : null),
}));
vi.mock('@/components/estoque/dialog-cadastro-grade', () => ({ DialogCadastroGrade: () => null }));
vi.mock('../../../../../supabase/functions/_shared/nfe/ler-nfe.ts', () => ({
  lerNfe: () => ({ ok: true, nota: {
    chave: '3'.repeat(44), numero: 1, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T00:00:00-03:00',
    emitenteCnpj: '11222333000181', emitenteNome: 'F', destinatarioCnpj: '11444777000161', assinada: false, cStat: 100,
    totais: { vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 320 },
    itens: [{ nItem: 1, cProd: 'R', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 32,
      vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 }],
  } }),
}));

import { DialogImportarNota } from '../dialog-importar-nota';

async function abrirNaEtapaProdutos() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><DialogImportarNota aberto onFechar={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.upload(screen.getByTestId('nfe-input'), new File(['x'], 'n.xml', { type: 'text/xml' }));
  const avancar = screen.getByRole('button', { name: 'Avançar' });
  await vi.waitFor(() => expect(avancar).toBeEnabled());
  await user.click(avancar);
  return user;
}

afterEach(() => { cleanup(); m.cadastrados.mockReset(); m.skus.mockReset(); m.resposta = null; });

describe('DialogImportarNota — sugestão do cadastro', () => {
  it('reabrir: sugestão gravada preenche; código que não existe mais é descartado com aviso', async () => {
    m.cadastrados.mockResolvedValue([{ nItem: 1, codigosPai: ['00000043'],
      sugestao: { fator: 1, linhas: [{ codigo: 'S1', quantidade: 20 }, { codigo: 'VELHO', quantidade: 12 }] } }]);
    m.skus.mockResolvedValue([{ codigo: 'S1' }, { codigo: 'S2' }]);
    await abrirNaEtapaProdutos();
    expect(await screen.findByText(/Distribuídas: 20 de 32 · faltam 12/)).toBeInTheDocument();
  });

  it('reabrir: falha ao validar os SKUs ⇒ sugestão descartada (sem erro)', async () => {
    m.cadastrados.mockResolvedValue([{ nItem: 1, codigosPai: ['00000043'], sugestao: { fator: 1, linhas: [{ codigo: 'S1', quantidade: 32 }] } }]);
    m.skus.mockRejectedValue(new Error('rede'));
    await abrirNaEtapaProdutos();
    expect(await screen.findByText(/Distribuídas: 0 de 32/)).toBeInTheDocument();
  });

  it('sessão: resposta com sugestaoDistribuicao preenche na hora; sem ela, só vincula (sem erro)', async () => {
    m.cadastrados.mockResolvedValue([]);
    m.resposta = { codigoPai: '00000043', sugestaoDistribuicao: { fator: 1, linhas: [{ codigo: '00000044', quantidade: 30 }] } };
    const user = await abrirNaEtapaProdutos();
    await user.click(screen.getByRole('button', { name: 'Cadastrar produto novo' }));
    await user.click(screen.getByRole('button', { name: 'simular cadastro' }));
    expect(await screen.findByText(/Distribuídas: 30 de 32 · faltam 2/)).toBeInTheDocument();
  });

  it('sessão: edge antiga (sem sugestaoDistribuicao) ⇒ sem preenchimento', async () => {
    m.cadastrados.mockResolvedValue([]);
    m.resposta = { codigoPai: '00000043' };
    const user = await abrirNaEtapaProdutos();
    await user.click(screen.getByRole('button', { name: 'Cadastrar produto novo' }));
    await user.click(screen.getByRole('button', { name: 'simular cadastro' }));
    expect(await screen.findByText(/Distribuídas: 0 de 32/)).toBeInTheDocument();
  });
});

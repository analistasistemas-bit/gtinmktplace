// Etapa 3: miniatura da foto por SKU, visualizador com quantidade editável e cabeçalho do item
// com aquisição/selo uma única vez.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const m = vi.hoisted(() => ({ skus: vi.fn(), prova: vi.fn(), resumo: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: (p: string | null | undefined) => ({ data: p ? `https://storage/${p}` : null }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<object>()),
  fetchVariacoesProduto: m.skus,
  fetchProdutosEstoqueResumo: m.resumo,
  fetchSkusEstoqueOrg: async () => [],
}));
vi.mock('@/lib/notas-compra', async (orig) => ({ ...(await orig<object>()), primeiraEntradaComprovada: m.prova }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ isAdmin: false }) }));
vi.mock('@/components/estoque/dialog-adicionar-variacao-roteador', () => ({ DialogAdicionarVariacaoRoteador: () => null }));

import { EtapaDistribuicao } from '../etapa-distribuicao';
import { definirProduto, estadoInicial, type EstadoImportacao } from '../estado';
import type { NotaCompraLida } from '../../../../../supabase/functions/_shared/nfe/tipos';

const z = { vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 320 };
const nota: NotaCompraLida = {
  chave: '3'.repeat(44), numero: 1, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T00:00:00-03:00',
  emitenteCnpj: '11222333000181', emitenteNome: 'F', destinatarioCnpj: '11444777000161', totais: z, assinada: false, cStat: 100,
  itens: [{ nItem: 1, cProd: 'R', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 32,
    vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 }],
};
const sku = (codigo: string, extra: object = {}) => ({
  codigo, nome: 'x', cor: 'Floral', gtin: null, estoque: 0, custo: 17, preco: 50, tamanho: codigo,
  pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: null, mlPictureId: null, mlItemId: null, kits: [],
  ...extra,
});
const capa = { codigoPai: '00000010', capaStoragePath: null, capaMlPictureId: 'CAPA1', mlItemId: null };

function Montar() {
  const [e, setE] = useState<EstadoImportacao>(() => definirProduto(estadoInicial(nota, '<x/>', [], {}), 1, '00000010'));
  return <EtapaDistribuicao e={e} atualizar={(f) => setE((s) => f(s))} />;
}
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Montar /></QueryClientProvider>);
}
afterEach(() => { cleanup(); m.skus.mockReset(); m.prova.mockReset(); m.resumo.mockReset(); });

function preparar(skus: object[], prova = true) {
  m.skus.mockResolvedValue(skus);
  m.prova.mockResolvedValue(prova);
  m.resumo.mockResolvedValue({ produtos: [capa] });
}
const tres = () => [
  sku('P', { imagemPath: 'v/p.jpg' }),
  sku('M', { mlPictureId: 'ML123' }),
  sku('G'),
];

describe('etapa Distribuição — fotos', () => {
  it('miniatura: foto da variação, foto do ML e capa do produto como fallback', async () => {
    preparar([sku('P', { imagemPath: 'v/p.jpg' }), sku('M', { mlPictureId: 'ML123' }), sku('G')]);
    montar();
    await screen.findByLabelText('Custo P');
    const imgs = screen.getAllByAltText(/^Foto de Floral/);
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      'https://storage/v/p.jpg',
      'https://http2.mlstatic.com/D_ML123-V.jpg',
      'https://http2.mlstatic.com/D_CAPA1-V.jpg',
    ]);
    expect(imgs[0]).toHaveAttribute('loading', 'lazy');
    expect(screen.getByAltText('Foto de Floral P')).toBeInTheDocument();
  });

  it('sem foto nem capa: ícone neutro', async () => {
    preparar([sku('G')]);
    m.resumo.mockResolvedValue({ produtos: [] });
    montar();
    await screen.findByLabelText('Custo G');
    expect(screen.getByTestId('foto-sku-placeholder')).toBeInTheDocument();
  });

  it('clicar abre o visualizador com SKU · Cor · Tamanho e quantidade editável que atualiza tabela e contador', async () => {
    preparar(tres());
    montar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ampliar foto do SKU M' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('M · Floral · M')).toBeInTheDocument();
    const campo = within(dlg).getByLabelText('Quantidade no visualizador M');
    await user.clear(campo);
    await user.type(campo, '12');
    expect(screen.getByLabelText('Quantidade M')).toHaveValue(12);
    expect(within(dlg).getByText('12 de 32 unidades')).toBeInTheDocument();
  });

  it('próximo/anterior, setas e Enter navegam; extremos desabilitam; Esc devolve o foco', async () => {
    preparar(tres());
    montar();
    const user = userEvent.setup();
    const mini = await screen.findByRole('button', { name: 'Ampliar foto do SKU P' });
    await user.click(mini);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'SKU anterior' })).toBeDisabled();
    await user.click(within(dlg).getByRole('button', { name: 'Próximo SKU' }));
    expect(within(dlg).getByText('M · Floral · M')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(dlg).getByText('G · Floral · G')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Próximo SKU' })).toBeDisabled();
    await user.keyboard('{ArrowLeft}');
    expect(within(dlg).getByText('M · Floral · M')).toBeInTheDocument();
    await user.click(within(dlg).getByLabelText('Quantidade no visualizador M'));
    await user.keyboard('{Enter}');
    expect(within(dlg).getByText('G · Floral · G')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ampliar foto do SKU G' })).toHaveFocus();
  });

  it('aquisição e selo do cadastro aparecem uma vez no cabeçalho do item, não por linha', async () => {
    preparar(tres());
    montar();
    await screen.findByLabelText('Custo P');
    expect(screen.getAllByText(/Aquisição R\$ 10,00\/un/)).toHaveLength(1);
    expect(screen.getAllByText(/Custo do cadastro \(1ª entrada\)/)).toHaveLength(1);
    expect(screen.queryByText('Custo editado')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Custo G'));
    await user.type(screen.getByLabelText('Custo G'), '99');
    expect(await screen.findAllByText('Custo editado')).toHaveLength(1);
  });
});

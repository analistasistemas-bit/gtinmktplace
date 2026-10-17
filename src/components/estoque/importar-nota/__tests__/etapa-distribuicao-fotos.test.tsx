// Etapa 3: miniatura da foto por SKU, visualizador com quantidade editável e cabeçalho do item
// com aquisição/selo uma única vez.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const m = vi.hoisted(() => ({ skus: vi.fn(), prova: vi.fn(), resumo: vi.fn(), org: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: (p: string | null | undefined) => ({ data: p ? `https://storage/${p}` : null }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<object>()),
  fetchVariacoesProduto: m.skus,
  fetchProdutosEstoqueResumo: m.resumo,
  fetchSkusEstoqueOrg: m.org,
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

type Previas = Parameters<typeof estadoInicial>[4];
function Montar({ previas }: { previas?: Previas }) {
  const [e, setE] = useState<EstadoImportacao>(() => definirProduto(estadoInicial(nota, '<x/>', [], {}, previas), 1, '00000010'));
  return <EtapaDistribuicao e={e} atualizar={(f) => setE((s) => f(s))} />;
}
function montar(previas?: Previas) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Montar previas={previas} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); m.skus.mockReset(); m.prova.mockReset(); m.resumo.mockReset(); m.org.mockReset(); });

function preparar(skus: object[], prova = true) {
  m.skus.mockResolvedValue(skus);
  m.prova.mockResolvedValue(prova);
  m.resumo.mockResolvedValue({ produtos: [capa] });
  m.org.mockResolvedValue([]);
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

  it('SKU de outro produto usa a capa do SEU produto (ou ícone), nunca a do produto principal', async () => {
    preparar([sku('P')]);
    m.resumo.mockResolvedValue({ produtos: [capa, { codigoPai: '00000020', capaStoragePath: null, capaMlPictureId: 'CAPA2', mlItemId: null }] });
    m.org.mockResolvedValue([
      { codigo: 'X1', codigoPai: '00000020', nome: 'Outro', cor: 'Azul', estoque: 0, tamanho: 'U' },
      { codigo: 'Y1', codigoPai: '00000030', nome: 'Sem capa', cor: 'Rosa', estoque: 0, tamanho: 'U' },
    ]);
    montar();
    const user = userEvent.setup();
    await screen.findByLabelText('Custo P');
    for (const cod of ['X1', 'Y1']) {
      await user.click(screen.getByRole('button', { name: '+ SKU de outro produto' }));
      await user.click(await screen.findByRole('button', { name: new RegExp(`^${cod} `) }));
    }
    expect(screen.getByAltText('Foto de Floral P')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_CAPA1-V.jpg');
    expect(screen.getByAltText('Foto de Azul U')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_CAPA2-V.jpg');
    expect(screen.queryByAltText('Foto de Rosa U')).not.toBeInTheDocument();
    expect(screen.getByTestId('foto-sku-placeholder')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ampliar foto do SKU X1' }));
    expect(within(await screen.findByRole('dialog')).getByAltText('Foto de Azul U')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_CAPA2-O.jpg');
  });

  it('linhas travadas (início, meio e fim): setas e Enter seguem funcionando, foco fica no diálogo', async () => {
    preparar(tres());
    montar([{ nItem: 1, codigo: 'P', quantidade: 1, custo: 10 }, { nItem: 1, codigo: 'M', quantidade: 1, custo: 10 }, { nItem: 1, codigo: 'G', quantidade: 1, custo: 10 }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ampliar foto do SKU P' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('Quantidade no visualizador P')).toBeDisabled();
    expect(dlg.contains(document.activeElement)).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect(within(dlg).getByText('M · Floral · M')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(within(dlg).getByText('G · Floral · G')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Próximo SKU' })).toBeDisabled();
    expect(dlg.contains(document.activeElement)).toBe(true);
    await user.keyboard('{ArrowLeft}');
    expect(within(dlg).getByText('M · Floral · M')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(within(dlg).getByText('P · Floral · P')).toBeInTheDocument();
  });

  it('erro de imagem tenta o próximo candidato: Storage, ML, capa e por fim o ícone', async () => {
    preparar([sku('P', { imagemPath: 'v/p.jpg', mlPictureId: 'ML1' })]);
    montar();
    await screen.findByLabelText('Custo P');
    const src = () => screen.getByAltText('Foto de Floral P').getAttribute('src');
    expect(src()).toBe('https://storage/v/p.jpg');
    fireEvent.error(screen.getByAltText('Foto de Floral P'));
    expect(src()).toBe('https://http2.mlstatic.com/D_ML1-V.jpg');
    fireEvent.error(screen.getByAltText('Foto de Floral P'));
    expect(src()).toBe('https://http2.mlstatic.com/D_CAPA1-V.jpg');
    fireEvent.error(screen.getByAltText('Foto de Floral P'));
    expect(screen.queryByAltText('Foto de Floral P')).not.toBeInTheDocument();
    expect(screen.getByTestId('foto-sku-placeholder')).toBeInTheDocument();
  });

  it('visualizador usa a variante original do ML (-O); a miniatura segue em -V', async () => {
    preparar([sku('M', { mlPictureId: 'ML123' })]);
    montar();
    await screen.findByLabelText('Custo M');
    expect(screen.getByAltText('Foto de Floral M')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_ML123-V.jpg');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ampliar foto do SKU M' }));
    expect(within(await screen.findByRole('dialog')).getByAltText('Foto de Floral M')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_ML123-O.jpg');
  });

  it('"Custo editado" compara cada linha com o SEU padrão (padrões mistos não acusam edição)', async () => {
    preparar([sku('P'), sku('M', { custo: null }), sku('G', { custo: null })]);
    montar();
    await screen.findByLabelText('Custo P');
    expect(screen.queryByText('Custo editado')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Custo G'));
    await user.type(screen.getByLabelText('Custo G'), '99');
    expect(await screen.findAllByText('Custo editado')).toHaveLength(1);
    expect(within(screen.getByLabelText('Custo G').closest('td')!).getByText('Custo editado')).toBeInTheDocument();
  });

  it('linha travada que não é SKU do produto principal: ícone, nunca a capa do principal', async () => {
    preparar([sku('P')]);
    montar([{ nItem: 1, codigo: 'Z', quantidade: 1, custo: 10 }]);
    await screen.findByLabelText('Custo Z');
    expect(screen.getByAltText('Foto de Floral P')).toHaveAttribute('src', 'https://http2.mlstatic.com/D_CAPA1-V.jpg');
    expect(screen.getAllByTestId('foto-sku-placeholder')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ampliar foto do SKU Z' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByTestId('foto-sku-placeholder')).toBeInTheDocument();
  });
});

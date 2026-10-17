// ADR-0181 D-9 (emenda 2026-10-17): a etapa 3 só semeia depois das DUAS leituras (SKUs e prova de
// 1ª entrada); prova true ⇒ custo do cadastro com selo; resposta tardia nunca apaga edição.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const m = vi.hoisted(() => ({ skus: vi.fn(), prova: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<object>()),
  fetchVariacoesProduto: m.skus,
  fetchProdutosEstoqueResumo: async () => ({ produtos: [] }),
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
  chave: '2'.repeat(44), numero: 1051, serie: 1, modelo: 55, tipoNf: 1, emitidaEm: '2026-10-13T00:00:00-03:00',
  emitenteCnpj: '11222333000181', emitenteNome: 'F', destinatarioCnpj: '11444777000161', totais: z, assinada: false, cStat: 100,
  itens: [{ nItem: 1, cProd: 'R', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 32,
    vProd: 320, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 }],
};
const sku = (codigo: string) => ({
  codigo, nome: 'Amarelo', cor: 'Amarelo', gtin: null, estoque: 0, custo: 17, preco: 50, tamanho: codigo === 'S1' ? 'P' : 'M',
  pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: null, mlPictureId: null, mlItemId: null, kits: [],
});

function Montar() {
  const [e, setE] = useState<EstadoImportacao>(() => definirProduto(estadoInicial(nota, '<x/>', [], {}), 1, '00000010'));
  return <EtapaDistribuicao e={e} atualizar={(f) => setE((s) => f(s))} />;
}
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Montar /></QueryClientProvider>);
}
const adiado = <T,>() => { let r!: (v: T) => void; let j!: (e: unknown) => void; const p = new Promise<T>((a, b) => { r = a; j = b; }); return { p, r, j }; };

afterEach(() => { cleanup(); m.skus.mockReset(); m.prova.mockReset(); });

describe('etapa Distribuição — custo padrão da 1ª entrada', () => {
  it('SKUs antes da prova: só semeia depois; prova true ⇒ 17 em todos + selo + aquisição; edição intacta', async () => {
    const s = adiado<ReturnType<typeof sku>[]>(); const p = adiado<boolean>();
    m.skus.mockReturnValue(s.p); m.prova.mockReturnValue(p.p);
    montar();
    s.r([sku('S1'), sku('S2')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Carregando SKUs…')).toBeInTheDocument();
    p.r(true);
    expect(await screen.findByLabelText('Custo S1')).toHaveValue(17);
    expect(screen.getByLabelText('Custo S2')).toHaveValue(17);
    expect(screen.getByLabelText('Quantidade S1')).toHaveValue(0);
    expect(screen.getAllByText('Custo do cadastro (1ª entrada)')).toHaveLength(2);
    expect(screen.getAllByText('Aquisição R$ 10,00/un')).toHaveLength(2);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Quantidade S1'));
    await user.type(screen.getByLabelText('Quantidade S1'), '20');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText('Quantidade S1')).toHaveValue(20);
  });

  it('prova falhou ⇒ custo da nota (10), sem selo', async () => {
    m.skus.mockResolvedValue([sku('S1'), sku('S2')]);
    m.prova.mockRejectedValue(new Error('rede'));
    montar();
    expect(await screen.findByLabelText('Custo S1')).toHaveValue(10);
    expect(screen.queryByText('Custo do cadastro (1ª entrada)')).not.toBeInTheDocument();
    expect(screen.getAllByText('Aquisição R$ 10,00/un')).toHaveLength(2);
  });

  it('prova false (recompra/planilha) ⇒ custo da nota', async () => {
    m.skus.mockResolvedValue([sku('S1')]);
    m.prova.mockResolvedValue(false);
    montar();
    expect(await screen.findByLabelText('Custo S1')).toHaveValue(10);
    await waitFor(() => expect(screen.getByLabelText('Quantidade S1')).toHaveValue(32));
  });
});

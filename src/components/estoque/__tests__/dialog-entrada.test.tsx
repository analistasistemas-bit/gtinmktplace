import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogEntrada } from '../dialog-entrada';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const variacao = (codigo: string, cor: string) => ({
  codigo, nome: null, cor, gtin: null, estoque: 5, custo: null, preco: 10,
  pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: null,
});

const produtos: ProdutoComSaldo[] = [
  {
    codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
    capaStoragePath: null, fornecedor: null, unidade: null, origem: 'nacional',
    mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 10,
    variacoes: [variacao('00000005', 'incolor'), variacao('00000006', 'bege')],
  },
  {
    codigoPai: '00000009', nomePai: 'Outro Produto', descricaoPai: null,
    capaStoragePath: null, fornecedor: null, unidade: null, origem: 'nacional',
    mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 5,
    variacoes: [variacao('00000010', 'única')],
  },
];

describe('DialogEntrada', () => {
  // O código do PAI não aparece no rótulo do SKU — filtrar por ele só funciona se o predicado
  // olhar codigoPai explicitamente. Sem isso a lista abre vazia.
  it('filtroInicial pelo código do pai lista só as variações daquele produto', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DialogEntrada produtos={produtos} aberto onFechar={() => {}} filtroInicial="00000004" />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/00000005/)).toBeInTheDocument();
    expect(screen.getByText(/00000006/)).toBeInTheDocument();
    expect(screen.queryByText(/00000010/)).toBeNull();
  });
});

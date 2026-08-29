import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabelaRadar } from '../tabela-radar';
import type { PulseProduto, PulseResumoOfertas } from '@/lib/pulse';

const produto: PulseProduto = {
  id: 'produto-1', catalog_product_id: 'MLB123456', codigo_pai: 'APTAMIL-1800', titulo: 'Aptamil', gtin: null,
  origem: 'auto', status: 'ativo', catalogo_status: 'vinculado', ptw_status: null, ptw_preco_sugerido: null,
  ptw_aplicavel: null, ptw_custos: null, ultimo_snapshot_em: null, meu_preco: 81.99, meu_preco_em: null,
  anuncio_status: 'active', anuncio_sub_status: [], anuncio_status_em: null, comissao_pct: null,
  comissao_fixa: null, comissao_preco: null, comissao_em: null,
};

const resumo: PulseResumoOfertas = {
  menorPreco: 36, menorObservado: 36, menorRelevante: 70.19, maiorRelevante: 70.19,
  nOfertas: 2, nOfertasRelevantes: 1, precosRelevantes: [70.19],
};

describe('TabelaRadar — mercado relevante', () => {
  it('exibe o menor relevante, nunca o menor observado', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TabelaRadar produtos={[produto]} resumo={new Map([[produto.id, resumo]])} resumoCarregando={false} onAbrirDetalhe={() => undefined} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('columnheader', { name: 'Menor relevante' })).toBeInTheDocument();
    // getAllByText: desde a ADR-0147 o mesmo preço aparece também na coluna da disputa. O que este
    // teste guarda é que o menor RELEVANTE é exibido e o menor OBSERVADO nunca.
    expect(screen.getAllByText(/R\$\s*70,19/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$\s*36,00/)).not.toBeInTheDocument();
    expect(screen.getByText('+17% mais caro')).toBeInTheDocument();
  });
});

// ADR-0141 D-24: a "Referência do ML" saiu da tela para TODAS as organizações. O número compara o
// preço contra um universo não comparável (Errata 10 da ADR-0119, reproduzida ao vivo no Spike
// 049: a nossa pomada de 50 ml comparada com apresentações de 49 g), então induz decisão errada.
// A coleta continua e a coluna do banco permanece — só a exibição sai.
describe('TabelaRadar — D-24: a Referência do ML não existe mais', () => {
  const comReferencia: PulseProduto = {
    ...produto, ptw_status: 'with_benchmark_high', ptw_aplicavel: true, ptw_preco_sugerido: 69.9,
  };

  it('não renderiza a coluna nem o selo, mesmo com o produto trazendo referência do ML', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TabelaRadar produtos={[comReferencia]} resumo={new Map([[produto.id, resumo]])} resumoCarregando={false} onAbrirDetalhe={() => undefined} />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('columnheader', { name: 'Referência do ML' })).not.toBeInTheDocument();
    expect(screen.queryByText(/referência do ML/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Acima de todos/)).not.toBeInTheDocument();
  });
});

// ADR-0147: a coluna que ocupa o lugar da "Referência do ML" mostra a DISPUTA do catálogo.
describe('TabelaRadar — Análise PubliAI: a disputa do catálogo', () => {
  const disputado: PulseResumoOfertas = {
    menorPreco: 130, menorObservado: 36, menorRelevante: 130, maiorRelevante: 209.9,
    nOfertas: 13, nOfertasRelevantes: 5, precosRelevantes: [130, 139.9, 144.56, 186.9, 209.9],
  };

  const renderRadar = (produtos: PulseProduto[], r: PulseResumoOfertas) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <TabelaRadar produtos={produtos} resumo={new Map([[produtos[0].id, r]])} resumoCarregando={false} onAbrirDetalhe={() => undefined} />
      </QueryClientProvider>,
    );
  };

  it('mostra quantos disputam, a faixa, e a posição como hipótese — nunca como fato', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);

    expect(screen.getByRole('columnheader', { name: 'Análise PubliAI' })).toBeInTheDocument();
    expect(screen.getByText('5 anúncios relevantes disputam')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*130,00\s*–\s*R\$\s*209,90/)).toBeInTheDocument();
    expect(screen.getByText(/ficaria em 4º de 6/)).toBeInTheDocument();
  });

  // Critério de aceite 5 da ADR-0147: o vocabulário do buy-box não entra na tela, porque o dado
  // que o sustentaria não existe.
  it('não usa o vocabulário do buy-box em lugar nenhum', () => {
    const { container } = renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    expect(container.textContent).not.toMatch(/ganhador|buy.?box|leva a venda/i);
  });

  it('a faixa nunca usa o menor observado, que inclui oferta desqualificada', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    expect(screen.queryByText(/R\$\s*36,00/)).not.toBeInTheDocument();
  });

  it('sem preço nosso, a disputa aparece e a linha de posição some', () => {
    renderRadar([{ ...produto, meu_preco: null }], disputado);
    expect(screen.getByText('5 anúncios relevantes disputam')).toBeInTheDocument();
    expect(screen.queryByText(/ficaria em/)).not.toBeInTheDocument();
  });

  // 22% dos catálogos do Radar estão neste estado (Spike 049 §5): é mercado, não falha de leitura.
  it('catálogo sem oferta relevante diz a frase, não "—" nem zero', () => {
    renderRadar([produto], { ...disputado, nOfertasRelevantes: 0, precosRelevantes: [] });
    expect(screen.getByText('Sem concorrente relevante no catálogo')).toBeInTheDocument();
    expect(screen.queryByText(/0 anúncios relevantes/)).not.toBeInTheDocument();
  });
});

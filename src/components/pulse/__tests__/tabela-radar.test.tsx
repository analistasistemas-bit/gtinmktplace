import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabelaRadar } from '../tabela-radar';
import type { ContextoMargem, PulseProduto, PulseResumoOfertas } from '@/lib/pulse';

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

const disputado: PulseResumoOfertas = {
  menorPreco: 130, menorObservado: 36, menorRelevante: 130, maiorRelevante: 209.9,
  nOfertas: 13, nOfertasRelevantes: 5, precosRelevantes: [130, 139.9, 144.56, 186.9, 209.9],
};

const renderRadar = (
  produtos: PulseProduto[],
  r: PulseResumoOfertas,
  extra: Partial<Omit<ComponentProps<typeof TabelaRadar>, 'produtos' | 'resumo' | 'resumoCarregando'>> = {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TabelaRadar
        produtos={produtos} resumo={new Map([[produtos[0].id, r]])} resumoCarregando={false}
        contextos={new Map()} onAbrirDetalhe={() => undefined} onReprecificar={() => undefined}
        {...extra}
      />
    </QueryClientProvider>,
  );
};

describe('TabelaRadar — mercado relevante', () => {
  it('exibe o menor relevante, nunca o menor observado', () => {
    renderRadar([produto], resumo);

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
    renderRadar([comReferencia], resumo);

    expect(screen.queryByRole('columnheader', { name: 'Referência do ML' })).not.toBeInTheDocument();
    expect(screen.queryByText(/referência do ML/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Acima de todos/)).not.toBeInTheDocument();
  });
});

// ADR-0147: a coluna que ocupa o lugar da "Referência do ML" mostra a DISPUTA do catálogo.
// "Análise PubliAI" prometia veredito de IA e entregava três fatos; o nome do ADR é o que está lá.
describe('TabelaRadar — Disputa do catálogo', () => {
  it('mostra quantos disputam, a faixa, e a posição como hipótese — nunca como fato', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);

    expect(screen.getByRole('columnheader', { name: 'Disputa do catálogo' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Análise PubliAI' })).not.toBeInTheDocument();
    expect(screen.getByText('5 disputam')).toBeInTheDocument();
    // getAllByText: a faixa também está no texto sr-only (mesma célula, explicação completa
    // para leitor de tela) — ver teste dedicado abaixo.
    expect(screen.getAllByText(/R\$\s*130,00\s*–\s*R\$\s*209,90/).length).toBeGreaterThan(0);
    // O preço próprio aparece UMA vez na linha — na coluna "Seu preço".
    expect(screen.getAllByText(/R\$\s*149,99/)).toHaveLength(1);
  });

  it('a posição hipotética sai do badge e vive no tooltip, sem sumir da tela', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    const badge = screen.getByText('5 disputam');
    expect(badge.closest('[title]')?.getAttribute('title')).toMatch(/ficaria em 4º de 6/);
  });

  // `title` só é alcançável no hover do mouse: sem texto permanente, a explicação some para
  // leitor de tela (a coluna não recebe foco próprio — a linha inteira já é focável e clicável,
  // ver data-table.tsx — então o texto vira conteúdo `sr-only`, não um controle novo).
  it('a explicação está sempre acessível ao leitor de tela, associada à célula da disputa', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    const explicacao = screen.getByText(/ficaria em 4º de 6/, { selector: '.sr-only' });
    expect(explicacao.closest('[title]')).toHaveTextContent('5 disputam');
  });

  it('a célula ocupa uma linha só — a de três linhas alongava a linha para 76px', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    expect(screen.queryByText(/^seu preço ficaria em/)).not.toBeInTheDocument();
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
    expect(screen.getByText('5 disputam')).toBeInTheDocument();
    expect(screen.queryByText(/ficaria em/)).not.toBeInTheDocument();
  });

  // 22% dos catálogos do Radar estão neste estado (Spike 049 §5): é mercado, não falha de leitura.
  it('catálogo sem oferta relevante diz a frase, não "—" nem zero', () => {
    renderRadar([produto], { ...disputado, nOfertasRelevantes: 0, precosRelevantes: [] });
    expect(screen.getByText('Sem concorrente relevante no catálogo')).toBeInTheDocument();
    expect(screen.queryByText(/0 anúncios relevantes/)).not.toBeInTheDocument();
  });
});

// Em 820px a tabela do Radar estoura 823px num container de 770 e o ⋮ saía da tela — e ele é o
// único acesso a "Pausar no radar" no tablet de demo.
describe('TabelaRadar — a coluna de ações não sai da tela', () => {
  it('a coluna de ações é fixa à direita', () => {
    renderRadar([produto], resumo);
    expect(screen.getByRole('columnheader', { name: 'Ações' }).className).toContain('sticky');
  });
});

// Errata 12 da ADR-0119: a lista abre ordenada por "Sua posição" e mandava reprecificar sem dizer
// se havia margem para reagir.
describe('TabelaRadar — Sobra hoje', () => {
  const comCustos: PulseProduto = {
    ...produto, meu_preco: 100, comissao_pct: 14, comissao_fixa: 0, comissao_preco: 100,
    ptw_custos: { comissao: null, frete: 5 },
  };
  const ctx = (c: ContextoMargem) => new Map([['APTAMIL-1800', c]]);

  const renderComContexto = (
    p: PulseProduto,
    contextos: Map<string, ContextoMargem> | undefined,
    onReprecificar = () => undefined,
    onAbrirDetalhe = () => undefined,
  ) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <TabelaRadar
          produtos={[p]} resumo={new Map([[p.id, resumo]])} resumoCarregando={false}
          contextos={contextos} onAbrirDetalhe={onAbrirDetalhe} onReprecificar={onReprecificar}
        />
      </QueryClientProvider>,
    );
  };

  it('mostra o líquido no preço vigente e o percentual sobre a venda', () => {
    // 100 − 14 (comissão) − 5 (frete) − 8 (imposto 8%) − 30 (custo) = 43,00 → 43,0%
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByRole('columnheader', { name: 'Sobra hoje' })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*43,00/)).toBeInTheDocument();
    // `toFixed(1)` devolve "43.0" (ponto) — é o que o detalhe já exibe hoje (dialog-detalhe.tsx:544).
    expect(screen.getByText(/43\.0%/)).toBeInTheDocument();
  });

  it('sem custo → "—" com o motivo, nunca zero', () => {
    renderComContexto(comCustos, ctx({ custo: null, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta custo do produto')).toHaveTextContent('—');
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
  });

  it('sem alíquota → "—" com o motivo, nunca a alíquota padrão', () => {
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: null }));
    expect(screen.getByTitle('Margem indisponível: falta alíquota de imposto')).toHaveTextContent('—');
    expect(screen.queryByText(/R\$\s*(53|43),00/)).not.toBeInTheDocument();
  });

  it('sem comissão lida → "—" com o motivo', () => {
    renderComContexto({ ...comCustos, comissao_pct: null }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta comissão do Mercado Livre')).toHaveTextContent('—');
  });

  it('sem frete → "—" com o motivo', () => {
    renderComContexto({ ...comCustos, ptw_custos: null }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta custo de frete do Mercado Livre')).toHaveTextContent('—');
  });

  it('prejuízo aparece em vermelho', () => {
    // 100 − 14 − 5 − 8 − 110 = −37,00
    renderComContexto(comCustos, ctx({ custo: 110, aliquotaPct: 8 }));
    expect(screen.getByText(/R\$\s*-?37,00/).className).toContain('text-destructive');
  });

  // A comissão do ML muda de faixa com o preço. Um produto já reprecificado tem a comissão lida
  // em OUTRO preço — a população exata que esta coluna serve —, e o detalhe já marca esse número
  // como estimativa: cru na lista e marcado no detalhe seria contradição na mesma tela (Errata 12).
  it('comissão lida em outro preço → o número sai marcado como estimativa', () => {
    renderComContexto({ ...comCustos, comissao_preco: 250 }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByText('estimativa')).toBeInTheDocument();
    expect(screen.getByText('estimativa').title).toContain('faixa de preço');
  });

  it('comissão lida no preço vigente → sem rótulo, o número é exato', () => {
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.queryByText('estimativa')).not.toBeInTheDocument();
  });

  // `sobraDe` também devolve null para preço <= 0 — invariante mais larga que a da célula. Com
  // `!` isto estourava e derrubava a linha inteira, não só a célula.
  it('preço zerado devolve "—", não derruba a linha', () => {
    renderComContexto({ ...comCustos, meu_preco: 0 }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: preço do anúncio inválido')).toHaveTextContent('—');
  });

  it('enquanto o contexto carrega não mente com "—": mostra skeleton', () => {
    const { container } = renderComContexto(comCustos, undefined);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it('a linha tem "Reprecificar", e ele não abre o detalhe por baixo', async () => {
    const abrir = vi.fn();
    const reprecificar = vi.fn();
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: 8 }), reprecificar, abrir);
    await userEvent.click(screen.getByRole('button', { name: 'Reprecificar Aptamil' }));
    expect(reprecificar).toHaveBeenCalledWith(comCustos);
    expect(abrir).not.toHaveBeenCalled();
  });
});

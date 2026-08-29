import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarDre } from '../sonar-dre';
import type { Tarifa } from '@/lib/tarifa';

// ADR-0149: cinco preços, cada um com a SUA cotação, e o bloco de capital do lote.

const tarifa = (comissao: number, frete: number, over: Partial<Tarifa> = {}): Tarifa => ({
  classico: { comissao, percentual: 14, fixa: 0, imposto: 0, recebe: 0 },
  premium: { comissao: comissao * 1.3, percentual: 18, fixa: 0, imposto: 0, recebe: 0 },
  frete,
  proveniencia: 'official',
  ...over,
});

// Cotação por preço, para provar que cada cenário usa a sua: o frete muda de faixa em R$ 79.
const porPreco = vi.hoisted(() => ({
  fn: (_p: number): Tarifa | null => null,
}));

vi.mock('@/lib/tarifa', async (orig) => ({
  ...(await orig<typeof import('@/lib/tarifa')>()),
  calcularTarifaML: vi.fn(async (preco: number) => porPreco.fn(preco)),
}));

vi.mock('@/lib/queries', async (orig) => ({
  ...(await orig<typeof import('@/lib/queries')>()),
  fetchAliquotas: vi.fn(async () => ({
    nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null,
  })),
}));

const ancora = { id: 'MLB1', nome: 'Aptamil Premium 2', category_id: 'MLB1234', preco_referencia: 89.9 };
const precos = { maisBarato: 59.9, medioDoNicho: 84.5 };

function renderDre(over: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SonarDre ancora={ancora} precos={precos} {...over} />
    </QueryClientProvider>,
  );
}

async function preencher() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/custo do produto/i), '42');
  await user.click(screen.getByRole('radio', { name: /nacional/i }));
  // D-16: sem o pacote, a cotação sai do padrão do ML e todos os cinco cenários recusam.
  await user.type(screen.getByLabelText(/peso do pacote/i), '950');
  await user.type(screen.getByLabelText(/altura/i), '18');
  await user.type(screen.getByLabelText(/largura/i), '13');
  await user.type(screen.getByLabelText(/comprimento/i), '13');
  return user;
}

beforeEach(() => {
  // Abaixo de R$ 79 o comprador paga o frete; acima, o vendedor absorve — degrau real do ML.
  porPreco.fn = (p) => tarifa(p * 0.14, p >= 79 ? 8.45 : 0);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SonarDre — cenários (ADR-0149)', () => {
  it('mostra os cinco preços, do mais barato ao mais caro', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/mais barato da amostra/i)).toBeInTheDocument());
    expect(screen.getByText(/preço médio do nicho/i)).toBeInTheDocument();
    expect(screen.getByText(/anúncio que mais vende/i)).toBeInTheDocument();
    expect(screen.getByText(/ponto de equilíbrio/i)).toBeInTheDocument();
  });

  // Critério de aceite 1: o buy-box não existe para nós (Spike 049).
  it('nenhum cenário menciona buy-box', async () => {
    const { container } = renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/mais barato da amostra/i)).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/buy.?box/i);
  });

  // Critério 2: cada cenário cota o SEU preço — o defeito da extrapolação era exatamente este.
  it('o frete difere entre cenários porque cada preço cai numa faixa', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/mais barato da amostra/i)).toBeInTheDocument());
    // R$ 59,90 (comprador paga) e R$ 89,90 (vendedor absorve) não podem exibir o mesmo frete.
    expect(screen.getAllByText(/R\$\s*8,45/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$\s*0,00/).length).toBeGreaterThan(0);
  });

  // Critério 3.
  it('um cenário com cotação não-oficial recusa sozinho', async () => {
    porPreco.fn = (p) => (p === 59.9
      ? tarifa(8.39, 0, { proveniencia: 'partial', motivo_proveniencia: 'pacote padrão' })
      : tarifa(p * 0.14, 8.45));
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/pacote padrão/i)).toBeInTheDocument());
    // Os demais continuam calculados.
    expect(screen.getByText(/anúncio que mais vende/i)).toBeInTheDocument();
  });

  // Critério 4.
  it('preços derivados aparecem marcados como projeção', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/ponto de equilíbrio/i)).toBeInTheDocument());
    expect(screen.getAllByText(/projeção/i).length).toBeGreaterThan(0);
  });

  // Critério 5: quantidade em branco não vira 1.
  it('sem quantidade não mostra capital nem lucro do lote', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/mais barato da amostra/i)).toBeInTheDocument());
    expect(screen.queryByText(/capital imobilizado/i)).not.toBeInTheDocument();
  });

  it('com quantidade mostra o que sai do caixa e o que volta', async () => {
    renderDre();
    const user = await preencher();
    await waitFor(() => expect(screen.getByText(/anúncio que mais vende/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/quantidade/i), '100');
    await waitFor(() => expect(screen.getByText(/capital imobilizado/i)).toBeInTheDocument());
    expect(screen.getByText(/R\$\s*4\.200,00/)).toBeInTheDocument();
  });

  // Critério 6: o percentual É o markup e tem que ser rotulado assim — não como "ROI", e não como
  // uma perífrase ("retorno sobre o custo") que esconde ser o mesmo número do card "Markup no
  // período" de Publicados/Faturamento. Ver Errata 3 da ADR-0149.
  it('chama o retorno de markup líquido, e não de ROI nem de horizonte', async () => {
    const { container } = renderDre();
    const user = await preencher();
    await waitFor(() => expect(screen.getByText(/anúncio que mais vende/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/quantidade/i), '100');
    await waitFor(() => expect(screen.getByText(/capital imobilizado/i)).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/\bROI\b/);
    expect(container.textContent).not.toMatch(/giro|prazo|horizonte/i);
    expect(screen.getByText(/markup líquido/i)).toBeInTheDocument();
  });

  // As duas percentagens da seção partilham o numerador (o lucro) e diferem só no denominador.
  // Sem o "s/ venda" no cabeçalho, 25,7% e 63,1% pareciam contradição — foi o que Diego perguntou.
  it('o cabeçalho da margem diz sobre o que ela é', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /margem s\/ venda/i })).toBeInTheDocument());
  });
});

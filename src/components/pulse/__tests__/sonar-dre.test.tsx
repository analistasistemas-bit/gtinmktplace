import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarDre } from '../sonar-dre';
import type { Tarifa } from '@/lib/tarifa';

const tarifaOficial: Tarifa = {
  classico: { comissao: 12.59, percentual: 14, fixa: 0, imposto: 0, recebe: 68.86 },
  premium: { comissao: 16.18, percentual: 18, fixa: 0, imposto: 0, recebe: 65.27 },
  frete: 8.45,
  proveniencia: 'official',
};

const cotacao = vi.hoisted(() => ({ resposta: null as Tarifa | null }));

vi.mock('@/lib/tarifa', async (orig) => ({
  ...(await orig<typeof import('@/lib/tarifa')>()),
  calcularTarifaML: vi.fn(async () => cotacao.resposta),
}));

vi.mock('@/lib/queries', async (orig) => ({
  ...(await orig<typeof import('@/lib/queries')>()),
  fetchAliquotas: vi.fn(async () => ({
    nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null,
  })),
}));

const ancora = { id: 'MLB1', nome: 'Aptamil Premium 2', category_id: 'MLB1234', preco_referencia: 89.9 };

function renderDre(over: Partial<Parameters<typeof SonarDre>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SonarDre ancora={ancora} {...over} />
    </QueryClientProvider>,
  );
}

/** Preenche custo e escolhe a origem — o mínimo que a DRE exige. */
async function preencher(custo = '42', origem = 'Nacional') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/custo do produto/i), custo);
  await user.click(screen.getByRole('radio', { name: new RegExp(origem, 'i') }));
  return user;
}

beforeEach(() => { cotacao.resposta = tarifaOficial; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SonarDre — seção 6 (ADR-0148)', () => {
  it('sem custo, não calcula e pede o dado que falta', () => {
    renderDre();
    expect(screen.getByText(/informe o custo do produto/i)).toBeInTheDocument();
    // "lucro" está no título e na própria mensagem, e o R$ do cabeçalho é o preço-âncora — nenhum
    // dos dois é resultado. O que não pode existir é a decomposição.
    expect(screen.queryByText(/frete que você absorve/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/não inclui/i)).not.toBeInTheDocument();
  });

  it('com custo e origem, decompõe e mostra o lucro', async () => {
    renderDre();
    await preencher();
    // getAllByText desde a ADR-0149: a seção passou a mostrar cinco cenários, e este mock devolve
    // a mesma cotação para todos os preços — logo a comissão se repete em mais de uma linha.
    await waitFor(() => expect(screen.getAllByText(/R\$\s*19,67/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/R\$\s*12,59/).length).toBeGreaterThan(0); // comissão
    expect(screen.getAllByText(/R\$\s*8,45/).length).toBeGreaterThan(0);  // frete
    expect(screen.getAllByText(/R\$\s*7,19/).length).toBeGreaterThan(0);  // imposto 8%
  });

  // Critério de aceite 6 da ADR-0148: alíquota nunca se presume.
  it('sem origem escolhida não calcula, mesmo com custo preenchido', async () => {
    renderDre();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/custo do produto/i), '42');
    await waitFor(() => expect(screen.getByText(/informe a origem/i)).toBeInTheDocument());
    expect(screen.queryByText(/R\$\s*19,67/)).not.toBeInTheDocument();
  });

  // Critério 4: a recusa é uma resposta, e diz por quê.
  it('cotação não oficial recusa e repete o motivo do ML, sem exibir número', async () => {
    cotacao.resposta = {
      ...tarifaOficial,
      proveniencia: 'partial',
      motivo_proveniencia: 'o frete foi calculado com um pacote padrão porque as dimensões não foram informadas',
    };
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/DRE indisponível/i)).toBeInTheDocument());
    expect(screen.getByText(/pacote padrão/i)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*19,67/)).not.toBeInTheDocument();
  });

  it('o ML sem responder recusa, e nunca mostra zero como se fosse resultado', async () => {
    cotacao.resposta = null;
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/DRE indisponível/i)).toBeInTheDocument());
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
  });

  // Critério 5: o que ficou de fora é declarado.
  it('declara custos fixos, variáveis e rebate como fora do número', async () => {
    renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/não inclui/i)).toBeInTheDocument());
    const fora = screen.getByText(/não inclui/i).textContent ?? '';
    expect(fora).toMatch(/fixos/i);
    expect(fora).toMatch(/vari/i);
    expect(fora).toMatch(/rebate/i);
  });

  // Critério 7: esta fatia não promete o que não entrega.
  it('não promete cenário, sensibilidade nem ROI', async () => {
    const { container } = renderDre();
    await preencher();
    await waitFor(() => expect(screen.getByText(/R\$\s*19,67/)).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/cenário|sensibilidade|ROI/i);
  });

  it('sem categoria não há cotação possível, e a seção diz isso', () => {
    renderDre({ ancora: { ...ancora, category_id: null } });
    expect(screen.getByText(/categoria/i)).toBeInTheDocument();
  });
});

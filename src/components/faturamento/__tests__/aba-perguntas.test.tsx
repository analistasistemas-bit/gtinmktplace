import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AbaPerguntas } from '../aba-perguntas';
import type { Pergunta, PaginaPerguntas } from '@/lib/perguntas';

const fetchMock = vi.fn();
const exportarMock = vi.fn();
const montarReportSpy = vi.fn();

vi.mock('@/lib/perguntas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/perguntas')>();
  return {
    ...actual,
    fetchPerguntasPagina: (...args: Parameters<typeof actual.fetchPerguntasPagina>) => fetchMock(...args),
    buscarPerguntas: () => exportarMock(),
  };
});

vi.mock('@/components/export/botao-exportar', () => ({
  BotaoExportar: (props: { montarReport: () => Promise<unknown> }) => {
    montarReportSpy(props.montarReport);
    return null;
  },
}));

const base = {
  item_id: 'MLB123', item_titulo: 'Produto X', texto: 'Tem estoque?', status: 'ANSWERED',
  resposta: 'Temos.', respondida_em: null, criada_em: '2026-07-10T10:00:00Z',
};

const PERGUNTAS: Pergunta[] = [
  { id: 'q-1', question_id: 1, comprador_id: 10, comprador_nick: 'MARIA_01', comprador_nome: null, ...base },
  { id: 'q-2', question_id: 2, comprador_id: 20, comprador_nick: 'OLCA4176283', comprador_nome: 'CARLA FABIANA DE OLIVEIRA PINTO', ...base },
];

function pagina(itens: Pergunta[], total: number): PaginaPerguntas {
  return { itens, total };
}

function renderAba() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AbaPerguntas /></QueryClientProvider>);
}

describe('AbaPerguntas', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    exportarMock.mockReset();
    montarReportSpy.mockReset();
    fetchMock.mockResolvedValue(pagina(PERGUNTAS, 2));
  });

  it('abre na aba Pendentes, página 1', async () => {
    renderAba();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [pag, tam, filtro] = fetchMock.mock.calls[0];
    expect(pag).toBe(1);
    expect(tam).toBe(20);
    expect(filtro).toEqual({ status: 'pendentes' });
  });

  it('aponta o atalho para as perguntas no ML, não para o anúncio', async () => {
    renderAba();
    expect((await screen.findAllByRole('link', { name: 'Abrir perguntas no Mercado Livre' }))[0])
      .toHaveAttribute('href', 'https://www.mercadolivre.com.br/perguntas/vendedor');
  });

  it('prefere o nome civil ao apelido do ML, como na aba Vendas', async () => {
    renderAba();
    expect(await screen.findByText('· Carla Fabiana')).toBeInTheDocument();
    expect(screen.queryByText('· OLCA4176283')).not.toBeInTheDocument();
  });

  it('cai no apelido quando o comprador nunca comprou', async () => {
    renderAba();
    expect(await screen.findByText('· MARIA_01')).toBeInTheDocument();
  });

  it('navegar de página e trocar de aba refazem a busca e voltam para a página 1', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => PERGUNTAS[i % 2]), 47));
    renderAba();
    await screen.findByText(/de 47 perguntas/i);

    await userEvent.click(screen.getByRole('button', { name: 'Página 3' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![0]).toBe(3));

    await userEvent.click(screen.getByRole('tab', { name: 'Respondidas' }));
    await waitFor(() => {
      const [pag, , filtro] = fetchMock.mock.calls.at(-1)!;
      expect(pag).toBe(1);
      expect(filtro).toEqual({ status: 'respondidas' });
    });
  });

  it('mostra o total no rodapé de paginação', async () => {
    fetchMock.mockResolvedValue(pagina(PERGUNTAS, 47));
    renderAba();
    expect(await screen.findByText(/de 47 perguntas/i)).toBeInTheDocument();
  });

  it('aba sem resultado mostra o vazio específico da aba, não o genérico', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderAba();
    expect(await screen.findByText('Nenhuma pergunta pendente.')).toBeInTheDocument();
  });

  it('exportar puxa a lista inteira filtrada pela aba ativa, não só a página visível', async () => {
    exportarMock.mockResolvedValue(PERGUNTAS); // as duas são ANSWERED
    renderAba();
    await waitFor(() => expect(montarReportSpy).toHaveBeenCalled());

    const montarReport = montarReportSpy.mock.calls.at(-1)![0];
    const report = (await montarReport()) as { linhas: unknown[] };
    // Aba padrão é Pendentes; as duas perguntas mockadas são ANSWERED → relatório vem vazio.
    expect(report.linhas).toHaveLength(0);
  });
});

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListaSugestoes } from '../lista-sugestoes';
import { useDispensarSugestao, useReativarSugestao, useSugestoesPromocao } from '@/hooks/useSugestoesPromocao';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import type { OpcaoCampanha, ResultadoSugestoes, Sugestao } from '@/lib/sugestoes-promocao';
import type { Promocao } from '@/lib/promocoes';

vi.mock('@/hooks/useSugestoesPromocao', () => ({
  useSugestoesPromocao: vi.fn(), useDispensarSugestao: vi.fn(), useReativarSugestao: vi.fn(),
}));
vi.mock('@/hooks/useOperacoes', async () => ({
  ...(await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes')), usePodeExecutarOperacao: vi.fn(),
}));
const preview = vi.fn();
vi.mock('../preview-operacao', () => ({
  PreviewOperacao: (p: Record<string, unknown>) => { if (p.aberto) preview(p); return null; },
}));

const promo = (id: string, nome: string, tipo = 'DEAL') => ({ promocao_id: id, nome, tipo }) as Promocao;
const opcao = (o: Partial<OpcaoCampanha> = {}): OpcaoCampanha => ({
  promocao: promo('C1', '11.11 da Black'), semaforo: 'verde', descontoPct: 40, lucroPorVenda: 6,
  itens: [{ ml_item_id: 'MLB1', preco_original: 73.25, preco_avaliado: 43.9 }] as never, ...o,
});
const sugestao = (o: Partial<Sugestao> = {}): Sugestao => ({
  chave: 'p:1', titulo: 'Jaqueta', thumbnail: null, faixa: 'quase_vendendo', unidades: 0, visitas: 212, estoque: 36,
  anunciosConvidados: 1, vendasAbaixo: 8.4, vendasEsperadas: 8.4, unidadesOk: 0, oportunidade: 50.4, recomendada: opcao(), alternativas: [], ...o,
});
const dados = (o: Partial<ResultadoSugestoes> = {}): ResultadoSugestoes => ({ quaseVendendo: [], invisivel: [], dispensadas: [], visitasPorUnidade: 23.9, ...o });
const carregar = (d: ResultadoSugestoes | undefined, extra = {}) =>
  vi.mocked(useSugestoesPromocao).mockReturnValue({ data: d, isLoading: false, isError: false, refetch: vi.fn(), ...extra } as never);

const dispensar = vi.fn();
const reativar = vi.fn();
const renderLista = () => render(<MemoryRouter><ListaSugestoes /></MemoryRouter>);

describe('ListaSugestoes', () => {
  beforeEach(() => {
    preview.mockClear(); dispensar.mockReset().mockResolvedValue(undefined); reativar.mockReset().mockResolvedValue(undefined);
    vi.mocked(useDispensarSugestao).mockReturnValue({ mutateAsync: dispensar, isPending: false } as never);
    vi.mocked(useReativarSugestao).mockReturnValue({ mutateAsync: reativar, isPending: false } as never);
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  });

  it('carregando mostra a logo PubliAI pulsando, não blocos cinza', async () => {
    carregar(undefined, { isLoading: true });
    renderLista();
    expect(await screen.findByRole('status', { name: 'Carregando' })).toHaveTextContent('Analisando vendas, visitas e campanhas…');
  });

  it('compara vendas e expectativa na mesma base (dias com coleta ok)', () => {
    carregar(dados({ quaseVendendo: [sugestao({ unidades: 4, unidadesOk: 1, vendasEsperadas: 3.07 })] }));
    renderLista();
    expect(screen.getByText('Vendeu 1 · esperado ~3')).toBeInTheDocument();
  });

  it('duas faixas, Quase vendendo primeiro, com o motivo e vendas abaixo do esperado', () => {
    carregar(dados({ quaseVendendo: [sugestao()], invisivel: [sugestao({ chave: 'p:2', titulo: 'Regata', faixa: 'invisivel', visitas: 4, vendasAbaixo: 0.1 })] }));
    renderLista();
    const titulos = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos[0]).toContain('Quase vendendo');
    expect(titulos[1]).toContain('Invisível');
    const quase = screen.getByRole('region', { name: /Quase vendendo/ });
    expect(within(quase).getByText('212 visitas, 0 vendas em 30 dias')).toBeInTheDocument();
    expect(within(quase).getByText('Vendeu 0 · esperado ~8')).toBeInTheDocument();
    expect(within(quase).getByText('pela média da conta')).toBeInTheDocument();
    expect(within(quase).getByText(/Preço atual R\$\s73,25/)).toBeInTheDocument();
    expect(within(quase).getByText('Estoque 36')).toBeInTheDocument();
    expect(screen.queryByText(/R\$.*\/mês/)).toBeNull();
    expect(within(screen.getByRole('region', { name: /Invisível/ })).getByText('Poucas visitas')).toBeInTheDocument();
  });

  it('selo "abaixo do piso" só no amarelo', () => {
    carregar(dados({ quaseVendendo: [sugestao(), sugestao({ chave: 'p:2', titulo: 'Regata', recomendada: opcao({ semaforo: 'amarelo' }) })] }));
    renderLista();
    expect(screen.getAllByText('Abaixo do piso')).toHaveLength(1);
  });

  it('pagina 20 por faixa', async () => {
    carregar(dados({ quaseVendendo: Array.from({ length: 25 }, (_, i) => sugestao({ chave: `p:${i}`, titulo: `Produto ${i}` })) }));
    renderLista();
    expect(screen.getAllByRole('button', { name: /^Aderir/ })).toHaveLength(20);
    await userEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(screen.getAllByRole('button', { name: /^Aderir/ })).toHaveLength(5);
  });

  it('Aderir abre o preview só com os itens da campanha e a marcação de origem', async () => {
    carregar(dados({ quaseVendendo: [sugestao()] }));
    renderLista();
    await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'aderir', tipo: 'DEAL', promocaoId: 'C1', promocaoNome: '11.11 da Black',
      itens: [expect.objectContaining({ ml_item_id: 'MLB1' })],
      sugestao: { faixa: 'quase_vendendo', oportunidade: 50.4, chave: 'p:1' },
    }));
  });

  it('trocar a campanha muda o que o Aderir envia', async () => {
    const outra = opcao({ promocao: promo('C2', 'Campanha B', 'SMART'), descontoPct: 10, lucroPorVenda: 9, itens: [{ ml_item_id: 'MLB2', preco_original: 73.25, preco_avaliado: 65 }] as never });
    carregar(dados({ quaseVendendo: [sugestao({ alternativas: [outra] })] }));
    renderLista();
    await userEvent.click(screen.getByRole('button', { name: '+1 campanha' }));
    await userEvent.click(screen.getByRole('button', { name: /Usar Campanha B/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ promocaoId: 'C2', tipo: 'SMART', itens: [expect.objectContaining({ ml_item_id: 'MLB2' })] }));
  });

  it('mostra quantos anúncios a campanha cobre quando não são todos', () => {
    carregar(dados({ quaseVendendo: [sugestao({ anunciosConvidados: 18, recomendada: opcao({ itens: Array(14).fill({ ml_item_id: 'X', preco_original: 73.25, preco_avaliado: 43.9 }) as never }) })] }));
    renderLista();
    expect(screen.getByText('14 de 18 anúncios nesta campanha')).toBeInTheDocument();
  });

  it('Dispensar chama a mutação; filtro mostra dispensados e Reativar', async () => {
    carregar(dados({ quaseVendendo: [sugestao()], dispensadas: [sugestao({ chave: 'p:9', titulo: 'Regata' })] }));
    renderLista();
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar Jaqueta por 30 dias' }));
    expect(dispensar).toHaveBeenCalledWith('p:1');
    await userEvent.click(screen.getByRole('tab', { name: /Dispensados/ }));
    expect(screen.queryByText('Jaqueta')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reativar Regata' }));
    expect(reativar).toHaveBeenCalledWith('p:9');
  });

  describe('várias campanhas', () => {
    const dealB = opcao({ promocao: { ...promo('C2', 'Black Friday'), inicio: '2026-11-12T03:00:00Z', fim: '2026-12-01T03:00:00Z' } as Promocao });
    const dealA = opcao({ promocao: { ...promo('C1', '11.11 da Black'), inicio: '2026-10-19T03:00:00Z', fim: '2026-11-12T03:00:00Z' } as Promocao });

    it('marca as campanhas de uma vez e confirma uma depois da outra, na ordem das datas', async () => {
      carregar(dados({ quaseVendendo: [sugestao({ recomendada: dealB, alternativas: [dealA] })] }));
      renderLista();
      await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
      expect(screen.getByRole('checkbox', { name: /Black Friday/ })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /11\.11 da Black/ })).not.toBeChecked();
      await userEvent.click(screen.getByRole('checkbox', { name: /11\.11 da Black/ }));
      expect(screen.queryByText(/o ML aplica o menor preço/)).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Continuar (2)' }));
      const primeiro = preview.mock.calls.at(-1)![0] as { promocaoId: string; passo: unknown; aoConcluir: () => void; sugestao: unknown };
      expect(primeiro).toMatchObject({ promocaoId: 'C1', passo: { atual: 1, total: 2 }, sugestao: expect.objectContaining({ chave: 'p:1' }) });
      act(() => primeiro.aoConcluir());
      const segundo = preview.mock.calls.at(-1)![0] as { promocaoId: string; aoConcluir?: unknown };
      expect(segundo).toMatchObject({ promocaoId: 'C2', passo: { atual: 2, total: 2 } });
      expect(segundo.aoConcluir).toBeUndefined();
    });

    it('sem nenhuma marcada não continua', async () => {
      carregar(dados({ quaseVendendo: [sugestao({ recomendada: dealB, alternativas: [dealA] })] }));
      renderLista();
      await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
      await userEvent.click(screen.getByRole('checkbox', { name: /Black Friday/ }));
      expect(screen.getByRole('button', { name: 'Continuar (0)' })).toBeDisabled();
    });

    it('avisa quando os períodos coincidem no mesmo anúncio', async () => {
      const sobreposta = opcao({ promocao: { ...promo('C3', 'Outra'), inicio: '2026-11-01T03:00:00Z', fim: '2026-11-20T03:00:00Z' } as Promocao });
      carregar(dados({ quaseVendendo: [sugestao({ recomendada: dealA, alternativas: [sobreposta] })] }));
      renderLista();
      await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
      await userEvent.click(screen.getByRole('checkbox', { name: /Outra/ }));
      expect(screen.getByText(/o ML aplica o menor preço/)).toBeInTheDocument();
    });

    it('SMART escolhida segue direto para o painel, uma campanha só', async () => {
      const smart = opcao({ promocao: promo('C9', 'Impulsione', 'SMART') });
      carregar(dados({ quaseVendendo: [sugestao({ recomendada: smart, alternativas: [dealA, dealB] })] }));
      renderLista();
      await userEvent.click(screen.getByRole('button', { name: 'Aderir Jaqueta' }));
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(preview.mock.calls.at(-1)![0]).toMatchObject({ promocaoId: 'C9' });
    });
  });

  it('sem permissão não mostra Aderir nem Dispensar', () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    carregar(dados({ quaseVendendo: [sugestao()] }));
    renderLista();
    expect(screen.queryByRole('button', { name: /Aderir|Dispensar/ })).toBeNull();
    expect(screen.getByText('Jaqueta')).toBeInTheDocument();
  });

  it('erro não vira lista vazia e oferece tentar de novo', async () => {
    const refetch = vi.fn();
    carregar(undefined, { isError: true, refetch });
    renderLista();
    expect(screen.getByText('Não foi possível carregar as sugestões.')).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma sugestão/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('vazio explica o que entra na lista', () => {
    carregar(dados());
    renderLista();
    expect(screen.getByText('Nenhuma sugestão agora.')).toBeInTheDocument();
  });

  it('conta sem vendas avisa que não há conversão para comparar', () => {
    carregar(dados({ visitasPorUnidade: null, quaseVendendo: [sugestao({ vendasAbaixo: 0 })] }));
    renderLista();
    expect(screen.getByText(/ainda não tem vendas/)).toBeInTheDocument();
    expect(screen.queryByText('vendas abaixo do esperado')).toBeNull();
  });
});

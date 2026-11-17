// Spec 2026-11-16-reposicao §2 a §7 (Task 6): tela de Sugestões com o mapa da grade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RespostaReposicao, SkuTela } from '../../../../supabase/functions/_shared/reposicao/tipos';
import { calcularReposicao, type SugestaoSku } from '../../../../supabase/functions/_shared/reposicao/calculo';

const acoes = {
  salvarConfig: vi.fn(), salvarRascunho: vi.fn(), aprovar: vi.fn(), marcarEnviado: vi.fn(), editarPedido: vi.fn(),
  encerrarSaldo: vi.fn(), reabrirSaldo: vi.fn(), naoRepor: vi.fn(), removerNaoRepor: vi.fn(), definirMultiplo: vi.fn(),
};
const estado: { data: RespostaReposicao | undefined; isError: boolean; admin: boolean } = { data: undefined, isError: false, admin: true };
vi.mock('@/hooks/useReposicao', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useReposicao')>()),
  useReposicao: () => ({ data: estado.data, isLoading: false, isError: estado.isError, error: null, refetch: vi.fn(), pendente: false, ...acoes }),
}));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: undefined }) }));
vi.mock('@/hooks/useOperacoes', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useOperacoes')>()),
  usePodeExecutarOperacao: () => estado.admin,
}));

import Reposicao from '@/pages/Reposicao';

function sug(p: Partial<SugestaoSku> & { codigo: string; codigoPai: string }): SugestaoSku {
  return {
    propria: 0.2, diasDisponiveis: 40, unidades: 8, w: 1, usada: 0.2, picoLimitadoEm: [], vendasEmOferta: 0,
    estoqueHoje: 2, v: 0.25, aCaminho: 0, chegaEm: null, diasDeEstoque: 8, pedirAntesMultiplo: 4, pedir: 4,
    urgencia: 'pedir_agora', poucoHistorico: false, completarGrade: 0, ...p,
  };
}
function tela(p: Partial<SkuTela> & { codigo: string; codigoPai: string }): SkuTela {
  return { cor: null, corHex: null, tamanho: null, custo: 10, preco: 50, naoReporId: null, ...p };
}

function base(): RespostaReposicao {
  return {
    config: { prazo: 15, cobertura: 30 },
    resultado: {
      pctEstimadoPelaFamilia: 0.2,
      familias: [
        { codigoPai: 'SHORT', pedir: 9, pedirAntesMultiplo: 9, tendencia: { fator: 1.2, variacaoVendas: 0.4 }, urgencia: 'pedir_agora' },
        { codigoPai: 'CALCA', pedir: 6, pedirAntesMultiplo: 6, tendencia: null, urgencia: 'ruptura' },
        { codigoPai: 'CINTO', pedir: 0, pedirAntesMultiplo: 0, tendencia: null, urgencia: 'em_dia' },
      ],
      skus: [
        sug({ codigo: 'S1', codigoPai: 'SHORT', estoqueHoje: 2, pedir: 4 }),
        sug({ codigo: 'S2', codigoPai: 'SHORT', estoqueHoje: 0, pedir: 3, poucoHistorico: true, w: 0.5 }),
        sug({ codigo: 'S3', codigoPai: 'SHORT', estoqueHoje: 4, pedir: 0, urgencia: 'em_dia' }),
        sug({ codigo: 'S4', codigoPai: 'SHORT', estoqueHoje: 1, pedir: 2 }),
        sug({ codigo: 'C1', codigoPai: 'CALCA', estoqueHoje: 0, pedir: 6, urgencia: 'ruptura', v: 1 }),
        sug({ codigo: 'K1', codigoPai: 'CINTO', estoqueHoje: 9, pedir: 0, urgencia: 'em_dia' }),
      ],
    },
    skus: [
      tela({ codigo: 'S1', codigoPai: 'SHORT', cor: 'Preto', corHex: '#000000', tamanho: 'P' }),
      tela({ codigo: 'S2', codigoPai: 'SHORT', cor: 'Preto', corHex: '#000000', tamanho: 'M' }),
      tela({ codigo: 'S3', codigoPai: 'SHORT', cor: 'Cáqui', corHex: '#c3b091', tamanho: 'P' }),
      tela({ codigo: 'S4', codigoPai: 'SHORT', cor: 'Cáqui', corHex: '#c3b091', tamanho: 'M', naoReporId: 'nr-1' }),
      tela({ codigo: 'C1', codigoPai: 'CALCA', cor: 'Marrom', tamanho: '42' }),
      tela({ codigo: 'K1', codigoPai: 'CINTO' }),
    ],
    familias: [
      { codigoPai: 'SHORT', nome: 'Short Bermuda Mauricinho', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
      { codigoPai: 'CALCA', nome: 'Calça Sarja Masculina', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
      { codigoPai: 'CINTO', nome: 'Cinto Couro', fornecedor: { id: 'f2', nome: 'COURO SUL' }, multiplo: 1 },
    ],
    naoRepor: [{ id: 'nr-1', escopo: 'sku', codigoPai: 'SHORT', codigo: 'S4', cor: null }],
    rascunhos: [],
    pedidos: [],
  };
}

function renderTela(rota = '/reposicao') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Reposicao />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  estado.data = base();
  estado.isError = false;
  estado.admin = true;
  for (const f of Object.values(acoes)) f.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('Reposição: sugestões', () => {
  it('sem config: só o painel de 2 campos com a frase do exemplo', () => {
    estado.data = { config: null, resultado: null, skus: [], familias: [], naoRepor: [], rascunhos: [], pedidos: [] };
    renderTela();
    expect(screen.getByLabelText('Prazo de reposição (dias)')).toHaveValue(15);
    expect(screen.getByLabelText('Cobertura desejada (dias)')).toHaveValue(30);
    expect(screen.getByText('Com 15 e 30: um produto que vende 1 por dia pede para durar 30 dias depois que a compra chega, mais uma folga.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ruptura/ })).toBeNull();
  });

  it('salvar a config manda prazo e cobertura', async () => {
    estado.data = { config: null, resultado: null, skus: [], familias: [], naoRepor: [], rascunhos: [], pedidos: [] };
    renderTela();
    fireEvent.change(screen.getByLabelText('Prazo de reposição (dias)'), { target: { value: '20' } });
    expect(screen.getByText(/^Com 20 e 30:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(acoes.salvarConfig).toHaveBeenCalledWith({ prazo: 20, cobertura: 30 });
  });

  it('membro não admin: painel de config só leitura, com a dica (inicial e "Ajustar")', async () => {
    estado.admin = false;
    estado.data = { config: null, resultado: null, skus: [], familias: [], naoRepor: [], rascunhos: [], pedidos: [] };
    renderTela();
    expect(screen.getByLabelText('Prazo de reposição (dias)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.getByText('Só administrador altera o prazo e a cobertura.')).toBeInTheDocument();
    cleanup();
    estado.data = base();
    renderTela();
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }));
    expect(await screen.findByLabelText('Cobertura desejada (dias)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('"Compra em múltiplos de": admin grava inteiro 1..1000 (Enter + blur = um envio); inválido volta; membro só lê', async () => {
    estado.data!.familias[0]!.multiplo = 6;
    renderTela('/reposicao?produto=SHORT');
    const campo = screen.getByLabelText('Compra em múltiplos de');
    expect(campo).toHaveValue(6);
    await userEvent.clear(campo);
    await userEvent.type(campo, '0');
    fireEvent.blur(campo);
    expect(acoes.definirMultiplo).not.toHaveBeenCalled();
    expect(campo).toHaveValue(6);
    await userEvent.clear(campo);
    await userEvent.type(campo, '12{Enter}');
    fireEvent.blur(campo);
    expect(acoes.definirMultiplo).toHaveBeenCalledTimes(1);
    expect(acoes.definirMultiplo).toHaveBeenCalledWith({ codigoPai: 'SHORT', multiplo: 12 });
    cleanup();
    estado.admin = false;
    renderTela('/reposicao?produto=SHORT');
    expect(screen.queryByLabelText('Compra em múltiplos de')).toBeNull();
    expect(screen.getByText('Compra em múltiplos de 6.')).toBeInTheDocument();
  });

  it('"Já está no rascunho": pelo id do fornecedor; sem id, pelo nome normalizado', () => {
    const rascunho = (id: string, nome: string) => ({
      id: `r-${id}`, fornecedor: { id, nome, cnpj: null }, status: 'rascunho' as const, previstoPara: null, atrasado: false,
      salvoPor: null, salvoEm: null, aprovadoPor: null, enviadoEm: null, alteradoPor: null, alteradoEm: null,
      itens: [{ codigo: 'S1', codigoPai: 'SHORT', quantidade: 4, sugerida: 4, recebida: 0, encerrado: false, codigoFornecedor: null }],
    });
    // id igual, nome com outra caixa/espaço/acento: é o mesmo fornecedor
    estado.data!.rascunhos = [rascunho('f1', 'FORNECEDÓR   a')];
    renderTela('/reposicao?produto=SHORT');
    expect(screen.getByText('Já está no rascunho de Fornecedor A.')).toBeInTheDocument();
    cleanup();
    // mesmo nome, id diferente: outro fornecedor
    estado.data!.rascunhos = [rascunho('f9', 'Fornecedor A')];
    renderTela('/reposicao?produto=SHORT');
    expect(screen.queryByText(/Já está no rascunho/)).toBeNull();
    cleanup();
    // família sem cadastro (id null): pelo nome normalizado
    estado.data!.familias[0]!.fornecedor = { id: null, nome: 'Fornecedor A' };
    estado.data!.rascunhos = [rascunho('f7', ' fornecedor  á ')];
    renderTela('/reposicao?produto=SHORT');
    expect(screen.getByText('Já está no rascunho de Fornecedor A.')).toBeInTheDocument();
  });

  it('pctEstimadoPelaFamilia > 0,5: faixa da loja e sem venda perdida', () => {
    estado.data!.resultado!.pctEstimadoPelaFamilia = 0.92;
    renderTela();
    expect(screen.getByText('92% dos itens que já venderam ainda têm a compra estimada pela família: cada um vendeu pouco até agora.')).toBeInTheDocument();
    expect(screen.queryByText(/venda perdida/i)).toBeNull();
  });

  it('faixa da loja: botão "i" abre a explicação (limiar de 6) e Esc devolve o foco', async () => {
    estado.data!.resultado!.pctEstimadoPelaFamilia = 0.92;
    renderTela();
    const user = userEvent.setup();
    const botao = screen.getByRole('button', { name: 'O que é estimado pela família' });
    await user.click(botao);
    expect(await screen.findByText(/6 unidades vendidas/)).toBeInTheDocument();
    expect(screen.getByText(/Pela família:/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/6 unidades vendidas/)).toBeNull();
    expect(botao).toHaveFocus();
  });

  it('fora da fase do aviso: card Ruptura mostra a venda perdida por dia (v × preço)', () => {
    renderTela();
    const card = screen.getByRole('button', { name: /^Ruptura/ });
    expect(within(card).getByText(/R\$\s?50,00\/dia de venda perdida/)).toBeInTheDocument();
  });

  it('card clicado filtra a lista', async () => {
    renderTela();
    expect(screen.getByText('Short Bermuda Mauricinho')).toBeInTheDocument();
    expect(screen.getByText('Calça Sarja Masculina')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /^Ruptura/ });
    await userEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Short Bermuda Mauricinho')).toBeNull();
    expect(screen.getByText('Calça Sarja Masculina')).toBeInTheDocument();
  });

  it('?urgencia=ruptura entra já filtrado', () => {
    renderTela('/reposicao?urgencia=ruptura');
    expect(screen.queryByText('Short Bermuda Mauricinho')).toBeNull();
    expect(screen.getByRole('button', { name: /^Ruptura/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('?produto=<codigo_pai> abre expandido, com célula "2 +4" (estoque e compra) e aria-label completo', () => {
    renderTela('/reposicao?produto=SHORT');
    const grid = screen.getByRole('grid');
    const cel = within(grid).getByRole('button', { name: /^Preto, P:/ });
    expect(within(cel).getByText('2')).toHaveClass('font-normal');
    expect(within(cel).getByText('+4')).toHaveClass('font-semibold');
    expect(within(grid).getByRole('button', { name: /^Cáqui, P:/ })).toHaveTextContent(/^4$/);
    expect(cel).toHaveAccessibleName('Preto, P: estoque 2, pedir 4, Pedir agora');
    expect(screen.getByRole('list', { name: 'Legenda do mapa' })).toHaveTextContent('+N = comprar N');
  });

  it('célula selecionada mantém o fundo de urgência e ganha o marcador (sem trocar o fundo)', async () => {
    renderTela('/reposicao?produto=SHORT');
    const cel = screen.getByRole('button', { name: /^Preto, P:/ });
    await userEvent.click(cel);
    expect(cel).toHaveClass('bg-warning/15', 'dark:bg-warning/20', 'after:bg-primary', 'after:absolute');
    expect(cel.className).not.toMatch(/(^|\s)bg-primary\//);
    expect(screen.getByRole('button', { name: /^Preto, M:/ })).not.toHaveClass('after:bg-primary');
  });

  it('número do card mantém o tamanho text-h2 junto da cor', () => {
    renderTela();
    expect(within(screen.getByRole('button', { name: /^Vai faltar/ })).getByText('0 SKUs')).toHaveClass('text-h2', 'text-muted-foreground');
    expect(within(screen.getByRole('button', { name: /^Ruptura/ })).getByText('1 SKU')).toHaveClass('text-h2', 'text-foreground');
  });

  it('vazio uniforme: o mesmo ponto discreto em todas as colunas, cada um com nome acessível; nenhum "-"', () => {
    renderTela('/reposicao?urgencia=em_dia');
    for (const nome of ['sem tendência', 'nada a caminho', 'nada a pedir']) {
      const vazios = screen.getAllByRole('img', { name: nome });
      expect(vazios.length).toBeGreaterThan(0);
      for (const v of vazios) { expect(v).toHaveTextContent('·'); expect(v).toHaveClass('text-muted-foreground'); }
    }
    expect(screen.queryByText('-')).toBeNull();
  });

  it('grade com overflow: esmaecido na borda direita até rolar ao fim', () => {
    const proto = HTMLElement.prototype;
    const orig = { sw: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'), cw: Object.getOwnPropertyDescriptor(proto, 'clientWidth') };
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => 500 });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 300 });
    try {
      const { container } = renderTela('/reposicao?produto=SHORT');
      expect(container.querySelector('[data-indicador-rolagem]')).not.toBeNull();
      const rolagem = screen.getByRole('grid').parentElement!;
      rolagem.scrollLeft = 200;
      fireEvent.scroll(rolagem);
      expect(container.querySelector('[data-indicador-rolagem]')).toBeNull();
    } finally {
      if (orig.sw) Object.defineProperty(proto, 'scrollWidth', orig.sw); else delete (proto as unknown as Record<string, unknown>).scrollWidth;
      if (orig.cw) Object.defineProperty(proto, 'clientWidth', orig.cw); else delete (proto as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('grade sem overflow: sem esmaecido', () => {
    const { container } = renderTela('/reposicao?produto=SHORT');
    expect(container.querySelector('[data-indicador-rolagem]')).toBeNull();
  });

  it('asterisco só quando parte da família é estimada; família toda estimada troca a legenda', () => {
    renderTela('/reposicao?produto=SHORT');
    const legenda = () => screen.getByRole('list', { name: 'Legenda do mapa' });
    expect(screen.getByRole('grid').querySelectorAll('.lucide-asterisk')).toHaveLength(1);
    expect(legenda()).toHaveTextContent('Estimado pela família');
    cleanup();
    estado.data!.resultado!.skus.forEach((x) => { x.poucoHistorico = true; });
    renderTela('/reposicao?produto=SHORT');
    expect(screen.getByRole('grid').querySelectorAll('.lucide-asterisk')).toHaveLength(0);
    expect(legenda()).toHaveTextContent('Todas estimadas pela família');
  });

  it('cabeçalho da coluna de ajuste diz "Tendência"; ordem fixa é texto, não controle', () => {
    renderTela();
    expect(screen.getAllByText('Tendência').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ajuste')).toBeNull();
    expect(screen.getByText('Ordenado por urgência')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Vai faltar/ })).getByText('0 SKUs')).toHaveClass('text-muted-foreground');
    expect(within(screen.getByRole('button', { name: /^Ruptura/ })).getByText('1 SKU')).toHaveClass('text-foreground');
  });

  it('célula de curva: aria-label e popover dizem que é estimado pela família', async () => {
    renderTela('/reposicao?produto=SHORT');
    const cel = screen.getByRole('button', { name: /^Preto, M:/ });
    expect(cel.getAttribute('aria-label')).toMatch(/estimado pelas outras cores e tamanhos/);
    await userEvent.click(cel);
    expect(await screen.findByText('Estimado pelas outras cores e tamanhos deste produto.')).toBeInTheDocument();
  });

  it('popover declara o limite das pausas', async () => {
    renderTela('/reposicao?produto=SHORT');
    await userEvent.click(screen.getByRole('button', { name: /^Preto, P:/ }));
    expect(await screen.findByText('Pausas do anúncio ainda não entram na conta.')).toBeInTheDocument();
  });

  it('"Por quê" com fator 1,2 e variação 0,4', () => {
    renderTela('/reposicao?produto=SHORT');
    expect(screen.getByText(/pedido \+20% \(vendas subiram 40% nas últimas 2 semanas\)/)).toBeInTheDocument();
  });

  it('produto sem variação não renderiza mapa', async () => {
    renderTela('/reposicao?produto=CINTO');
    expect(screen.getByText('Cinto Couro')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('Não repor: célula riscada e "Remover" chama removerNaoRepor(id)', async () => {
    renderTela('/reposicao?produto=SHORT');
    const cel = screen.getByRole('button', { name: /^Cáqui, M:/ });
    expect(cel).toHaveAttribute('data-nao-repor', 'true');
    expect(cel.className).toMatch(/line-through/);
    expect(cel).toHaveAccessibleName(/Não repor/);
    await userEvent.click(cel);
    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(acoes.removerNaoRepor).toHaveBeenCalledWith('nr-1');
  });

  it('Detalhe não tem mais o menu "Não repor ▾"', () => {
    renderTela('/reposicao?produto=SHORT');
    expect(screen.queryByRole('button', { name: /^Não repor/ })).toBeNull();
  });

  it('popover da célula: "Não repor este tamanho" marca só o SKU; célula marcada não oferece', async () => {
    renderTela('/reposicao?produto=SHORT');
    await userEvent.click(screen.getByRole('button', { name: /^Preto, P:/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Não repor este tamanho' }));
    expect(acoes.naoRepor).toHaveBeenCalledWith({ escopo: 'sku', codigoPai: 'SHORT', codigo: 'S1' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /^Cáqui, M:/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Não repor este tamanho' })).toBeNull();
  });

  describe('fora de linha (marcado no Estoque)', () => {
    const marcarFamilia = () => {
      const d = estado.data!;
      d.naoRepor.push({ id: 'nr-f', escopo: 'familia', codigoPai: 'CALCA', codigo: null, cor: null });
      d.skus = d.skus.map((x) => (x.codigoPai === 'CALCA' ? { ...x, naoReporId: 'nr-f' } : x));
    };
    const marcarCor = () => {
      const d = estado.data!;
      d.naoRepor.push({ id: 'nr-c', escopo: 'cor', codigoPai: 'SHORT', codigo: null, cor: 'Preto' });
      d.skus = d.skus.map((x) => (x.codigoPai === 'SHORT' && x.cor === 'Preto' ? { ...x, naoReporId: 'nr-c' } : x));
    };

    it('marca de produto: some da lista; o filtro o mostra esmaecido, com selo e "Abrir no Estoque"', async () => {
      marcarFamilia();
      renderTela();
      expect(screen.queryByText('Calça Sarja Masculina')).toBeNull();
      await userEvent.click(screen.getByRole('switch', { name: 'Mostrar fora de linha' }));
      const linha = screen.getByText('Calça Sarja Masculina').closest('li')!;
      expect(linha.className).toMatch(/opacity-60/);
      expect(within(linha).getByText('Fora de linha')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Calça Sarja Masculina/ }));
      expect(within(linha).getByRole('link', { name: 'Abrir no Estoque' })).toHaveAttribute('href', '/estoque');
      expect(within(linha).queryByRole('button', { name: 'Remover' })).toBeNull(); // a Reposição não desmarca
    });

    it('cor marcada: a linha some do mapa; com o filtro aparece esmaecida com selo', async () => {
      marcarCor();
      renderTela('/reposicao?produto=SHORT');
      const grade = screen.getByRole('grid');
      expect(within(grade).queryByRole('button', { name: /^Preto,/ })).toBeNull();
      expect(within(grade).getByRole('button', { name: /^Cáqui, P:/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Abrir no Estoque' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('switch', { name: 'Mostrar fora de linha' }));
      const g2 = screen.getByRole('grid');
      expect(within(g2).getByRole('button', { name: /^Preto, P:/ })).toBeInTheDocument();
      expect(within(g2).getByText('Fora de linha')).toBeInTheDocument();
      expect(within(g2).getByText('Fora de linha').closest('tr')!.className).toMatch(/opacity-60/);
    });

    it('cor marcada: os cards não contam o que está fora de linha', () => {
      renderTela();
      const card = () => within(screen.getByRole('button', { name: /^Pedir agora/ }));
      expect(card().getByText('2 SKUs')).toBeInTheDocument(); // S1 e S2 (Preto); S4 já está em Não repor
      cleanup();
      marcarCor();
      renderTela();
      expect(card().getByText('0 SKUs')).toBeInTheDocument();
    });

    it('SKU avulso marcado continua na grade, riscado', () => {
      renderTela('/reposicao?produto=SHORT');
      const cel = screen.getByRole('button', { name: /^Cáqui, M:/ });
      expect(cel.className).toMatch(/line-through/);
    });

    it('família sem nenhuma linha visível (todas as cores com marca de cor) não aparece', () => {
      const d = estado.data!;
      for (const cor of ['Preto', 'Cáqui']) d.naoRepor.push({ id: `nr-${cor}`, escopo: 'cor', codigoPai: 'SHORT', codigo: null, cor });
      d.skus = d.skus.map((x) => (x.codigoPai === 'SHORT' ? { ...x, naoReporId: `nr-${x.cor}` } : x));
      renderTela();
      expect(screen.queryByText('Short Bermuda Mauricinho')).toBeNull();
    });

    it('marca de tamanho na única célula de uma cor: linha e família continuam visíveis, riscadas', () => {
      const d = estado.data!;
      d.naoRepor.push({ id: 'nr-c1', escopo: 'sku', codigoPai: 'CALCA', codigo: 'C1', cor: null });
      d.skus = d.skus.map((x) => (x.codigo === 'C1' ? { ...x, naoReporId: 'nr-c1' } : x));
      renderTela('/reposicao?produto=CALCA');
      const cel = screen.getByRole('button', { name: /^Marrom, 42:/ });
      expect(cel.className).toMatch(/line-through/);
      expect(cel).toHaveAccessibleName(/Não repor/);
      expect(cel).not.toHaveAccessibleName(/Fora de linha/);
    });

    it('todas as células de uma cor marcadas por tamanho: a cor continua visível', () => {
      const d = estado.data!;
      d.naoRepor.push({ id: 'nr-s3', escopo: 'sku', codigoPai: 'SHORT', codigo: 'S3', cor: null });
      d.skus = d.skus.map((x) => (x.codigo === 'S3' ? { ...x, naoReporId: 'nr-s3' } : x)); // S4 (Cáqui M) já é marca de SKU
      renderTela('/reposicao?produto=SHORT');
      expect(screen.getByRole('button', { name: /^Cáqui, P:/ }).className).toMatch(/line-through/);
      expect(screen.getByRole('button', { name: /^Cáqui, M:/ }).className).toMatch(/line-through/);
      expect(screen.queryByText('Fora de linha')).toBeNull();
    });

    it('cor com marca de cor: o nome acessível da célula diz "Fora de linha", não "Não repor"', async () => {
      marcarCor();
      renderTela('/reposicao?produto=SHORT');
      await userEvent.click(screen.getByRole('switch', { name: 'Mostrar fora de linha' }));
      const cel = screen.getByRole('button', { name: /^Preto, P:/ });
      expect(cel).toHaveAccessibleName(/Fora de linha/);
      expect(cel).not.toHaveAccessibleName(/Não repor/);
    });
  });

  it('número do card em foreground e ícone colorido (contraste; cor na borda e no ícone)', () => {
    renderTela();
    const card = screen.getByRole('button', { name: /^Pedir agora/ });
    const numero = within(card).getByText(/SKUs?$/);
    expect(numero.className).toMatch(/text-foreground/);
    expect(numero.className).not.toMatch(/text-warning/);
    expect(card.querySelector('svg')?.getAttribute('class')).toMatch(/text-warning/);
  });

  it('popover de célula em Não repor não mostra pill de urgência', async () => {
    renderTela('/reposicao?produto=SHORT');
    await userEvent.click(screen.getByRole('button', { name: /^Cáqui, M:/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).queryByText('Pedir agora')).toBeNull();
    expect(within(dialogo).getByText(/Não repor/)).toBeInTheDocument();
  });

  it('Home/End vão para a primeira/última célula da linha', async () => {
    renderTela('/reposicao?produto=SHORT');
    screen.getByRole('button', { name: /^Preto, P:/ }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('button', { name: /^Preto, M:/ })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('button', { name: /^Preto, P:/ })).toHaveFocus();
  });

  it('erro de refetch com dados na tela: aviso discreto, dados continuam', () => {
    estado.isError = true;
    renderTela();
    expect(screen.getByText('Não foi possível atualizar agora; mostrando os últimos dados.')).toBeInTheDocument();
    expect(screen.getByText('Short Bermuda Mauricinho')).toBeInTheDocument();
  });

  it('setas movem o foco pela grade', async () => {
    renderTela('/reposicao?produto=SHORT');
    const p = screen.getByRole('button', { name: /^Preto, P:/ });
    p.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^Preto, M:/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}'); // cores A→Z: Cáqui fica acima de Preto
    expect(screen.getByRole('button', { name: /^Cáqui, M:/ })).toHaveFocus();
  });

  it('Adicionar ao pedido salva o rascunho do fornecedor só com o que tem a pedir e não está em Não repor', async () => {
    renderTela('/reposicao?produto=SHORT');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar ao pedido' }));
    expect(acoes.salvarRascunho).toHaveBeenCalledWith({
      fornecedorNome: 'Fornecedor A',
      itens: [
        { codigo: 'S1', codigoPai: 'SHORT', quantidade: 4, sugerida: 4 },
        { codigo: 'S2', codigoPai: 'SHORT', quantidade: 3, sugerida: 3 },
      ],
    });
  });

  it('tudo em dia: "Nada para pedir hoje."', () => {
    const d = estado.data!;
    d.resultado!.familias = d.resultado!.familias.map((f) => ({ ...f, pedir: 0, urgencia: 'em_dia' }));
    d.resultado!.skus = d.resultado!.skus.map((s) => ({ ...s, pedir: 0, urgencia: 'em_dia' }));
    renderTela();
    expect(screen.getByText('Nada para pedir hoje.')).toBeInTheDocument();
  });

  describe('completar grade (SKU nunca comprado)', () => {
    beforeEach(() => {
      const d = estado.data!;
      d.skus.push(tela({ codigo: 'S5', codigoPai: 'SHORT', cor: 'Preto', corHex: '#000000', tamanho: 'G' }));
      d.resultado!.skus.push(sug({
        codigo: 'S5', codigoPai: 'SHORT', estoqueHoje: 0, v: 0, pedir: 0, pedirAntesMultiplo: 0, urgencia: 'em_dia',
        unidades: 0, w: 0, diasDisponiveis: 0, completarGrade: 2,
      }));
    });

    it('célula mostra o estoque e o chip "completar +N" sem cor de urgência; legenda explica', () => {
      renderTela('/reposicao?produto=SHORT');
      const cel = screen.getByRole('button', { name: /^Preto, G:/ });
      expect(cel).toHaveTextContent('0completar +2');
      expect(cel).not.toHaveClass('bg-danger/15');
      expect(cel).not.toHaveClass('bg-warning/15');
      expect(cel).toHaveAccessibleName('Preto, G: estoque 0, completar 2, nunca comprado');
      expect(screen.getByRole('list', { name: 'Legenda do mapa' })).toHaveTextContent('completar +N = nunca comprado');
    });

    it('popover explica e "Incluir no pedido" põe o SKU com N no rascunho do fornecedor', async () => {
      renderTela('/reposicao?produto=SHORT');
      await userEvent.click(screen.getByRole('button', { name: /^Preto, G:/ }));
      const popover = await screen.findByRole('dialog');
      expect(popover).toHaveTextContent('Este tamanho/cor nunca foi comprado. Sugestão para completar a grade: 2. Não entra no pedido sozinho.');
      expect(within(popover).getByText('Nunca comprado')).toHaveAttribute('data-tone', 'neutral');
      expect(within(popover).queryByText('Em dia')).toBeNull();
      expect(within(popover).queryByText('Vendidos (60 dias)')).toBeNull(); // sem as linhas zeradas
      await userEvent.click(within(popover).getByRole('button', { name: 'Incluir no pedido' }));
      expect(acoes.salvarRascunho).toHaveBeenCalledWith({
        fornecedorNome: 'Fornecedor A', itens: [{ codigo: 'S5', codigoPai: 'SHORT', quantidade: 2, sugerida: 2 }],
      });
    });

    it('sem movimento mas com estoque (completarGrade 0): sem chip, célula normal', () => {
      const s5 = estado.data!.resultado!.skus.find((s) => s.codigo === 'S5')!;
      Object.assign(s5, { estoqueHoje: 5, completarGrade: 0 });
      renderTela('/reposicao?produto=SHORT');
      const cel = screen.getByRole('button', { name: /^Preto, G:/ });
      expect(cel).toHaveTextContent(/^5$/);
      expect(screen.getByRole('list', { name: 'Legenda do mapa' })).not.toHaveTextContent('nunca comprado');
    });

    it('popover aberto pelo teclado não foca "Incluir no pedido" (Enter duplo não inclui); Escape devolve o foco à célula', async () => {
      const user = userEvent.setup();
      renderTela('/reposicao?produto=SHORT');
      const cel = screen.getByRole('button', { name: /^Preto, G:/ });
      cel.focus();
      await user.keyboard('{Enter}');
      const popover = await screen.findByRole('dialog');
      const incluir = within(popover).getByRole('button', { name: 'Incluir no pedido' });
      // (a) foco no painel, não no botão
      expect(document.activeElement).not.toBe(incluir);
      expect(document.activeElement).toBe(popover);
      // (b) Enter logo após abrir não aciona nada
      await user.keyboard('{Enter}');
      expect(acoes.salvarRascunho).not.toHaveBeenCalled();
      // (c) o primeiro Tab cai no primeiro controle do painel
      await user.tab();
      expect(document.activeElement).toBe(incluir);
      // (d) Escape fecha e devolve o foco à célula
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(cel);
      expect(acoes.salvarRascunho).not.toHaveBeenCalled();
    });

    it('cards e "Adicionar ao pedido" ignoram o completar', async () => {
      renderTela('/reposicao?produto=SHORT');
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar ao pedido' }));
      const itens = acoes.salvarRascunho.mock.calls[0][0].itens as { codigo: string }[];
      expect(itens.map((i) => i.codigo)).not.toContain('S5');
    });
  });

  it('2 SKUs com alvo fracionado: o popover mostra o mesmo número da célula e explica a folga', async () => {
    // v = 0,05 nos dois, estoque 0: falta 1,5 cada; Λ = 3 → folga 2 → alvos 2,5 e 2,5; o maior resto dá 3 a um e 2 ao outro.
    const dia = (n: number) => new Date(Date.UTC(2026, 10, 16 + n)).toISOString().slice(0, 10);
    const movs = ['S1', 'S2'].flatMap((codigo) => Array.from({ length: 60 }, (_, i) => ({
      dia: dia(-60 + i), codigo, vendidas: i % 20 === 19 ? 1 : 0, precos: [], estoqueInicio: 1,
    })));
    const r = calcularReposicao({
      hoje: dia(0), prazo: 15, cobertura: 30, kits: [], pedidosAbertos: [], multiploPorFamilia: {}, movs,
      skus: ['S1', 'S2'].map((codigo, i) => ({ codigo, codigoPai: 'SHORT', cor: 'Preto', tamanho: i ? 'M' : 'P', estoqueHoje: 0, publicadoEm: '2026-01-01', naoRepor: false, ehKit: false, nuncaMovimentado: false })),
    });
    expect(r.skus.map((x) => x.pedir).sort()).toEqual([2, 3]);
    expect(r.skus.every((x) => x.pedirAntesMultiplo === 3)).toBe(true); // o número antigo do popover
    const d = estado.data!;
    d.resultado = { ...r, familias: [...r.familias, ...d.resultado!.familias.filter((f) => f.codigoPai !== 'SHORT')] };
    d.resultado.skus = [...r.skus, ...base().resultado!.skus.filter((x) => x.codigoPai !== 'SHORT')];
    d.skus = d.skus.filter((x) => x.codigo !== 'S3' && x.codigo !== 'S4');
    renderTela('/reposicao?produto=SHORT');
    for (const x of r.skus) {
      const nome = x.codigo === 'S1' ? /^Preto, P:/ : /^Preto, M:/;
      const cel = screen.getByRole('button', { name: nome });
      expect(cel).toHaveTextContent(`0+${x.pedir}`);
      await userEvent.click(cel);
      const popover = await screen.findByRole('dialog');
      expect(popover).toHaveTextContent(x.pedir === 3
        ? 'Pela média, faltam 2 para durar 30 dias; peça 3: 1 a mais de folga, para não faltar se vender um pouco acima da média.'
        : 'Para durar 30 dias, peça 2.');
      expect(popover).not.toHaveTextContent(/precisa de 3/);
      await userEvent.keyboard('{Escape}');
    }
  });
});

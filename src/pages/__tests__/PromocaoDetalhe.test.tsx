import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PromocaoDetalhe from '../PromocaoDetalhe';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import type { ItemPromocao, Promocao } from '@/lib/promocoes';

// supabase.functions é getter (cliente novo a cada acesso): spy não pega — troca só o invoke, mantém o resto.
const fns = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', async (orig) => {
  const m = await orig<typeof import('@/lib/supabase')>();
  const supabase = new Proxy(m.supabase, {
    get: (t, p) => { if (p === 'functions') return fns; const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; },
  });
  return { ...m, supabase };
});

vi.mock('@/hooks/usePromocoes', () => ({
  usePromocoes: vi.fn(), useItensPromocao: vi.fn(), usePaisPorItem: () => ({ data: undefined }),
}));

const promo = {
  promocao_id: 'P1', tipo: 'DEAL', nome: 'Campanha teste', status: 'started',
  inicio: null, fim: null, prazo_adesao: null, beneficios: null, contagem: null,
  erro: null, itens_sincronizados_em: null, rodada_em_curso: null,
} as Promocao;

const item = {
  ml_item_id: 'MLB1', status: 'candidate',
  preco_original: 100, preco_promo: 80, preco_min: 70, preco_max: 90,
  preco_sugerido: null, preco_avaliado: 80, ml_pct: 10, estoque_min: null,
  titulo: 'Anúncio teste', thumbnail: null, permalink: null,
  pior_semaforo: 'verde',
  projecao: [{ variation_id: 1, cor: 'Azul', sku: null, custo: 20, piso: 30, origem: 'nacional', liquido: 32, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null }],
} as unknown as ItemPromocao;

function renderDetalhe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/promocoes/P1']}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/promocoes/:promocaoId" element={<PromocaoDetalhe />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PromocaoDetalhe', () => {
  it('carregando os anúncios mostra a logo PubliAI pulsando uma vez só, sem tabela nem blocos cinza', async () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: undefined, isLoading: true } as never);

    renderDetalhe();

    expect(await screen.findByRole('status', { name: 'Carregando' })).toHaveTextContent('Lendo os anúncios da campanha…');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('lista-mobile')).toBeNull();
  });

  it('piso acima de toda a faixa não aparece como erro', () => {
    const semPreco = { ...item, projecao: item.projecao.map((c) => ({ ...c, ate_quanto_motivo: 'nenhum' })) } as ItemPromocao;
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [semPreco], isLoading: false } as never);

    renderDetalhe();

    const rotulos = screen.getAllByText('Piso fora da faixa');
    expect(rotulos.length).toBeGreaterThan(0);
    rotulos.forEach((r) => expect(r.className).not.toContain('text-danger'));
    expect(screen.queryByText('Sem preço viável')).toBeNull();
  });

  it('custo acima do piso e sem cobertura na faixa aparece como custo, em vermelho', () => {
    const semCusto = { ...item, projecao: item.projecao.map((c) => ({ ...c, custo: 50, piso: 30, ate_quanto_motivo: 'nenhum' })) } as ItemPromocao;
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [semCusto], isLoading: false } as never);

    renderDetalhe();

    screen.getAllByText('Custo fora da faixa').forEach((r) => expect(r.className).toContain('text-danger'));
    expect(screen.queryByText('Piso fora da faixa')).toBeNull();
  });

  it('convidado de campanha de preço fixo mostra "Preço fixo"; Relâmpago sem faixa e sem líquido seguem com —', () => {
    const fixo = { ...item, preco_min: null, preco_max: null } as ItemPromocao;
    const semLiquido = { ...fixo, ml_item_id: 'MLB2', projecao: fixo.projecao.map((c) => ({ ...c, liquido: null })) } as ItemPromocao;
    for (const tipo of ['SMART', 'SMART_LIGHTNING', 'PRICE_MATCHING']) {
      vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo }], isLoading: false } as never);
      vi.mocked(useItensPromocao).mockReturnValue({ data: [fixo, semLiquido], isLoading: false } as never);
      renderDetalhe();
      expect(screen.getAllByText('Preço fixo')).toHaveLength(1);
      cleanup();
    }
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'LIGHTNING' }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [fixo], isLoading: false } as never);
    renderDetalhe();
    expect(screen.queryByText('Preço fixo')).toBeNull();
  });

  it('Relâmpago: participando com convite de outro horário aparece em Convidados com o aviso (emenda 2026-11-08 (2))', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'LIGHTNING' }], isLoading: false } as never);
    const comConvite = { ...item, ml_item_id: 'MLB9', titulo: 'Máscara', status: 'pending', convite_aberto: true } as ItemPromocao;
    const soParticipa = { ...item, ml_item_id: 'MLB8', titulo: 'Shampoo', status: 'pending' } as ItemPromocao;
    vi.mocked(useItensPromocao).mockReturnValue({ data: [comConvite, soParticipa, item], isLoading: false } as never);
    renderDetalhe();
    expect(screen.getAllByText('Máscara').length).toBeGreaterThan(0);
    expect(screen.queryByText('Shampoo')).toBeNull();
    expect(screen.getAllByText('Já participa em outro horário').length).toBeGreaterThan(0);
  });

  it('convite de outro horário marcado em Convidados segue Aderir ao trocar de aba e no Selecionar todos (revisões Gemini e Grok)', async () => {
    const user = userEvent.setup();
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'LIGHTNING' }], isLoading: false } as never);
    const comConvite = { ...item, ml_item_id: 'MLB9', titulo: 'Máscara', status: 'pending', convite_aberto: true } as ItemPromocao;
    const outro = { ...item, ml_item_id: 'MLB8', titulo: 'Shampoo', status: 'pending' } as ItemPromocao;
    vi.mocked(useItensPromocao).mockReturnValue({ data: [comConvite, outro], isLoading: false } as never);
    renderDetalhe();
    await user.click(screen.getAllByRole('checkbox', { name: /Selecionar.*MLB9/ })[0]);
    expect(screen.getByRole('button', { name: /Aderir 1/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Participando' }));
    expect(screen.queryByRole('button', { name: /Sair 1/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Aderir 1/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox', { name: 'Selecionar todos' })[0]);
    expect(screen.getByRole('button', { name: /Aderir 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sair 1/ })).toBeInTheDocument();
  });

  it('renderiza a tabela com uma linha que tem ml_pct sem erro de TooltipProvider', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    expect(screen.getAllByText('Campanha teste').length).toBeGreaterThan(0);
    // Título aparece na linha da tabela desktop e no cartão da lista mobile (jsdom não aplica a media query, os dois layouts existem no DOM).
    expect(screen.getAllByText('Anúncio teste').length).toBeGreaterThan(0);
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('convidado abaixo de R$ 19 some da aba; sem preço avaliado continua', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    const abaixo = { ...item, ml_item_id: 'MLB2', titulo: 'Barato demais', preco_avaliado: 16.53 } as ItemPromocao;
    const noPiso = { ...item, ml_item_id: 'MLB3', titulo: 'No piso', preco_avaliado: 19 } as ItemPromocao;
    const semPreco = { ...item, ml_item_id: 'MLB4', titulo: 'Sem preço', preco_avaliado: null } as ItemPromocao;
    vi.mocked(useItensPromocao).mockReturnValue({ data: [abaixo, noPiso, semPreco], isLoading: false } as never);

    renderDetalhe();

    expect(screen.queryByText('Barato demais')).toBeNull();
    expect(screen.getAllByText('No piso').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sem preço').length).toBeGreaterThan(0);
  });

  it('participante abaixo de R$ 19 continua visível para poder sair', async () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    const participa = { ...item, status: 'started', titulo: 'Participa barato', preco_avaliado: 16.53 } as ItemPromocao;
    vi.mocked(useItensPromocao).mockReturnValue({ data: [participa], isLoading: false } as never);

    renderDetalhe();
    await userEvent.setup().click(screen.getByRole('tab', { name: /Participando/ }));

    expect(screen.getAllByText('Participa barato').length).toBeGreaterThan(0);
  });

  it('mostra líquido e markup no cartão mobile e abre o sheet ao clicar', async () => {
    const user = userEvent.setup();
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    const lista = within(screen.getByTestId('lista-mobile'));
    expect(lista.getByText('R$ 32,00')).toBeTruthy();
    expect(lista.getByText('+60%')).toBeTruthy();

    await user.click(lista.getByRole('button'));
    expect(within(screen.getByRole('dialog')).getByText('Anúncio teste')).toBeTruthy();
  });

  it('Relâmpago tem checkbox de seleção', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'LIGHTNING' }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    expect(screen.getAllByLabelText('Selecionar MLB1').length).toBeGreaterThan(0);
  });

  it.each(['SMART_LIGHTNING', 'PRICE_MATCHING'])('%s tem checkbox de seleção e não mostra o aviso de Seller Center', (tipo) => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);
    renderDetalhe();
    expect(screen.getAllByLabelText('Selecionar MLB1').length).toBeGreaterThan(0);
    expect(screen.queryByText('Este tipo de campanha ainda não pode ser ativado pelo PubliAI. Use o Seller Center.')).not.toBeInTheDocument();
  });

  it('tipo desconhecido (VOLUME) avisa que só o Seller Center ativa; PRICE_DISCOUNT segue sem seleção', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'VOLUME' }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);
    renderDetalhe();
    expect(screen.getByText('Este tipo de campanha ainda não pode ser ativado pelo PubliAI. Use o Seller Center.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Selecionar MLB1')).not.toBeInTheDocument();
  });

  it('não mostra seleção quando o tipo da campanha não é operável', () => {
    vi.mocked(usePromocoes).mockReturnValue({ data: [{ ...promo, tipo: 'PRICE_DISCOUNT' }], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();

    expect(screen.queryByLabelText('Selecionar MLB1')).not.toBeInTheDocument();
  });

  it('seleciona convidado e participando em abas diferentes e abre o preview de Aderir', async () => {
    const user = userEvent.setup();
    const participando = { ...item, ml_item_id: 'MLB2', status: 'started', titulo: 'Anúncio participando' } as ItemPromocao;
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item, participando], isLoading: false } as never);

    renderDetalhe();
    const tabela = within(screen.getByRole('region', { name: 'Tabela de dados' }));

    await user.click(tabela.getByLabelText('Selecionar MLB1'));
    await user.click(screen.getByRole('tab', { name: 'Participando' }));
    await user.click(tabela.getByLabelText('Selecionar MLB2'));

    expect(screen.getByRole('button', { name: 'Aderir 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aderir 1' }));
    expect(within(screen.getByRole('dialog')).getByText('Aderir à Campanha teste')).toBeTruthy();
  });

  it('achado 2 (revisão): fechar o preview sem executar mantém a seleção', async () => {
    const user = userEvent.setup();
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [item], isLoading: false } as never);

    renderDetalhe();
    const tabela = within(screen.getByRole('region', { name: 'Tabela de dados' }));
    await user.click(tabela.getByLabelText('Selecionar MLB1'));
    await user.click(screen.getByRole('button', { name: 'Aderir 1' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aderir 1' })).toBeInTheDocument();
  });

  // Emenda 2026-11-03: alterar o preço de quem já participa (DEAL) a partir da aba Participando.
  it('Participando (DEAL): Alterar preço N abre o painel de alteração', async () => {
    const user = userEvent.setup();
    const participa = { ...item, ml_item_id: 'MLB2', status: 'started', preco_promo: 49.9, preco_avaliado: 49.9, titulo: 'Jaqueta' } as ItemPromocao;
    vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
    vi.mocked(useItensPromocao).mockReturnValue({ data: [participa], isLoading: false } as never);
    fns.invoke.mockResolvedValue({ data: { itens: [] }, error: null });
    renderDetalhe();
    await user.click(screen.getByRole('tab', { name: 'Participando' }));
    const tabela = within(screen.getByRole('region', { name: 'Tabela de dados' }));
    await user.click(tabela.getByLabelText('Selecionar MLB2'));
    await user.click(screen.getByRole('button', { name: 'Alterar preço 1' }));
    expect(within(screen.getByRole('dialog')).getByText('Alterar preço em Campanha teste')).toBeTruthy();
    fns.invoke.mockReset();
  });

  // Emenda ADR-0174 (2026-11-03): busca + mesmo desconto/preço para um produto e suas variações.
  describe('busca e simulação', () => {
    const short = { ...item, ml_item_id: 'MLB1', titulo: 'Short Linho Azul' } as ItemPromocao;
    const calca = { ...item, ml_item_id: 'MLB2', titulo: 'Calça Sarja' } as ItemPromocao;
    const corSim = { ...item.projecao[0], liquido: 55.55, semaforo: 'verde' };
    const montar = () => {
      vi.mocked(usePromocoes).mockReturnValue({ data: [promo], isLoading: false } as never);
      vi.mocked(useItensPromocao).mockReturnValue({ data: [short, calca], isLoading: false } as never);
      renderDetalhe();
      return within(screen.getByRole('region', { name: 'Tabela de dados' }));
    };

    it('a busca filtra as linhas e o "Selecionar todos" marca só o resultado', async () => {
      const user = userEvent.setup();
      const tabela = montar();
      await user.type(screen.getByLabelText('Buscar anúncios da campanha'), 'short');
      expect(tabela.queryByLabelText('Selecionar MLB2')).toBeNull();
      await user.click(tabela.getByLabelText('Selecionar todos'));
      expect(screen.getByRole('button', { name: 'Aderir 1' })).toBeInTheDocument();
    });

    it('preço digitado em Desconto % avisa na hora e não simula', async () => {
      const user = userEvent.setup();
      const tabela = montar();
      await user.click(tabela.getByLabelText('Selecionar MLB1'));
      await user.click(screen.getByRole('tab', { name: 'Desconto %' }));
      await user.type(screen.getByLabelText('Desconto em %'), '159,90');
      expect(screen.getByText('Desconto vai até 99%. Para digitar o preço, escolha Preço R$.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Simular 1' })).toBeDisabled();
    });

    it('simula o desconto no servidor e mostra o líquido devolvido; Aderir usa o preço simulado', async () => {
      const user = userEvent.setup();
      const invoke = fns.invoke.mockResolvedValue({
        data: { itens: [{ ml_item_id: 'MLB1', status: 'simulado', preco: 90, projecao: [corSim], pior_semaforo: 'verde' }] }, error: null,
      } as never);
      const tabela = montar();
      await user.click(tabela.getByLabelText('Selecionar MLB1'));
      await user.click(screen.getByRole('tab', { name: 'Desconto %' }));
      await user.type(screen.getByLabelText('Desconto em %'), '10');
      await user.click(screen.getByRole('button', { name: 'Simular 1' }));

      await waitFor(() => expect(invoke).toHaveBeenCalledWith('operacoes-massa', {
        body: { etapa: 'simular', promocao_id: 'P1', itens: [{ ml_item_id: 'MLB1', preco: 90 }] },
      }));
      expect(await tabela.findByText('R$ 55,55')).toBeTruthy();
      expect(tabela.getByText('simulado')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Aderir 1' }));
      expect(within(screen.getByRole('dialog')).getByDisplayValue('90,00')).toBeTruthy();
      invoke.mockReset();
    });

    it('achado 4 (Codex): resposta que chega depois de trocar de aba é descartada', async () => {
      const user = userEvent.setup();
      let responder!: (v: unknown) => void;
      const invoke = fns.invoke.mockReturnValue(new Promise((r) => { responder = r; }) as never);
      const tabela = montar();
      await user.click(tabela.getByLabelText('Selecionar MLB1'));
      await user.click(screen.getByRole('tab', { name: 'Desconto %' }));
      await user.type(screen.getByLabelText('Desconto em %'), '10');
      await user.click(screen.getByRole('button', { name: 'Simular 1' }));
      await user.click(screen.getByRole('tab', { name: 'Participando' }));
      await user.click(screen.getByRole('tab', { name: 'Convidados' }));
      responder({ data: { itens: [{ ml_item_id: 'MLB1', status: 'simulado', preco: 90, projecao: [corSim], pior_semaforo: 'verde' }] }, error: null });
      await new Promise((r) => setTimeout(r, 0));
      expect(tabela.queryByText('simulado')).toBeNull();
      invoke.mockReset();
    });
  });
});

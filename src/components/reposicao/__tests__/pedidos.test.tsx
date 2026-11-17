// Spec 2026-11-16-reposicao §3.5 (Task 8): barra de rascunho, Sheet do pedido, aprovação, WhatsApp e aba Pedidos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { diaBRT } from '@/lib/calendario-brt';
import type { PedidoDTO, PedidoItemDTO, RespostaReposicao, SkuTela, StatusPedido } from '../../../../supabase/functions/_shared/reposicao/tipos';
import type { SugestaoSku } from '../../../../supabase/functions/_shared/reposicao/calculo';

const acoes = {
  salvarConfig: vi.fn(), salvarRascunho: vi.fn(), aprovar: vi.fn(), marcarEnviado: vi.fn(), editarPedido: vi.fn(),
  encerrarSaldo: vi.fn(), reabrirSaldo: vi.fn(), naoRepor: vi.fn(), removerNaoRepor: vi.fn(), definirMultiplo: vi.fn(),
};
const estado: { data: RespostaReposicao | undefined; admin: boolean } = { data: undefined, admin: true };
vi.mock('@/hooks/useReposicao', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useReposicao')>()),
  useReposicao: () => ({ data: estado.data, isLoading: false, isError: false, error: null, refetch: vi.fn(), pendente: false, ...acoes }),
}));
vi.mock('@/hooks/useOperacoes', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useOperacoes')>()),
  usePodeExecutarOperacao: () => estado.admin,
}));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: undefined }) }));

import Reposicao from '@/pages/Reposicao';

const HOJE = diaBRT(Date.now());
const diasAtras = (n: number) => new Date(Date.parse(`${HOJE}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function sug(p: Partial<SugestaoSku> & { codigo: string; codigoPai: string }): SugestaoSku {
  return {
    propria: 0.2, diasDisponiveis: 40, unidades: 8, w: 1, usada: 0.2, picoLimitadoEm: [], vendasEmOferta: 0,
    estoqueHoje: 2, v: 0.25, aCaminho: 0, chegaEm: null, diasDeEstoque: 8, pedirAntesMultiplo: 4, pedir: 4,
    urgencia: 'pedir_agora', poucoHistorico: false, ...p,
  };
}
const tela = (p: Partial<SkuTela> & { codigo: string; codigoPai: string }): SkuTela =>
  ({ cor: null, corHex: null, tamanho: null, custo: 10, preco: 50, naoReporId: null, ...p });
const item = (codigo: string, quantidade: number, p: Partial<PedidoItemDTO> = {}): PedidoItemDTO =>
  ({ codigo, codigoPai: codigo.startsWith('S') ? 'SHORT' : 'CALCA', quantidade, sugerida: quantidade, recebida: 0, encerrado: false, codigoFornecedor: null, ...p });
function pedido(id: string, status: StatusPedido, itens: PedidoItemDTO[], p: Partial<PedidoDTO> = {}): PedidoDTO {
  return {
    id, fornecedor: { id: 'f1', nome: 'Fornecedor A', cnpj: null }, status, previstoPara: '2099-12-01', atrasado: false,
    salvoPor: 'Diego', salvoEm: '2026-11-16T17:02:00Z', aprovadoPor: null, enviadoEm: null, alteradoPor: null, alteradoEm: null,
    itens, ...p,
  };
}

function base(): RespostaReposicao {
  return {
    config: { prazo: 15, cobertura: 30 },
    resultado: {
      pctEstimadoPelaFamilia: 0.2,
      familias: [
        { codigoPai: 'SHORT', pedir: 7, pedirAntesMultiplo: 7, tendencia: null, urgencia: 'pedir_agora' },
        { codigoPai: 'CALCA', pedir: 6, pedirAntesMultiplo: 6, tendencia: null, urgencia: 'ruptura' },
      ],
      skus: [
        sug({ codigo: 'S1', codigoPai: 'SHORT', pedir: 4 }),
        sug({ codigo: 'S2', codigoPai: 'SHORT', pedir: 3 }),
        sug({ codigo: 'C1', codigoPai: 'CALCA', estoqueHoje: 0, pedir: 6, urgencia: 'ruptura' }),
      ],
    },
    skus: [
      tela({ codigo: 'S1', codigoPai: 'SHORT', cor: 'Preto', tamanho: 'P' }),
      tela({ codigo: 'S2', codigoPai: 'SHORT', cor: 'Preto', tamanho: 'M' }),
      tela({ codigo: 'C1', codigoPai: 'CALCA', cor: 'Marrom', tamanho: '42' }),
    ],
    familias: [
      { codigoPai: 'SHORT', nome: 'Short Bermuda', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
      { codigoPai: 'CALCA', nome: 'Calça Sarja', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
    ],
    naoRepor: [],
    rascunhos: [pedido('r1', 'rascunho', [item('S1', 4), item('S2', 3)])],
    pedidos: [],
  };
}

function renderTela(rota = '/reposicao') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arvore = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}><Reposicao /></MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(arvore());
  return { ...r, rerenderTela: () => r.rerender(arvore()) };
}

beforeEach(() => {
  estado.data = base();
  estado.admin = true;
  Object.values(acoes).forEach((f) => f.mockReset().mockResolvedValue({ ok: true }));
});
afterEach(cleanup);

async function abrirRascunho(user = userEvent.setup()) {
  renderTela();
  const barra = screen.getByRole('region', { name: 'Rascunhos de pedido' });
  await user.click(within(barra).getByRole('button', { name: 'Revisar rascunho de Fornecedor A' }));
  return { user, sheet: await screen.findByRole('dialog', { name: /Fornecedor A/ }) };
}

describe('Reposição — rascunho e pedido', () => {
  it('barra mostra o rascunho do fornecedor: unidades, R$, quem salvou e quando', () => {
    renderTela();
    const barra = screen.getByRole('region', { name: 'Rascunhos de pedido' });
    expect(within(barra).getByText('Fornecedor A')).toBeInTheDocument();
    expect(within(barra).getByText(/7 un\./)).toBeInTheDocument();
    expect(within(barra).getByText(/R\$\s*70,00/)).toBeInTheDocument();
    expect(within(barra).getByText(/salvo 16\/11 14:02 por Diego/)).toBeInTheDocument();
  });

  it('celular: botão flutuante "Pedidos (N)" abre diálogo', () => {
    renderTela();
    expect(screen.getByRole('button', { name: 'Pedidos (1)' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('item sem custo: barra e Sheet avisam "· N sem custo" ao lado do R$', async () => {
    estado.data!.skus[1] = { ...estado.data!.skus[1]!, custo: null };
    renderTela();
    const barra = screen.getByRole('region', { name: 'Rascunhos de pedido' });
    expect(within(barra).getByText(/R\$\s*40,00 · 1 sem custo/)).toBeInTheDocument();
    await userEvent.setup().click(within(barra).getByRole('button', { name: 'Revisar rascunho de Fornecedor A' }));
    const sheet = await screen.findByRole('dialog', { name: /Fornecedor A/ });
    expect(within(sheet).getByText(/R\$\s*40,00 · 1 sem custo/)).toHaveAttribute('title', expect.stringMatching(/sem custo cadastrado/));
  });

  it('rascunho alterado por outro membro com o Sheet aberto: recarrega as quantidades e avisa', async () => {
    const user = userEvent.setup();
    const t = renderTela();
    await user.click(within(screen.getByRole('region', { name: 'Rascunhos de pedido' })).getByRole('button', { name: 'Revisar rascunho de Fornecedor A' }));
    const sheet = await screen.findByRole('dialog', { name: /Fornecedor A/ });
    const campo = () => within(sheet).getByRole('textbox', { name: /Quantidade de Short Bermuda Preto P/ });
    await user.clear(campo());
    await user.type(campo(), '6');
    estado.data = { ...estado.data!, rascunhos: [pedido('r1', 'rascunho', [item('S1', 9), item('S2', 3)], { salvoEm: '2026-11-16T18:00:00Z', salvoPor: 'Ana' })] };
    t.rerenderTela();
    expect(campo()).toHaveValue('9');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Ana salvou este pedido');
  });

  it('Adicionar ao pedido cria/atualiza o rascunho do fornecedor', async () => {
    const user = userEvent.setup();
    renderTela('/reposicao?produto=SHORT');
    await user.click(screen.getByRole('button', { name: 'Adicionar ao pedido' }));
    expect(acoes.salvarRascunho).toHaveBeenCalledWith(expect.objectContaining({ fornecedorNome: 'Fornecedor A' }));
  });

  it('quantidade editada mostra a sugerida ao lado e salva o rascunho', async () => {
    const { user, sheet } = await abrirRascunho();
    const campo = within(sheet).getByRole('textbox', { name: /Quantidade de Short Bermuda Preto P/ });
    expect(within(sheet).queryByText('sugerida 4')).toBeNull();
    await user.clear(campo);
    await user.type(campo, '6');
    expect(within(sheet).getByText('sugerida 4')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Salvar rascunho' }));
    expect(acoes.salvarRascunho).toHaveBeenCalledWith(expect.objectContaining({
      fornecedorNome: 'Fornecedor A', pedidoId: 'r1',
      itens: [
        { codigo: 'S1', codigoPai: 'SHORT', quantidade: 6, sugerida: 4 },
        { codigo: 'S2', codigoPai: 'SHORT', quantidade: 3, sugerida: 3 },
      ],
    }));
  });

  it('não admin vê "Aprovar pedido" desabilitado com a dica', async () => {
    estado.admin = false;
    const { sheet } = await abrirRascunho();
    expect(within(sheet).getByRole('button', { name: 'Aprovar pedido' })).toBeDisabled();
    expect(within(sheet).getByText('Só administrador aprova o pedido')).toBeInTheDocument();
  });

  it('aprovar reaproveita a mesma ref na retentativa', async () => {
    acoes.aprovar.mockRejectedValueOnce(new Error('Não foi possível falar com o servidor.'));
    const { user, sheet } = await abrirRascunho();
    await user.click(within(sheet).getByRole('button', { name: 'Aprovar pedido' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor.');
    await user.click(within(sheet).getByRole('button', { name: 'Aprovar pedido' }));
    expect(acoes.aprovar).toHaveBeenCalledTimes(2);
    const [a, b] = acoes.aprovar.mock.calls.map((c) => c[0]);
    expect(a).toEqual({ pedidoId: 'r1', ref: expect.any(String) });
    expect(b.ref).toBe(a.ref);
  });

  it('"Copiar para WhatsApp" copia o texto e chama marcar_enviado', async () => {
    estado.data!.pedidos = [pedido('p1', 'aprovado', [item('S1', 4), item('S2', 2)], { aprovadoPor: 'Diego' })];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    await user.click(screen.getByRole('button', { name: 'Abrir pedido de Fornecedor A' }));
    const sheet = await screen.findByRole('dialog', { name: /Fornecedor A/ });
    await user.click(within(sheet).getByRole('button', { name: 'Copiar para WhatsApp' }));
    expect(await navigator.clipboard.readText()).toContain('Short Bermuda Preto: P×4 M×2');
    expect(acoes.marcarEnviado).toHaveBeenCalledWith({ pedidoId: 'p1' });
  });

  it('não admin em pedido aprovado: sem "Salvar alterações", quantidades e data só leitura, com a dica; no rascunho edita', async () => {
    estado.admin = false;
    estado.data!.pedidos = [pedido('p1', 'aprovado', [item('S1', 4)], { aprovadoPor: 'Diego' })];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    await user.click(screen.getByRole('button', { name: 'Abrir pedido de Fornecedor A' }));
    const sheet = await screen.findByRole('dialog', { name: /Fornecedor A/ });
    expect(within(sheet).queryByRole('button', { name: 'Salvar alterações' })).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: /Quantidade de/ })).toBeNull();
    expect(within(sheet).getByLabelText('Entrega prevista')).toBeDisabled();
    expect(within(sheet).getByText('Só administrador altera pedido aprovado')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Copiar para WhatsApp' })).toBeEnabled();
    cleanup();
    const r = await abrirRascunho();
    expect(within(r.sheet).getByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument();
  });

  it('editar pedido com recebimento mostra a recusa', async () => {
    acoes.editarPedido.mockRejectedValueOnce(new Error('o pedido já teve recebimento e não pode mais ser editado'));
    estado.data!.pedidos = [pedido('p1', 'enviado', [item('S1', 4)])];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    await user.click(screen.getByRole('button', { name: 'Abrir pedido de Fornecedor A' }));
    const sheet = await screen.findByRole('dialog', { name: /Fornecedor A/ });
    const campo = within(sheet).getByRole('textbox', { name: /Quantidade de Short Bermuda Preto P/ });
    await user.clear(campo);
    await user.type(campo, '5');
    await user.click(within(sheet).getByRole('button', { name: 'Salvar alterações' }));
    expect(acoes.editarPedido).toHaveBeenCalledWith({ pedidoId: 'p1', previstoPara: '2099-12-01', itens: [{ codigo: 'S1', quantidade: 5 }] });
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('o pedido já teve recebimento e não pode mais ser editado');
  });
});

describe('Reposição — aba Pedidos', () => {
  it('mostra os 6 estados, "Atrasado" e o atraso em dias', async () => {
    estado.data!.pedidos = [
      pedido('p1', 'aprovado', [item('S1', 4)]),
      pedido('p2', 'enviado', [item('S1', 4)], { previstoPara: diasAtras(3), atrasado: true }),
      pedido('p3', 'parcial', [item('S1', 4, { recebida: 2 })]),
      pedido('p4', 'recebido', [item('S1', 4, { recebida: 4 })]),
      pedido('p5', 'saldo_encerrado', [item('C1', 6, { recebida: 2, encerrado: true })]),
    ];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    const lista = screen.getByRole('list', { name: 'Pedidos de compra' });
    for (const s of ['Rascunho', 'Aprovado', 'Enviado', 'Parcial', 'Recebido', 'Saldo encerrado']) {
      expect(within(lista).getAllByText(s).length).toBeGreaterThan(0);
    }
    expect(within(lista).getByText('Atrasado · 3 dias')).toBeInTheDocument();
  });

  it('detalhe mostra pedido × recebido e "Reabrir saldo" no item encerrado', async () => {
    estado.data!.pedidos = [pedido('p5', 'saldo_encerrado', [item('C1', 6, { recebida: 2, encerrado: true })])];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    const lista = screen.getByRole('list', { name: 'Pedidos de compra' });
    const linhas = within(lista).getAllByRole('listitem');
    const card = linhas.find((l) => within(l).queryByText('Saldo encerrado'))!;
    await user.click(within(card).getByRole('button', { name: /Ver itens/ }));
    expect(within(card).getByText('2 de 6')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Reabrir saldo de Calça Sarja Marrom 42' }));
    expect(acoes.reabrirSaldo).toHaveBeenCalledWith({ pedidoId: 'p5', codigos: ['C1'] });
  });

  it('Encerrar saldo pede confirmação listando os itens e o saldo de cada um', async () => {
    estado.data!.rascunhos = [];
    estado.data!.pedidos = [pedido('p3', 'parcial', [item('S1', 4, { recebida: 1 }), item('S2', 3, { recebida: 3 })])];
    const user = userEvent.setup();
    renderTela();
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }));
    await user.click(screen.getByRole('button', { name: 'Ver itens de Fornecedor A' }));
    await user.click(screen.getByRole('button', { name: 'Encerrar saldo' }));
    expect(acoes.encerrarSaldo).not.toHaveBeenCalled();
    const dlg = await screen.findByRole('alertdialog');
    expect(within(dlg).getByText('Short Bermuda Preto P')).toBeInTheDocument();
    expect(within(dlg).getByText('faltam 3')).toBeInTheDocument();
    expect(within(dlg).queryByText(/Preto M/)).toBeNull();
    await user.click(within(dlg).getByRole('button', { name: 'Encerrar saldo' }));
    expect(acoes.encerrarSaldo).toHaveBeenCalledWith({ pedidoId: 'p3' });
  });
});

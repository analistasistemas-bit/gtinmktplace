import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewReajuste } from '../preview-reajuste';
import { ErroOperacao, useConfirmarReajuste, usePodeExecutarOperacao, usePreviewReajuste } from '@/hooks/useOperacoes';
import { calcularAlvo, type Avaliacao, type CorAvaliada, type ItemPreview } from '@/lib/reajuste';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return { ...actual, usePreviewReajuste: vi.fn(), useConfirmarReajuste: vi.fn(), usePodeExecutarOperacao: vi.fn() };
});

const ajuste = { tipo: 'pct' as const, sentido: '+' as const, valor: 10 };
function cor(over: Partial<CorAvaliada> = {}): CorAvaliada {
  return {
    variation_id: 'V1', sku: 'SKU1', custo: 5, piso: 6, origem: 'nacional', aliquota_pct: 8, comissao_pct: 12, comissao_fixa: 0,
    frete: 0, liquido: 8, semaforo: 'verde', motivo: null, ...over,
  };
}
function avaliacao(cores: CorAvaliada[]): Avaliacao {
  return {
    cores, pior: cores.some((c) => c.semaforo === 'vermelho') ? 'vermelho' : cores.some((c) => c.semaforo === 'indisponivel') ? 'indisponivel' : cores[0].semaforo,
    tem_vermelho: cores.some((c) => c.semaforo === 'vermelho'), tem_sem_dado: cores.some((c) => c.semaforo === 'indisponivel'),
  };
}
function item(ml: string, over: Partial<ItemPreview> = {}): ItemPreview {
  const preco_anterior = 10;
  const a = over.avaliacao ?? avaliacao([cor()]);
  return {
    ml_item_id: ml, codigo_pai: 'P1', variacao_ids: ['V1'], titulo: `Produto ${ml}`, sku: null,
    preco_anterior, preco: calcularAlvo(preco_anterior, ajuste)!, avaliacao: a, restaurar: [], variacoes_ml: null,
    situacao: 'elegivel', motivo: null, incluido: !(a.tem_vermelho || a.tem_sem_dado), aviso: null, ...over,
  };
}
const expira = () => new Date(Date.now() + 30 * 60_000).toISOString();

const previewMut = vi.fn();
const confirmarMut = vi.fn();
beforeEach(() => {
  previewMut.mockReset();
  confirmarMut.mockReset().mockResolvedValue({ operacao_id: 'OP1' });
  vi.mocked(usePreviewReajuste).mockReturnValue({ mutateAsync: previewMut, isPending: false } as never);
  vi.mocked(useConfirmarReajuste).mockReturnValue({ mutateAsync: confirmarMut, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
});

const vermelho = () => item('MLB2', { avaliacao: avaliacao([cor({ semaforo: 'vermelho', liquido: 4 })]) });
const semDado = () => item('MLB3', { avaliacao: avaliacao([cor({ semaforo: 'indisponivel', liquido: null, motivo: 'sem_origem' })]) });

function montar(itens: ItemPreview[], props: Partial<Parameters<typeof PreviewReajuste>[0]> = {}) {
  previewMut.mockResolvedValue({ operacao_id: 'OP1', itens, expira_em: expira() });
  const onCriada = vi.fn();
  render(<PreviewReajuste pedido={{ ml_item_ids: itens.map((i) => i.ml_item_id), ajuste }} onFechar={() => {}} onCriada={onCriada} {...props} />);
  return onCriada;
}
const botao = () => screen.getByRole('button', { name: /^Reajustar \d+ anúncio/ });

describe('PreviewReajuste', () => {
  it('mostra o alvo de calcularAlvo, o líquido da pior cor e a fixação (D1)', async () => {
    montar([item('MLB1')]);
    const input = await screen.findByLabelText('Novo preço de MLB1');
    expect(input).toHaveValue(calcularAlvo(10, ajuste)!.toFixed(2).replace('.', ','));
    expect(screen.getByText(/Líquido R\$\s8,00 · \+60%/)).toBeInTheDocument();
    expect(screen.getByText(/re-ingest deixa de recalcular/)).toBeInTheDocument();
    expect(previewMut).toHaveBeenCalledTimes(1);
    expect(previewMut).toHaveBeenCalledWith({ ml_item_ids: ['MLB1'], ajuste });
  });

  it('🔴 e ⚪ vêm desmarcados e as confirmações só aparecem com incluídos daquela cor', async () => {
    montar([item('MLB1'), vermelho(), semDado()]);
    expect(await screen.findByLabelText('Incluir MLB2')).not.toBeChecked();
    expect(screen.getByLabelText('Incluir MLB3')).not.toBeChecked();
    expect(screen.getByLabelText('Incluir MLB1')).toBeChecked();
    expect(screen.queryByText(/Assumo o prejuízo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Assumo os itens ⚪/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reajustar preço de 1 anúncio' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Incluir MLB2'));
    expect(screen.getByText(/Assumo o prejuízo nos itens 🔴 incluídos/)).toBeInTheDocument();
    expect(screen.queryByText(/Assumo os itens ⚪/)).not.toBeInTheDocument();
  });

  it('executar exige as duas confirmações e as envia por item', async () => {
    const onCriada = montar([item('MLB1'), vermelho(), semDado()]);
    await userEvent.click(await screen.findByLabelText('Incluir MLB2'));
    await userEvent.click(screen.getByLabelText('Incluir MLB3'));
    expect(botao()).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Assumo o prejuízo/));
    expect(botao()).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Assumo os itens ⚪/));
    expect(botao()).toHaveTextContent('Reajustar 3 anúncios');
    await userEvent.click(botao());
    expect(confirmarMut).toHaveBeenCalledWith({ operacao_id: 'OP1', confirmacoes: [
      { ml_item_id: 'MLB1', incluir: true, risco: false, sem_dado: false },
      { ml_item_id: 'MLB2', incluir: true, risco: true, sem_dado: false },
      { ml_item_id: 'MLB3', incluir: true, risco: false, sem_dado: true },
    ] });
    expect(onCriada).toHaveBeenCalledWith('OP1');
  });

  it('confirmou → editou preço → novo rascunho e precisa confirmar de novo', async () => {
    montar([item('MLB1'), vermelho()]);
    await userEvent.click(await screen.findByLabelText('Incluir MLB2'));
    await userEvent.click(screen.getByLabelText(/Assumo o prejuízo/));
    expect(botao()).toBeEnabled();

    previewMut.mockResolvedValueOnce({ operacao_id: 'OP2', itens: [item('MLB1', { preco: 12.5 }), vermelho()], expira_em: expira() });
    const input = screen.getByLabelText('Novo preço de MLB1');
    await userEvent.clear(input);
    await userEvent.type(input, '12,50{Enter}');
    await waitFor(() => expect(previewMut).toHaveBeenLastCalledWith({ ml_item_ids: ['MLB1', 'MLB2'], ajuste, precos: { MLB1: 12.5 } }));
    // novo rascunho: o 🔴 volta desmarcado e a confirmação some/zera
    await waitFor(() => expect(screen.getByLabelText('Incluir MLB2')).not.toBeChecked());
    await userEvent.click(screen.getByLabelText('Incluir MLB2'));
    expect(screen.getByLabelText(/Assumo o prejuízo/)).not.toBeChecked();
    expect(botao()).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Assumo o prejuízo/));
    await userEvent.click(botao());
    expect(confirmarMut).toHaveBeenCalledWith(expect.objectContaining({ operacao_id: 'OP2' }));
  });

  it('membro comum vê o preview mas não executa', async () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    montar([item('MLB1')]);
    expect(await screen.findByText('Só administradores executam.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reajustar/ })).not.toBeInTheDocument();
  });

  it('nenhum muda de preço → sem operação, lista sem alteração e fora do lote', async () => {
    previewMut.mockResolvedValue({ operacao_id: null, itens: [
      item('MLB1', { situacao: 'sem_alteracao', preco: 10, incluido: false, avaliacao: null }),
      item('MLB2', { situacao: 'fora', motivo: 'Participa de promoção', incluido: false, avaliacao: null }),
    ] });
    render(<PreviewReajuste pedido={{ ml_item_ids: ['MLB1', 'MLB2'], ajuste }} onFechar={() => {}} onCriada={() => {}} />);
    expect(await screen.findByText('Nenhum anúncio muda de preço.')).toBeInTheDocument();
    expect(screen.getByText(/MLB2\): Participa de promoção/)).toBeInTheDocument();
    expect(screen.getByText(/Sem alteração \(1\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reajustar/ })).not.toBeInTheDocument();
  });

  it('recusa do confirmar mostra cada anúncio e o motivo', async () => {
    confirmarMut.mockRejectedValueOnce(new ErroOperacao('Algum destes anúncios já está numa operação em andamento.', [
      { ml_item_id: 'MLB1', motivo: 'Algum destes anúncios já está numa operação em andamento.' },
    ]));
    montar([item('MLB1')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Reajustar 1 anúncio' }));
    expect(await screen.findByText(/Produto MLB1 \(MLB1\): Algum destes/)).toBeInTheDocument();
  });

  it('Reverter: pede com origem_id e não deixa editar o preço', async () => {
    previewMut.mockResolvedValue({ operacao_id: 'OP3', itens: [item('MLB1', { preco_anterior: 11, preco: 10 })], expira_em: expira() });
    render(<PreviewReajuste pedido={{ origem_id: 'ORIG' }} onFechar={() => {}} onCriada={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Reverter 1 anúncio' })).toBeEnabled();
    expect(previewMut).toHaveBeenCalledWith({ origem_id: 'ORIG' });
    expect(screen.queryByLabelText('Novo preço de MLB1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reverter reajuste de 1 anúncio' })).toBeInTheDocument();
  });
});

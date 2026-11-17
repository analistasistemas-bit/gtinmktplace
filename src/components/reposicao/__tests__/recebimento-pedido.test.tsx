import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PedidoDTO } from '../../../../supabase/functions/_shared/reposicao/tipos';
import { DialogSaldoPedido, itensComSaldo, pedidosQueRecebem, preSelecaoNota } from '../recebimento-pedido';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function pedido(id: string, over: Partial<PedidoDTO> = {}): PedidoDTO {
  return {
    id, fornecedor: { id: `f-${id}`, nome: `Fornecedor ${id}`, cnpj: null }, status: 'enviado', previstoPara: null, atrasado: false,
    salvoPor: null, salvoEm: null, aprovadoPor: null, enviadoEm: null, alteradoPor: null, alteradoEm: null,
    itens: [{ codigo: 'S1', codigoPai: 'P1', quantidade: 10, sugerida: 10, recebida: 0, encerrado: false, codigoFornecedor: null }],
    ...over,
  };
}

describe('pedidosQueRecebem', () => {
  it('só aprovado, enviado e parcial que têm o SKU', () => {
    const lista = [
      pedido('a', { status: 'aprovado' }), pedido('b', { status: 'parcial' }), pedido('c', { status: 'rascunho' }),
      pedido('d', { status: 'recebido' }), pedido('e', { status: 'saldo_encerrado' }),
      pedido('f', { itens: [{ codigo: 'OUTRO', codigoPai: 'P9', quantidade: 1, sugerida: 1, recebida: 0, encerrado: false, codigoFornecedor: null }] }),
    ];
    expect(pedidosQueRecebem(lista, ['S1']).map((p) => p.id)).toEqual(['a', 'b']);
  });

  // ADR-0207: Não repor só tira o SKU da sugestão; o pedido já feito continua recebível. O DTO do pedido nem
  // carrega Não repor — a lista não pode passar a filtrar por ele.
  it('pedido de SKU depois marcado Não repor continua recebível', () => {
    expect(pedidosQueRecebem([pedido('a')], ['S1']).map((p) => p.id)).toEqual(['a']);
  });

  // Rodada 1: o SKU precisa ter saldo recebível NESTE pedido (mesma regra de montarPedidosAbertos).
  it('SKU encerrado ou já completo no pedido não oferece o pedido', () => {
    const item = pedido('x').itens[0]!;
    const encerrado = pedido('enc', { status: 'parcial', itens: [{ ...item, recebida: 4, encerrado: true }] });
    const completo = pedido('comp', { status: 'parcial', itens: [{ ...item, recebida: 10 },
      { ...item, codigo: 'S2', recebida: 0 }] });
    expect(pedidosQueRecebem([encerrado, completo], ['S1'])).toEqual([]);
    expect(pedidosQueRecebem([completo], ['S2']).map((p) => p.id)).toEqual(['comp']);
  });
});

describe('preSelecaoNota', () => {
  const a = pedido('A', { fornecedor: { id: 'fa', nome: 'A', cnpj: '99888777000166' } });
  const b = pedido('B', { fornecedor: { id: 'fb', nome: 'B', cnpj: '11222333000181' } });
  it('aceite 4 — pré-seleção escolhe o pedido do fornecedor do CNPJ emitente (B), nunca o de A', () => {
    expect(preSelecaoNota([a, b], '11.222.333/0001-81')).toBe('B');
  });
  it('pedido do CNPJ com o SKU encerrado ou completo não é pré-selecionado', () => {
    const item = b.itens[0]!;
    const bEncerrado = { ...b, itens: [{ ...item, encerrado: true }] };
    const bCompleto = { ...b, itens: [{ ...item, recebida: 10 }] };
    expect(preSelecaoNota(pedidosQueRecebem([a, bEncerrado], ['S1']), '11222333000181')).toBeNull();
    expect(preSelecaoNota(pedidosQueRecebem([a, bCompleto], ['S1']), '11222333000181')).toBeNull();
  });

  it('nenhum ou mais de um pedido do CNPJ → nada pré-selecionado ("Nenhum")', () => {
    expect(preSelecaoNota([a], '11222333000181')).toBeNull();
    expect(preSelecaoNota([b, { ...b, id: 'B2' }], '11222333000181')).toBeNull();
  });
});

describe('DialogSaldoPedido', () => {
  const p = pedido('x', {
    fornecedor: { id: 'f', nome: 'Fornecedor A', cnpj: null },
    itens: [
      { codigo: 'S1', codigoPai: 'P1', quantidade: 10, sugerida: 10, recebida: 10, encerrado: false, codigoFornecedor: null },
      { codigo: 'S2', codigoPai: 'P1', quantidade: 10, sugerida: 10, recebida: 6, encerrado: false, codigoFornecedor: null },
      { codigo: 'S3', codigoPai: 'P1', quantidade: 7, sugerida: 7, recebida: 4, encerrado: false, codigoFornecedor: null },
      { codigo: 'S4', codigoPai: 'P1', quantidade: 5, sugerida: 5, recebida: 0, encerrado: true, codigoFornecedor: null },
    ],
  });

  it('itensComSaldo ignora item completo e item já encerrado', () => {
    expect(itensComSaldo(p).map((i) => i.codigo)).toEqual(['S2', 'S3']);
  });

  it('pergunta "Chegaram X de Y"; Sim fecha sem encerrar', async () => {
    const encerrar = vi.fn();
    const fechar = vi.fn();
    render(<DialogSaldoPedido pedido={p} onFechar={fechar} encerrarSaldo={encerrar} />);
    expect(screen.getByText('Chegaram 20 de 32 do pedido Fornecedor A. O restante ainda vem?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sim, ainda vem' }));
    expect(fechar).toHaveBeenCalled();
    expect(encerrar).not.toHaveBeenCalled();
  });

  it('"Não" lista os itens com saldo e encerra exatamente esses códigos', async () => {
    const encerrar = vi.fn(() => Promise.resolve({}));
    const fechar = vi.fn();
    render(<DialogSaldoPedido pedido={p} onFechar={fechar} encerrarSaldo={encerrar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(screen.getByText('S2')).toBeInTheDocument();
    expect(screen.getByText('S3')).toBeInTheDocument();
    expect(screen.queryByText('S1')).toBeNull();
    expect(encerrar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar saldo' }));
    await waitFor(() => expect(encerrar).toHaveBeenCalledWith({ pedidoId: 'x', codigos: ['S2', 'S3'] }));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
  });

  it('erro ao encerrar: mensagem ao operador e o diálogo fica aberto', async () => {
    const { toast } = await import('sonner');
    const encerrar = vi.fn(() => Promise.reject(new Error('Só admin encerra saldo.')));
    const fechar = vi.fn();
    render(<DialogSaldoPedido pedido={p} onFechar={fechar} encerrarSaldo={encerrar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Não' }));
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar saldo' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Só admin encerra saldo.'));
    expect(fechar).not.toHaveBeenCalled();
  });
});

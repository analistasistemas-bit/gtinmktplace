import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const salvar = vi.fn(); const confirmar = vi.fn();
vi.mock('@/lib/pacote-contador/inventario-fonte', () => ({
  salvarContagem: (...a: unknown[]) => salvar(...a), confirmarInventario: (...a: unknown[]) => confirmar(...a),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { DialogContagemInventario } from '../dialog-contagem-inventario';
import { ErroPacote } from '@/lib/pacote-contador/baixar';
import type { LeituraInventario } from '@/lib/pacote-contador/tipos-inventario';

const item = (codigo: string, q: number) => ({
  codigo, codigo_pai: 'P1', descricao: `Produto ${codigo}`, ncm: null, unidade: 'UN', cor: 'Azul', tamanho: 'M',
  quantidade_sistema: q, qtd_valorizada: q, qtd_sem_nota: 0, custo_medio: 1, valor_total: q, marcas: [],
});
const FOTO: LeituraInventario = {
  cabecalho: { id: 'inv-1', versao: 4, data_base: '2026-12-31', gerado_em: '2027-01-01T02:59:00Z', status: 'aberto', cnpj: null, inscricao_estadual: null, razao_social: null },
  itens: [item('A1', 10), item('B2', 2)],
};
const montar = (isAdmin = true) => {
  const onRecarregar = vi.fn(); const onOpenChange = vi.fn();
  render(<DialogContagemInventario foto={FOTO} isAdmin={isAdmin} onOpenChange={onOpenChange} onRecarregar={onRecarregar} />);
  return { onRecarregar, onOpenChange };
};
const contar = (cod: string, v: string) => fireEvent.change(screen.getByLabelText(`Contada ${cod}`), { target: { value: v } });
const justificar = (cod: string, v: string) => fireEvent.change(screen.getByLabelText(`Justificativa ${cod}`), { target: { value: v } });

beforeEach(() => { salvar.mockReset().mockResolvedValue(5); confirmar.mockReset().mockResolvedValue('ok'); });

describe('DialogContagemInventario', () => {
  it('justificativa obrigatória quando contada difere do sistema', () => {
    montar();
    const btn = screen.getByRole('button', { name: 'Confirmar contagem' });
    expect(btn).toBeEnabled();
    contar('A1', '7');
    expect(btn).toBeDisabled();
    justificar('A1', 'extravio');
    expect(btn).toBeEnabled();
  });
  it('não-admin não vê Salvar nem Confirmar', () => {
    montar(false);
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar contagem' })).toBeNull();
  });
  it('salvar manda a contagem com a versão atual', async () => {
    montar();
    contar('A1', '7'); justificar('A1', 'extravio');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith('inv-1', 4, [
      { codigo: 'A1', quantidade_contada: 7, justificativa: 'extravio' }, { codigo: 'B2', quantidade_contada: null, justificativa: null }]));
  });
  it('409 mostra a mensagem exata', async () => {
    salvar.mockRejectedValueOnce(new ErroPacote('A contagem mudou em outra aba; recarregue.', 409));
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/A contagem mudou em outra aba; recarregue\./)).toBeInTheDocument();
  });
  it('confirmação resume faltas e sobras e avisa da atualização', async () => {
    montar();
    contar('A1', '7'); justificar('A1', 'extravio');
    contar('B2', '5'); justificar('B2', 'achado');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar contagem' }));
    expect(await screen.findByText(/Faltas: 1 item \(3 un\.\)\. Sobras: 1 item \(3 un\.\)/)).toBeInTheDocument();
    expect(screen.getByText(/o estoque e os anúncios serão atualizados/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e atualizar estoque' }));
    await waitFor(() => expect(confirmar).toHaveBeenCalledWith('inv-1', 5));
  });
  it('push pendente: "Tentar de novo" chama confirmar outra vez', async () => {
    confirmar.mockResolvedValueOnce('pendente');
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar contagem' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar e atualizar estoque' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(2));
    expect(confirmar).toHaveBeenLastCalledWith('inv-1', 5);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

const GRUPOS = [{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }];

describe('GeradorVariacoes (ADR-0166)', () => {
  it('gera o cartesiano das cores digitadas pelos tamanhos marcados', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);

    await user.type(screen.getByLabelText('Cores'), 'Azul, Preto');
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));

    expect(onGerar).toHaveBeenCalledWith([
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('mostra a contagem ANTES de gerar, para o operador nao ser surpreendido', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Cores'), 'Azul, Preto, Verde');
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    expect(screen.getByText(/3 variações/)).toBeInTheDocument();
  });

  it('botao travado enquanto nao ha cor nem tamanho', () => {
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Gerar variações' })).toBeDisabled();
  });

  it('acima do limite mostra o erro e NAO chama onGerar', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);
    const cores = Array.from({ length: 13 }, (_, i) => `Cor${i}`).join(', ');
    await user.type(screen.getByLabelText('Cores'), cores);
    for (const t of TAMANHOS_ROUPA) await user.click(screen.getByRole('checkbox', { name: t }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/limite de 60/i);
  });

  it('separa cores por virgula E por quebra de linha, e ignora vazio', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);
    await user.type(screen.getByLabelText('Cores'), 'Azul,,{enter}Preto,');
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).toHaveBeenCalledWith([
      { cor: 'Azul', tamanho: null }, { cor: 'Preto', tamanho: null },
    ]);
  });

  // Achado do review da Task 11: a previa de contagem tinha que usar a MESMA dedup que
  // gerarCombinacoes usa de verdade, senao previa e resultado divergem.
  it('previa de contagem ja considera dedup de cor (nao mostra numero que gerarCombinacoes nao entrega)', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Cores'), 'Azul, Azul, Preto');
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    // 2 cores unicas (Azul, Preto) x 1 tamanho = 2, nao 3.
    expect(screen.getByText(/2 variações/)).toBeInTheDocument();
  });
});

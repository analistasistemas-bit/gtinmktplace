import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

const GRUPOS = [{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }];

describe('GeradorVariacoes (ADR-0166)', () => {
  it('gera o cartesiano das cores populares marcadas pelos tamanhos marcados', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);

    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));

    expect(onGerar).toHaveBeenCalledWith([
      { cor: 'Azul Marinho', tamanho: 'P' }, { cor: 'Azul Marinho', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('mostra a contagem ANTES de gerar, para o operador nao ser surpreendido', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'Branco' }));
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
    for (let i = 0; i < 13; i += 1) {
      await user.type(screen.getByLabelText('Nova cor'), `Cor${i}`);
      await user.click(screen.getByRole('button', { name: 'Adicionar cor' }));
    }
    for (const t of TAMANHOS_ROUPA) await user.click(screen.getByRole('checkbox', { name: t }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/limite de 60/i);
  });

  // Achado do review da Task 11: a previa de contagem tinha que usar a MESMA dedup que
  // gerarCombinacoes usa de verdade, senao previa e resultado divergem.
  it('previa de contagem ja considera dedup (nao mostra numero que gerarCombinacoes nao entrega)', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    // 2 cores unicas (Azul Marinho, Preto) x 1 tamanho = 2.
    expect(screen.getByText(/2 variações/)).toBeInTheDocument();
  });

  // Pedido do Diego (2026-09-19): digitar cor por cor numa lista separada por vírgula era fácil
  // de errar (typo mescla duas cores). Cores populares viram checkbox; cor fora da lista precisa
  // de uma ação explícita de "Adicionar", uma de cada vez.
  it('cor fora da lista de populares entra via "Adicionar cor" e aparece como badge removível', async () => {
    const user = userEvent.setup();
    const onGerar = vi.fn();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={onGerar} />);

    await user.type(screen.getByLabelText('Nova cor'), 'Verde Oliva');
    await user.click(screen.getByRole('button', { name: 'Adicionar cor' }));
    expect(screen.getByText('Verde Oliva')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'P' }));
    await user.click(screen.getByRole('button', { name: 'Gerar variações' }));
    expect(onGerar).toHaveBeenCalledWith([{ cor: 'Verde Oliva', tamanho: 'P' }]);
  });

  it('Enter no campo "Nova cor" adiciona sem precisar clicar no botão', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Oliva{enter}');
    expect(screen.getByText('Verde Oliva')).toBeInTheDocument();
    // Campo limpa depois de adicionar, pronto pra próxima.
    expect(screen.getByLabelText('Nova cor')).toHaveValue('');
  });

  it('remove uma cor personalizada adicionada por engano', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Oliva{enter}');
    await user.click(screen.getByRole('button', { name: 'Remover cor Verde Oliva' }));
    expect(screen.queryByText('Verde Oliva')).not.toBeInTheDocument();
  });

  it('nao deixa adicionar cor duplicada (mesmo nome ja marcado ou ja adicionado)', async () => {
    const user = userEvent.setup();
    render(<GeradorVariacoes gruposTamanho={GRUPOS} onGerar={vi.fn()} />);
    await user.type(screen.getByLabelText('Nova cor'), 'Preto{enter}');
    // "Preto" já é uma cor popular (checkbox) — não deveria virar um badge duplicado.
    expect(screen.queryByText('Preto', { selector: 'span' })).not.toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { erroCampo, LinhaVariacaoForm, novaLinha } from '@/components/estoque/linha-variacao-form';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

function renderizar(gruposTamanho?: { grupo: string; valores: readonly string[] }[]) {
  const onMudar = vi.fn();
  render(
    <LinhaVariacaoForm
      linha={novaLinha()}
      indice={0}
      podeRemover={false}
      tentouSalvar={false}
      gruposTamanho={gruposTamanho}
      onMudar={onMudar}
      onRemover={() => {}}
    />,
  );
  return { onMudar };
}

describe('LinhaVariacaoForm — Tamanho (ADR-0166)', () => {
  it('sem grupos, o campo Tamanho NAO existe — tela byte a byte igual a de hoje', () => {
    renderizar();
    expect(screen.queryByLabelText(/Tamanho da variação 1/)).not.toBeInTheDocument();
  });

  it('lista vazia de grupos tambem nao renderiza o campo', () => {
    renderizar([]);
    expect(screen.queryByLabelText(/Tamanho da variação 1/)).not.toBeInTheDocument();
  });

  it('com o grupo Tamanho, oferece as 5 opcoes + a opcao vazia', () => {
    renderizar([{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }]);
    const select = screen.getByLabelText(/Tamanho da variação 1/);
    expect(select).toBeInTheDocument();
    for (const t of TAMANHOS_ROUPA) {
      expect(screen.getByRole('option', { name: t })).toBeInTheDocument();
    }
  });

  it('escolher um tamanho chama onMudar com o valor', async () => {
    const user = userEvent.setup();
    const { onMudar } = renderizar([{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }]);
    await user.selectOptions(screen.getByLabelText(/Tamanho da variação 1/), 'G');
    expect(onMudar).toHaveBeenCalledWith({ tamanho: 'G' });
  });

  it('novaLinha nasce com tamanho vazio', () => {
    expect(novaLinha().tamanho).toBe('');
  });

  // Trava contra regressão: sem essa guarda em erroCampo, um valor tipo "P" tenta virar
  // número (parseNum) e a linha aparece com "Valor inválido." sem nenhum operador ter digitado
  // nada errado.
  it('erroCampo nunca reclama de tamanho como se fosse campo numerico', () => {
    for (const valor of [...TAMANHOS_ROUPA, '']) {
      expect(erroCampo('tamanho', valor)).toBeNull();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeradorVariacoes } from '@/components/estoque/gerador-variacoes';
import { TAMANHOS_ROUPA } from '@/lib/tamanhos';

const GRUPOS = [{ grupo: 'Tamanho', valores: TAMANHOS_ROUPA }];

function renderGerador(props: Partial<React.ComponentProps<typeof GeradorVariacoes>> = {}) {
  const onMudarCores = vi.fn();
  const onMudarTamanhos = vi.fn();
  render(
    <GeradorVariacoes
      gruposTamanho={GRUPOS}
      cores={props.cores ?? new Set()}
      tamanhos={props.tamanhos ?? new Set()}
      coresBloqueadas={props.coresBloqueadas ?? new Set()}
      tamanhosBloqueados={props.tamanhosBloqueados ?? new Set()}
      bloquearNovaCor={props.bloquearNovaCor ?? false}
      avisoTamanho={props.avisoTamanho ?? (() => null)}
      desabilitado={props.desabilitado ?? false}
      onMudarCores={props.onMudarCores ?? onMudarCores}
      onMudarTamanhos={props.onMudarTamanhos ?? onMudarTamanhos}
    />,
  );
  return { onMudarCores, onMudarTamanhos };
}

describe('GeradorVariacoes (controlado — a seleção já é a ação)', () => {
  it('não existe mais botão "Gerar variações": marcar já reporta a seleção nova', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Preto']) });
    expect(screen.queryByRole('button', { name: 'Gerar variações' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Preto', 'Azul Marinho']));
  });

  it('desmarcar reporta a seleção SEM aquela cor — o pai decide se confirma', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Preto', 'Azul Marinho']) });
    await user.click(screen.getByRole('checkbox', { name: 'Preto' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Azul Marinho']));
  });

  it('é controlado: o checkbox reflete a prop, não um estado interno', async () => {
    const user = userEvent.setup();
    renderGerador({ cores: new Set(['Preto']), onMudarCores: vi.fn() });
    expect(screen.getByRole('checkbox', { name: 'Preto' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Azul Marinho' }));
    // O pai não aplicou a mudança, então a UI não pode se mexer sozinha.
    expect(screen.getByRole('checkbox', { name: 'Azul Marinho' })).not.toBeChecked();
  });

  it('marcar tamanho reporta a seleção nova de tamanhos', async () => {
    const user = userEvent.setup();
    const { onMudarTamanhos } = renderGerador({ tamanhos: new Set(['P']) });
    await user.click(screen.getByRole('checkbox', { name: 'M' }));
    expect(onMudarTamanhos).toHaveBeenCalledWith(new Set(['P', 'M']));
  });

  it('cor fora da lista entra via "Adicionar cor" e aparece como badge removível', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo');
    await user.click(screen.getByRole('button', { name: 'Adicionar cor' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Verde Musgo']));
  });

  it('Enter no campo "Nova cor" adiciona sem precisar clicar no botão', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo{Enter}');
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Verde Musgo']));
  });

  it('cor personalizada já selecionada aparece como badge com botão de remover', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador({ cores: new Set(['Verde Musgo']) });
    await user.click(screen.getByRole('button', { name: 'Remover cor Verde Musgo' }));
    expect(onMudarCores).toHaveBeenCalledWith(new Set());
  });

  it('digitar o nome de uma cor popular marca o checkbox em vez de criar um badge duplicado', async () => {
    const user = userEvent.setup();
    const { onMudarCores } = renderGerador();
    await user.type(screen.getByLabelText('Nova cor'), 'Preto{Enter}');
    expect(onMudarCores).toHaveBeenCalledWith(new Set(['Preto']));
    expect(screen.queryByRole('button', { name: 'Remover cor Preto' })).not.toBeInTheDocument();
  });

  // Limite: o clique que estouraria 60 nem acontece — nada de aceitar e falhar depois de gerar.
  it('cor bloqueada pelo limite fica desabilitada e explica o motivo', () => {
    renderGerador({ coresBloqueadas: new Set(['Amarelo']) });
    const chip = screen.getByRole('checkbox', { name: 'Amarelo' });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAccessibleDescription(/limite de 60/i);
  });

  it('tamanho bloqueado pelo limite também fica desabilitado', () => {
    renderGerador({ tamanhosBloqueados: new Set(['GG']) });
    expect(screen.getByRole('checkbox', { name: 'GG' })).toBeDisabled();
  });

  it('sem espaço para mais nenhuma cor, "Adicionar cor" trava mesmo com texto digitado', async () => {
    const user = userEvent.setup();
    renderGerador({ bloquearNovaCor: true });
    await user.type(screen.getByLabelText('Nova cor'), 'Verde Musgo');
    expect(screen.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });

  it('aviso inline por tamanho aparece junto ao checkbox', () => {
    renderGerador({ avisoTamanho: (v) => (v === 'GG' ? 'cadastrável, mas hoje não publica no Mercado Livre' : null) });
    expect(screen.getByText(/não publica no Mercado Livre/)).toBeInTheDocument();
  });

  it('desabilitado (durante o salvamento) congela toda a seleção', () => {
    renderGerador({ desabilitado: true });
    expect(screen.getByRole('checkbox', { name: 'Preto' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'P' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Adicionar cor' })).toBeDisabled();
  });
});

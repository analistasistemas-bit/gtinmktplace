import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreencherEmMassa } from '@/components/estoque/preencher-em-massa';

type Escopo = Parameters<typeof PreencherEmMassa>[0]['escopoInicial'];

// O rótulo é DERIVADO do escopo, igual ao que a matriz faz: um helper que sempre dissesse
// "no tamanho GG" faria os testes de escopo por cor lerem como se o gatilho fosse a coluna GG.
function rotuloDe(e: Escopo): string {
  if (e.tipo === 'todos') return 'Preencher em massa';
  return e.tipo === 'cor'
    ? `Preencher em massa na cor ${e.valor}`
    : `Preencher em massa no tamanho ${e.valor}`;
}

type Campo = Parameters<typeof PreencherEmMassa>[0]['campoInicial'];

function montar(escopoInicial: Escopo, desabilitado = false, campoInicial: Campo = 'estoqueInicial') {
  const onAplicar = vi.fn();
  const rotulo = rotuloDe(escopoInicial);
  render(
    <PreencherEmMassa
      escopoInicial={escopoInicial}
      campoInicial={campoInicial}
      cores={['Preto', 'Branco']}
      tamanhos={['P', 'GG']}
      desabilitado={desabilitado}
      gatilho={escopoInicial.tipo === 'todos' ? 'Preencher em massa' : escopoInicial.valor}
      rotuloGatilho={rotulo}
      onAplicar={onAplicar}
    />,
  );
  return { onAplicar, rotulo };
}

describe('PreencherEmMassa', () => {
  it('abre com o escopo do gatilho já selecionado', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByLabelText('Aplicar em')).toHaveValue('tamanho');
    expect(screen.getByLabelText('Tamanho')).toHaveValue('GG');
  });

  it('aplica o valor no campo e escopo escolhidos', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'preco');
    await user.type(screen.getByLabelText('Valor'), '64,90');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'preco', escopo: { tipo: 'tamanho', valor: 'GG' }, valor: '64,90',
    });
  });

  it('trocar o escopo para "todos" some com o seletor de valor do eixo', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'tamanho', valor: 'GG' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Aplicar em'), 'todos');
    expect(screen.queryByLabelText('Tamanho')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Valor'), '3');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '3',
    });
  });

  // `valor: null` em campo herdável = remover o override. É a ÚNICA forma de voltar a herdar em
  // massa; o botão não pode mandar string vazia, que é override vazio (regra do spec).
  it('"Voltar ao herdado" manda valor null, só em campo herdável', async () => {
    const user = userEvent.setup();
    const { onAplicar, rotulo } = montar({ tipo: 'cor', valor: 'Preto' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'custo');
    await user.click(screen.getByRole('button', { name: 'Voltar ao herdado' }));
    expect(onAplicar).toHaveBeenCalledWith({
      campo: 'custo', escopo: { tipo: 'cor', valor: 'Preto' }, valor: null,
    });
  });

  it('campo herdável não oferece "Limpar"; estoque/GTIN não oferecem "Voltar ao herdado"', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar ao herdado' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Campo'), 'preco');
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar ao herdado' })).toBeInTheDocument();
  });

  // Regra inegociável: nada nesta tela inventa código de barras.
  it('não existe botão de gerar GTIN', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'gtin');
    expect(screen.queryByRole('button', { name: /gerar/i })).not.toBeInTheDocument();
  });

  // Achado Important da revisão final de branch: `onOpenChange` ressemeava só o ESCOPO. O campo e
  // o valor sobreviviam ao fechar, então reabrir o MESMO cabeçalho depois de um uso em GTIN
  // gravava o estoque digitado como GTIN de toda a cor/tamanho, em silêncio.
  it('reabrir volta ao campo do modo ativo e limpa o valor digitado', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'cor', valor: 'Preto' });
    await user.click(screen.getByRole('button', { name: rotulo }));
    await user.selectOptions(screen.getByLabelText('Campo'), 'gtin');
    await user.type(screen.getByLabelText('Valor'), '789');
    // Fechar SEM aplicar: `emitir` já limpa o valor, então fechar pelo "Aplicar" não reproduz.
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Campo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByLabelText('Campo')).toHaveValue('estoqueInicial');
    expect(screen.getByLabelText('Valor')).toHaveValue('');
  });

  it('o campo inicial acompanha a aba ativa da matriz, não o default', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' }, false, 'preco');
    await user.click(screen.getByRole('button', { name: rotulo }));
    expect(screen.getByLabelText('Campo')).toHaveValue('preco');
  });

  it('desabilitado não abre', async () => {
    const user = userEvent.setup();
    const { rotulo } = montar({ tipo: 'todos' }, true);
    const gatilho = screen.getByRole('button', { name: rotulo });
    expect(gatilho).toBeDisabled();
    await user.click(gatilho);
    expect(screen.queryByLabelText('Campo')).not.toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinhaGradeForm } from '@/components/estoque/linha-grade-form';
import { novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade } from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function renderLinha(linha: LinhaGrade = novaLinhaGrade('Azul', 'M'), props: {
  desabilitado?: boolean; tentouSalvar?: boolean;
} = {}) {
  const onMudar = vi.fn();
  const onMudarOverride = vi.fn();
  const onDestravar = vi.fn();
  const onVoltarAHerdar = vi.fn();
  const onRemover = vi.fn();
  render(
    <LinhaGradeForm
      linha={linha}
      resolvida={resolverLinha(CABECALHO, {}, linha)}
      tentouSalvar={props.tentouSalvar ?? false}
      desabilitado={props.desabilitado ?? false}
      podeRemover
      onMudar={onMudar}
      onMudarOverride={onMudarOverride}
      onDestravar={onDestravar}
      onVoltarAHerdar={onVoltarAHerdar}
      onRemover={onRemover}
    />,
  );
  return { onMudar, onMudarOverride, onDestravar, onVoltarAHerdar, onRemover };
}

describe('LinhaGradeForm', () => {
  it('identifica a linha por "Cor · Tamanho", nunca por "Variação N"', () => {
    renderLinha();
    expect(screen.getByText('Azul · M')).toBeInTheDocument();
    expect(screen.queryByText(/Variação \d/)).not.toBeInTheDocument();
  });

  it('cor e tamanho são texto, não campos editáveis', () => {
    renderLinha();
    expect(screen.queryByLabelText(/Cor/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tamanho/)).not.toBeInTheDocument();
  });

  it('estoque e GTIN são por linha e reportam a mudança', async () => {
    const user = userEvent.setup();
    const { onMudar } = renderLinha();
    await user.type(screen.getByLabelText('Estoque inicial de Azul · M'), '5');
    expect(onMudar).toHaveBeenCalledWith({ estoqueInicial: '5' });
  });

  it('linha sem override mostra os herdados resumidos, sem 6 campos repetidos', () => {
    renderLinha();
    expect(screen.getByText(/herdados do produto/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Preço mínimo (líquido) de Azul · M')).not.toBeInTheDocument();
  });

  it('"Editar nesta linha" expande os 6 campos herdáveis', async () => {
    const user = userEvent.setup();
    renderLinha();
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
    expect(screen.getByLabelText('Custo de Azul · M')).toBeDisabled();
  });

  it('destravar um campo reporta SÓ aquele campo', async () => {
    const user = userEvent.setup();
    const { onDestravar } = renderLinha();
    await user.click(screen.getByRole('button', { name: /Editar nesta linha/i }));
    await user.click(screen.getByRole('button', { name: 'Destravar Preço mínimo (líquido) de Azul · M' }));
    expect(onDestravar).toHaveBeenCalledWith('preco');
    expect(onDestravar).toHaveBeenCalledTimes(1);
  });

  it('linha com override já abre expandida e mostra "Voltar a herdar" só no campo destravado', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = renderLinha(linha);
    expect(screen.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeEnabled();
    expect(screen.getByLabelText('Custo de Azul · M')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Voltar a herdar Preço mínimo (líquido) de Azul · M' }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith('preco');
  });

  it('editar um campo destravado reporta o override daquele campo', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onMudarOverride } = renderLinha(linha);
    await user.type(screen.getByLabelText('Preço mínimo (líquido) de Azul · M'), '9');
    expect(onMudarOverride).toHaveBeenCalledWith('preco', '129,909');
  });

  it('campo destravado com valor inválido mostra o erro depois de tentar salvar', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '0' } };
    renderLinha(linha, { tentouSalvar: true });
    expect(screen.getByText(/obrigatório e deve ser maior que zero/i)).toBeInTheDocument();
  });

  it('desabilitado congela remover, estoque, GTIN e os cadeados', async () => {
    const user = userEvent.setup();
    const { onRemover } = renderLinha(novaLinhaGrade('Azul', 'M'), { desabilitado: true });
    expect(screen.getByLabelText('Estoque inicial de Azul · M')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover Azul · M' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remover Azul · M' }));
    expect(onRemover).not.toHaveBeenCalled();
  });
});

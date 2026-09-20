import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetalhesSku } from '@/components/estoque/detalhes-sku';
import {
  novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade,
} from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function montar(linha: LinhaGrade = novaLinhaGrade('Azul', 'M'), props: {
  desabilitado?: boolean; tentouSalvar?: boolean;
} = {}) {
  const spies = {
    onFechar: vi.fn(), onMudarOverride: vi.fn(), onDestravar: vi.fn(), onVoltarAHerdar: vi.fn(),
  };
  render(
    <DetalhesSku
      linha={linha}
      resolvida={resolverLinha(CABECALHO, {}, linha)}
      tentouSalvar={props.tentouSalvar ?? false}
      desabilitado={props.desabilitado ?? false}
      {...spies}
    />,
  );
  return spies;
}

describe('DetalhesSku', () => {
  it('identifica o SKU por "Cor · Tamanho", nunca por "Variação N"', () => {
    montar();
    expect(screen.getByText('Azul · M')).toBeInTheDocument();
    expect(screen.queryByText(/Variação \d/)).not.toBeInTheDocument();
  });

  it('mostra os 6 campos herdáveis, todos herdando por padrão', () => {
    montar();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Custo de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Peso (g) de Azul · M')).toBeDisabled();
    expect(within(drawer).getByLabelText('Comprimento (cm) de Azul · M')).toBeDisabled();
  });

  it('mostra o indicador visual de unidade (R$/g/cm), não só no aria-label', () => {
    montar();
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getAllByText('R$')).toHaveLength(2);   // preço e custo
    expect(drawer.getByText('g')).toBeInTheDocument();    // peso
    expect(drawer.getAllByText('cm')).toHaveLength(3);    // altura, largura, comprimento
  });

  // O cadeado do card virou radio (mockup do Diego): a escolha fica visível sem hover e o estado
  // "herdando" deixa de ser um ícone que o operador precisa decodificar.
  it('escolher "Usar valor específico" destrava SÓ aquele campo', async () => {
    const user = userEvent.setup();
    const { onDestravar } = montar();
    await user.click(screen.getByRole('radio', { name: 'Usar valor específico — Custo' }));
    expect(onDestravar).toHaveBeenCalledWith('custo');
    expect(onDestravar).toHaveBeenCalledTimes(1);
  });

  it('campo com override nasce em "Usar valor específico" e é editável', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onMudarOverride } = montar(linha);
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('radio', { name: 'Usar valor específico — Preço mínimo (líquido)' }))
      .toBeChecked();
    const campo = drawer.getByLabelText('Preço mínimo (líquido) de Azul · M');
    expect(campo).toBeEnabled();
    await user.type(campo, '9');
    expect(onMudarOverride).toHaveBeenCalledWith('preco', '129,909');
  });

  it('escolher "Herdar do produto" num campo com override devolve a herança', async () => {
    const user = userEvent.setup();
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = montar(linha);
    await user.click(screen.getByRole('radio', {
      name: 'Herdar do produto — Preço mínimo (líquido)',
    }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith('preco');
  });

  it('campo destravado com valor inválido mostra o erro depois de tentar salvar', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '0' } };
    montar(linha, { tentouSalvar: true });
    expect(screen.getByText(/obrigatório e deve ser maior que zero/i)).toBeInTheDocument();
  });

  // Pedido do Diego (2026-09-19): a foto é escolhida uma vez por cor, no passo anterior.
  it('não existe campo de foto por SKU — a foto é só por cor', () => {
    montar();
    expect(screen.queryByLabelText(/Foto de Azul · M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Escolher foto/i)).not.toBeInTheDocument();
  });

  // A linha PRECISA ter override: num campo herdando, `disabled={desabilitado || !especifico}`
  // já seria `true` pelo segundo termo, e apagar o `desabilitado ||` passaria verde.
  it('desabilitado congela os campos e os radios', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    montar(linha, { desabilitado: true });
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByRole('radio', { name: 'Usar valor específico — Custo' })).toBeDisabled();
    expect(drawer.getByLabelText('Preço mínimo (líquido) de Azul · M')).toBeDisabled();
  });

  // Portado de `linha-grade-form.test.tsx`: cor e tamanho são a chave da reconciliação e não
  // podem virar campo em lugar nenhum — nem no drawer.
  it('cor e tamanho são texto, não campos editáveis', () => {
    montar();
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.queryByLabelText(/^Cor/)).not.toBeInTheDocument();
    expect(drawer.queryByLabelText(/^Tamanho/)).not.toBeInTheDocument();
  });

  it('linha null mantém o drawer fechado', () => {
    render(
      <DetalhesSku
        linha={null} resolvida={null} tentouSalvar={false} desabilitado={false}
        onFechar={vi.fn()} onMudarOverride={vi.fn()} onDestravar={vi.fn()} onVoltarAHerdar={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

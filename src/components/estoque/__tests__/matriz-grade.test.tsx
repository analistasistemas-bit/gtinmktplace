import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatrizGrade } from '@/components/estoque/matriz-grade';
import {
  novaLinhaGrade, resolverLinha, type CamposHerdaveis, type LinhaGrade,
} from '@/lib/cadastro-grade';

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

function montar(linhas: LinhaGrade[], props: {
  cores?: string[]; tamanhos?: string[]; desabilitado?: boolean; removidas?: Set<string>;
} = {}) {
  const spies = {
    onMudarLinha: vi.fn(), onMudarOverride: vi.fn(), onDestravar: vi.fn(), onVoltarAHerdar: vi.fn(),
    onRemoverCelula: vi.fn(), onReincluirCelula: vi.fn(), onAplicarMassa: vi.fn(),
  };
  render(
    <MatrizGrade
      linhas={linhas}
      resolvidas={linhas.map((l) => resolverLinha(CABECALHO, {}, l))}
      cores={props.cores ?? ['Preto', 'Branco']}
      tamanhos={props.tamanhos ?? ['P', 'M']}
      removidas={props.removidas ?? new Set()}
      tentouSalvar={false}
      desabilitado={props.desabilitado ?? false}
      {...spies}
    />,
  );
  return spies;
}

const gradeCheia = () => [
  novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'M'),
  novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
];

describe('MatrizGrade — estrutura', () => {
  it('linhas são cores e colunas são tamanhos, com coluna Total', () => {
    montar(gradeCheia());
    expect(screen.getAllByRole('columnheader').map((e) => e.textContent))
      .toEqual(['Cor', 'P', 'M', 'Total']);
    // 3 rowheaders, não 2: o `<th scope="row">Total</th>` do rodapé também tem esse papel
    // (aria-query mapeia `th[scope=row]` para `rowheader`, tanto no tbody quanto no tfoot).
    expect(screen.getAllByRole('rowheader').map((e) => e.textContent))
      .toEqual(['Preto', 'Branco', 'Total']);
  });

  // Frame pré-reconciliação: a linha ainda não existe e a combinação NÃO foi removida na mão.
  // Célula inerte — nem campo, nem affordance de reinclusão (o "+" só chega na Task 6).
  it('combinação sem linha fica inerte, sem campo', () => {
    montar([novaLinhaGrade('Preto', 'P')]);
    expect(screen.queryByLabelText('Estoque inicial de Preto · M')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reincluir Preto · M' })).not.toBeInTheDocument();
  });

  it('cada combinação tem uma célula editável com o aria-label canônico', () => {
    montar(gradeCheia());
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toBeInTheDocument();
    expect(screen.getByLabelText('Estoque inicial de Branco · M')).toBeInTheDocument();
  });

  it('digitar numa célula reporta a mudança da linha certa', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarLinha } = montar(linhas);
    await user.type(screen.getByLabelText('Estoque inicial de Branco · P'), '7');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[2]!.clientId, { estoqueInicial: '7' });
  });

  // Metade GTIN do teste `estoque e GTIN são por linha` de `linha-grade-form.test.tsx`: os dois
  // campos crus da linha reportam por caminhos diferentes do código, e só um estar coberto
  // deixaria o outro sem rede.
  it('GTIN também é por linha e reporta a mudança', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarLinha } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    await user.type(screen.getByLabelText('GTIN de Preto · M'), '7');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[1]!.clientId, { gtin: '7' });
  });

  it('a célula sem override anuncia "herdado" para quem passa o mouse ou foca', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, overrides: { preco: '129,90' } };
    montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    // Uma por célula SEM override: 3 das 4. A da célula com override não existe.
    expect(screen.getAllByText('herdado')).toHaveLength(3);
  });
});

describe('MatrizGrade — modos', () => {
  it('as 4 abas trocam o campo editado, mantendo a mesma matriz', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    expect(screen.getByLabelText('GTIN de Preto · P')).toBeInTheDocument();
    expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Custo' }));
    expect(screen.getByLabelText('Custo de Preto · P')).toBeInTheDocument();
  });
});

describe('MatrizGrade — herança na célula', () => {
  it('célula sem override mostra o valor herdado do cabeçalho', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.getByLabelText('Preço mínimo (líquido) de Preto · P')).toHaveValue('99,90');
  });

  // Regra explícita do spec: a célula JÁ é editável — não existe passo "destravar" antes. UMA
  // tecla numa célula herdando basta para reportar o override.
  //
  // Achado do Fable na revisão do plano: `onFocus` seleciona o valor inteiro (fix acima), então
  // a primeira tecla SUBSTITUI '99,90' em vez de concatenar. `user.type` clica antes de digitar,
  // e o clique reposiciona o caret de um jeito que varia entre versões do user-event — não é
  // ele que prova o comportamento de foco/seleção. Por isso: `focus()` programático + apenas
  // `user.keyboard`, e a asserção é o texto digitado sozinho, não resolvido+digitado.
  it('digitar numa célula herdada já reporta o override, sem passo de destravar', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onMudarOverride } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.queryByRole('button', { name: /^Destravar/ })).not.toBeInTheDocument();
    const campo = screen.getByLabelText('Preço mínimo (líquido) de Preto · P');
    campo.focus();
    await user.keyboard('5');
    expect(onMudarOverride).toHaveBeenCalledTimes(1);
    expect(onMudarOverride).toHaveBeenCalledWith(linhas[0]!.clientId, 'preco', '5');
  });

  it('"Voltar a herdar" só aparece na célula que TEM override', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, overrides: { preco: '129,90' } };
    const { onVoltarAHerdar } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(screen.queryByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · M',
    })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {
      name: 'Voltar a herdar Preço mínimo (líquido) de Preto · P',
    }));
    expect(onVoltarAHerdar).toHaveBeenCalledWith(linhas[0]!.clientId, 'preco');
  });

  // Estoque e GTIN não têm herança nenhuma: não existe "GTIN único" numa grade.
  it('modo Estoque e GTIN não oferecem "Voltar a herdar"', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    expect(screen.queryByRole('button', { name: /^Voltar a herdar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'GTIN' }));
    expect(screen.queryByRole('button', { name: /^Voltar a herdar/ })).not.toBeInTheDocument();
  });
});

describe('MatrizGrade — casamento posicional', () => {
  // Grade parcial: 3 linhas para 2×2 células. O índice é derivado por chave, nunca por posição
  // na varredura cor×tamanho — esta é a forma exata do bug que f4a6df68 corrigiu.
  it('grade parcial não desloca o alvo das células seguintes', async () => {
    const user = userEvent.setup();
    const linhas = [
      novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
    ];
    const { onMudarLinha } = montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    await user.type(screen.getByLabelText('Estoque inicial de Branco · M'), '9');
    expect(onMudarLinha).toHaveBeenCalledWith(linhas[2]!.clientId, { estoqueInicial: '9' });
  });
});

describe('MatrizGrade — congelamento', () => {
  it('desabilitado congela células e o botão de remover', async () => {
    const user = userEvent.setup();
    const { onRemoverCelula } = montar(gradeCheia(), { desabilitado: true });
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toBeDisabled();
    const remover = screen.getByRole('button', { name: 'Remover Preto · P' });
    expect(remover).toBeDisabled();
    await user.click(remover);
    expect(onRemoverCelula).not.toHaveBeenCalled();
  });

  it('remover uma célula reporta a combinação, não o índice', async () => {
    const user = userEvent.setup();
    const { onRemoverCelula } = montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'Remover Branco · M' }));
    expect(onRemoverCelula).toHaveBeenCalledWith('Branco', 'M');
  });
});

describe('MatrizGrade — totais', () => {
  it('coluna e rodapé Total somam unidades, em qualquer modo', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '2' };
    linhas[1] = { ...linhas[1]!, estoqueInicial: '3' };
    montar(linhas);
    // `getByText(...).closest('tr')`, NÃO `getByRole('rowheader', { name: 'Preto' })`: a Task 8
    // embrulha o conteúdo do `<th scope="row">` num botão com `aria-label="Preencher em massa na
    // cor Preto"`, e o aria-label do descendente passa a ser o nome acessível do próprio th —
    // um match exato por 'Preto' quebraria lá na frente, sem esta task ter mudado nada.
    const linhaPreto = screen.getByText('Preto').closest('tr')!;
    expect(within(linhaPreto).getByText('5')).toBeInTheDocument();
    // Trocar de modo não muda o total: ele é SEMPRE unidades de estoque.
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    expect(within(linhaPreto).getByText('5')).toBeInTheDocument();
  });
});

describe('MatrizGrade — drawer de detalhes', () => {
  it('abre o drawer do SKU e destrava um campo ali', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    const { onDestravar } = montar(linhas);
    await user.click(screen.getByRole('button', { name: 'Detalhes de Preto · M' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('Preto · M')).toBeInTheDocument();
    await user.click(drawer.getByRole('radio', { name: 'Usar valor específico — Altura' }));
    expect(onDestravar).toHaveBeenCalledWith(linhas[1]!.clientId, 'alturaCm');
  });
});

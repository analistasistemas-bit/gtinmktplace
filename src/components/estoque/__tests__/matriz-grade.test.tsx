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
  tentouSalvar?: boolean; cabecalho?: CamposHerdaveis;
} = {}) {
  const spies = {
    onMudarLinha: vi.fn(), onMudarOverride: vi.fn(), onDestravar: vi.fn(), onVoltarAHerdar: vi.fn(),
    onRemoverCelula: vi.fn(), onReincluirCelula: vi.fn(), onAplicarMassa: vi.fn(),
  };
  render(
    <MatrizGrade
      linhas={linhas}
      resolvidas={linhas.map((l) => resolverLinha(props.cabecalho ?? CABECALHO, {}, l))}
      cores={props.cores ?? ['Preto', 'Branco']}
      tamanhos={props.tamanhos ?? ['P', 'M']}
      removidas={props.removidas ?? new Set()}
      tentouSalvar={props.tentouSalvar ?? false}
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

describe('MatrizGrade — preencher em massa', () => {
  // Os dois gatilhos de eixo são cobertos de ponta a ponta em `dialog-cadastro-grade.test.tsx`,
  // mas o gatilho GERAL ("Toda a grade") não tinha nenhuma asserção: apagá-lo da matriz deixava a
  // suíte inteira verde. O aria-label exato também é a prova de que o nome do gatilho geral não
  // colide com os de cor/tamanho (`getByRole` casa o nome acessível por igualdade).
  it('os 3 gatilhos existem: o geral, o da linha (cor) e o da coluna (tamanho)', () => {
    montar(gradeCheia());
    expect(screen.getByRole('button', { name: 'Preencher em massa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preencher em massa na cor Preto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preencher em massa no tamanho M' })).toBeInTheDocument();
  });

  it('o gatilho do cabeçalho de coluna aplica no tamanho daquela coluna', async () => {
    const user = userEvent.setup();
    const { onAplicarMassa } = montar(gradeCheia());
    await user.click(screen.getByRole('button', { name: 'Preencher em massa no tamanho M' }));
    await user.type(screen.getByLabelText('Valor'), '5');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onAplicarMassa).toHaveBeenCalledWith({
      campo: 'estoqueInicial', escopo: { tipo: 'tamanho', valor: 'M' }, valor: '5',
    });
  });

  it('os 3 gatilhos congelam durante o salvamento', () => {
    montar(gradeCheia(), { desabilitado: true });
    expect(screen.getByRole('button', { name: 'Preencher em massa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preencher em massa na cor Branco' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preencher em massa no tamanho P' })).toBeDisabled();
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

describe('MatrizGrade — célula removida', () => {
  // O card antigo simplesmente sumia da lista. Na matriz a célula continua visível no espaço, e
  // sem affordance vira um buraco mudo que o operador não sabe desfazer.
  it('combinação removida na mão mostra "+" no lugar do campo', () => {
    const linhas = [
      novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M'),
    ];
    montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    expect(screen.queryByLabelText('Estoque inicial de Preto · P')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reincluir Preto · P' })).toBeInTheDocument();
  });

  it('clicar no "+" reporta a combinação a reincluir', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'M')];
    const { onReincluirCelula } = montar(linhas, { removidas: new Set(['Preto\u0000P']) });
    await user.click(screen.getByRole('button', { name: 'Reincluir Preto · P' }));
    expect(onReincluirCelula).toHaveBeenCalledWith('Preto', 'P');
  });

  // A contraparte ("sem linha e sem exclusão → inerte") já está coberta desde a Task 4, no teste
  // `combinação sem linha fica inerte, sem campo`. É ela que impede esta task de oferecer "+" no
  // frame pré-reconciliação — não duplicar aqui.

  it('"+" congela durante o salvamento', () => {
    montar([novaLinhaGrade('Preto', 'M')], {
      removidas: new Set(['Preto\u0000P']), desabilitado: true, cores: ['Preto'], tamanhos: ['P', 'M'],
    });
    expect(screen.getByRole('button', { name: 'Reincluir Preto · P' })).toBeDisabled();
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

describe('MatrizGrade — grade larga', () => {
  // Calçado chega a 10+ colunas. Sem um scrollport próprio, a matriz empurra a largura do dialog
  // e o operador perde a coluna da cor de vista ao rolar.
  it('a tabela vive num container que rola na horizontal e é alcançável por teclado', () => {
    montar([novaLinhaGrade('Preto', '33')], { cores: ['Preto'], tamanhos: ['33'] });
    const scrollport = screen.getByRole('region', { name: 'Grade de variações' });
    expect(scrollport).toHaveAttribute('tabindex', '0');
    expect(scrollport.className).toMatch(/overflow-x-auto/);
    // A altura limitada é o que faz o `sticky top-0` do cabeçalho ter contra o que grudar:
    // sem `max-h`, `scrollHeight === clientHeight` e o sticky nunca dispara.
    expect(scrollport.className).toMatch(/max-h-/);
  });
});

describe('MatrizGrade — erro por célula', () => {
  // Ruling da Task 4: o texto de erro sumiu quando os cards viraram matriz — só a borda mudava, e
  // `tentouSalvar` é gate morto (só liga dentro de `submeter()`, inalcançável enquanto existir erro
  // num CAMPOS_NUMERICOS, que é justamente a condição de erro). O texto tem que aparecer sem
  // depender de um clique em "Cadastrar" antes.
  it('mostra o texto de erro da célula sem exigir tentativa de salvar', () => {
    const linhas = [novaLinhaGrade('Preto', 'P')];
    linhas[0] = { ...linhas[0]!, estoqueInicial: '-1' };
    montar(linhas, { cores: ['Preto'], tamanhos: ['P'] });
    expect(screen.getByText('Estoque inicial não pode ser negativo.')).toBeInTheDocument();
  });

  it('célula sem erro não mostra texto nenhum', () => {
    const linhas = [novaLinhaGrade('Preto', 'P')];
    linhas[0] = { ...linhas[0]!, estoqueInicial: '3' };
    montar(linhas, { cores: ['Preto'], tamanhos: ['P'] });
    expect(screen.queryByText(/pode ser negativo/)).not.toBeInTheDocument();
  });

  // Fix round pós-revisão: `preco` é o único campo cujo `erroCampo` reclama de vazio — o
  // cabeçalho nasce vazio (`CABECALHO_VAZIO` em dialog-cadastro-grade.tsx), então abrir a aba
  // Preço sem o operador ter preenchido nada pintava TODAS as células de vermelho ("muro
  // vermelho"). Célula vazia não pode mostrar erro.
  it('célula de preço vazia (cabeçalho ainda não preenchido) não mostra borda nem texto de erro', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'P')];
    const cabecalhoVazio: CamposHerdaveis = {
      preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
    };
    montar(linhas, { cores: ['Preto'], tamanhos: ['P'], cabecalho: cabecalhoVazio });
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    const campo = screen.getByLabelText('Preço mínimo (líquido) de Preto · P');
    // `Input` já traz `aria-invalid:border-destructive` fixo na classe base (variante do Tailwind,
    // não literal condicional) — um match solto de substring casaria sempre. O token isolado
    // (sem prefixo `aria-invalid:`) é o que a condição `erro && valor !== ''` de fato adiciona.
    expect(campo.className.split(/\s+/)).not.toContain('border-destructive');
    expect(screen.queryByText(/Preço mínimo.*obrigatório/)).not.toBeInTheDocument();
  });

  // Contraste do teste acima: valor NÃO-vazio inválido continua acusando na hora — o gate é só
  // `valor !== ''`, não "desligar o erro do preço".
  it('célula de preço com valor inválido (ex. "-1") continua mostrando borda e texto de erro', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'P')];
    linhas[0] = { ...linhas[0]!, overrides: { preco: '-1' } };
    montar(linhas, { cores: ['Preto'], tamanhos: ['P'] });
    await user.click(screen.getByRole('button', { name: 'Preço' }));
    const campo = screen.getByLabelText('Preço mínimo (líquido) de Preto · P');
    expect(campo.className.split(/\s+/)).toContain('border-destructive');
    expect(screen.getByText(/Preço mínimo.*obrigatório/)).toBeInTheDocument();
  });
});

describe('MatrizGrade — teclado', () => {
  it('Enter move para a célula de baixo, na mesma coluna', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    const topo = screen.getByLabelText('Estoque inicial de Preto · M');
    topo.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Estoque inicial de Branco · M')).toHaveFocus();
  });

  it('Enter na última linha não rouba o foco nem submete nada', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    const base = screen.getByLabelText('Estoque inicial de Branco · P');
    base.focus();
    await user.keyboard('{Enter}');
    expect(base).toHaveFocus();
  });

  // Grade parcial: a célula de baixo é um "+", não um campo. Sem `data-r`/`data-c` no botão, o
  // Enter morre em silêncio exatamente onde a grade parcial existe.
  it('Enter cai no "+" quando a célula de baixo foi removida', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'M')];
    montar(linhas, { removidas: new Set(['Branco\u0000P']) });
    const topo = screen.getByLabelText('Estoque inicial de Preto · P');
    topo.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Reincluir Branco · P' })).toHaveFocus();
  });

  // Achado do Fable (revisão do plano): o "+" carrega data-r/data-c de propósito (Task 6), mas
  // Enter também é a ATIVAÇÃO NATIVA de um <button> focado. Se `teclado()` interceptasse Enter
  // em qualquer alvo com data-r/data-c, o "+" nunca clicaria por Enter — só por Espaço, o que
  // ninguém espera de um botão. Enter no "+" precisa continuar sendo clique, não navegação.
  it('Enter no "+" reinclui a célula (ativação nativa do botão, não navegação)', async () => {
    const user = userEvent.setup();
    const linhas = [novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'M'), novaLinhaGrade('Branco', 'M')];
    const { onReincluirCelula } = montar(linhas, { removidas: new Set(['Branco\u0000P']) });
    screen.getByRole('button', { name: 'Reincluir Branco · P' }).focus();
    await user.keyboard('{Enter}');
    expect(onReincluirCelula).toHaveBeenCalledWith('Branco', 'P');
  });

  it('ArrowDown/ArrowUp andam na coluna', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    screen.getByLabelText('Estoque inicial de Preto · P').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Estoque inicial de Branco · P')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).toHaveFocus();
  });

  // A seta lateral só muda de célula na BORDA do valor — no meio do texto ela é o cursor, e
  // roubar isso torna impossível corrigir um dígito no meio de um GTIN de 13 caracteres.
  it('ArrowRight no meio do texto move o cursor, não a célula', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '123' };
    montar(linhas);
    const campo = screen.getByLabelText('Estoque inicial de Preto · P') as HTMLInputElement;
    campo.focus();
    campo.setSelectionRange(1, 1);
    await user.keyboard('{ArrowRight}');
    expect(campo).toHaveFocus();
  });

  it('ArrowRight na borda direita do valor pula para a célula ao lado', async () => {
    const user = userEvent.setup();
    const linhas = gradeCheia();
    linhas[0] = { ...linhas[0]!, estoqueInicial: '123' };
    montar(linhas);
    const campo = screen.getByLabelText('Estoque inicial de Preto · P') as HTMLInputElement;
    campo.focus();
    campo.setSelectionRange(3, 3);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Estoque inicial de Preto · M')).toHaveFocus();
  });

  // Tab/Shift+Tab são do NAVEGADOR: a ordem do DOM já é coluna-dentro-de-linha. Interceptá-los
  // quebraria a saída da matriz para o resto do formulário.
  it('Tab não é interceptado — segue a ordem do DOM', async () => {
    const user = userEvent.setup();
    montar(gradeCheia());
    screen.getByLabelText('Estoque inicial de Preto · P').focus();
    await user.tab();
    expect(screen.getByLabelText('Estoque inicial de Preto · P')).not.toHaveFocus();
  });
});

import { describe, expect, it } from 'vitest';
import {
  aplicarEmMassa, chaveGrade, novaLinhaGrade, ordenarEixos, reconciliarGrade, resolverLinha,
  totaisDaGrade, totalDaGrade, type CamposHerdaveis,
} from '@/lib/cadastro-grade';

const semLinhas: { cor: string; tamanho: string }[] = [];

describe('reconciliarGrade', () => {
  it('cor sem tamanho (ou tamanho sem cor) não gera nada — na grade toda linha tem os 2 eixos', () => {
    expect(reconciliarGrade(['Azul'], [], new Set(), semLinhas).novas).toEqual([]);
    expect(reconciliarGrade([], ['P'], new Set(), semLinhas).novas).toEqual([]);
  });

  it('cartesiano na ordem cor-externa, tamanho-interno', () => {
    expect(reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), semLinhas).novas).toEqual([
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('marcar um tamanho a mais devolve SÓ as combinações novas', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }, { cor: 'Preto', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([{ cor: 'Azul', tamanho: 'M' }, { cor: 'Preto', tamanho: 'M' }]);
    expect(r.remover).toEqual([]);
  });

  it('desmarcar um eixo devolve só as chaves daquele eixo em remover', () => {
    const atuais = [
      { cor: 'Azul', tamanho: 'P' }, { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' }, { cor: 'Preto', tamanho: 'M' },
    ];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M')]);
  });

  it('combinação já existente marcada de novo não duplica', () => {
    const atuais = [{ cor: 'Azul', tamanho: 'P' }];
    const r = reconciliarGrade(['Azul'], ['P'], new Set(), atuais);
    expect(r.novas).toEqual([]);
    expect(r.remover).toEqual([]);
  });

  // Grade parcial: o operador removeu Azul/P na mão e os DOIS eixos continuam marcados.
  it('combinação removida na mão NÃO reaparece enquanto os dois eixos seguem marcados', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const atuais = [{ cor: 'Azul', tamanho: 'M' }];
    const r = reconciliarGrade(['Azul'], ['P', 'M'], removidas, atuais);
    expect(r.novas).toEqual([]);
    expect(r.removidas).toEqual(removidas);
  });

  // Desmarcar "Azul" já É a ação de "não quero Azul"; remarcar é "quero Azul por completo".
  it('desmarcar um eixo inteiro LIMPA a exclusão manual daquele eixo', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    // Azul desmarcado: a exclusão some do conjunto devolvido.
    const semAzul = reconciliarGrade(['Preto'], ['P', 'M'], removidas, semLinhas);
    expect(semAzul.removidas.size).toBe(0);
    // Remarcado a partir do conjunto já podado: Azul/P volta.
    const comAzul = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], semAzul.removidas, semLinhas);
    expect(comAzul.novas).toContainEqual({ cor: 'Azul', tamanho: 'P' });
  });

  it('ordem canônica devolve o cartesiano menos as exclusões, agrupado por cor', () => {
    const removidas = new Set([chaveGrade('Azul', 'P')]);
    const r = reconciliarGrade(['Azul', 'Preto'], ['P', 'M'], removidas, semLinhas);
    expect(r.ordem).toEqual([
      chaveGrade('Azul', 'M'), chaveGrade('Preto', 'P'), chaveGrade('Preto', 'M'),
    ]);
  });
});

describe('totalDaGrade', () => {
  it('é o cartesiano menos as exclusões manuais ainda válidas', () => {
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set())).toBe(4);
    expect(totalDaGrade(['Azul', 'Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(3);
  });

  it('exclusão de um eixo já desmarcado não conta (seria um desconto fantasma)', () => {
    expect(totalDaGrade(['Preto'], ['P', 'M'], new Set([chaveGrade('Azul', 'P')]))).toBe(2);
  });

  it('um eixo vazio zera o total — grade exige os dois', () => {
    expect(totalDaGrade(['Azul'], [], new Set())).toBe(0);
  });
});

const CABECALHO: CamposHerdaveis = {
  preco: '99,90', custo: '40', pesoGramas: '300',
  alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
};

describe('resolverLinha', () => {
  it('sem override, todo campo resolve para o valor do cabeçalho', () => {
    const r = resolverLinha(CABECALHO, {}, novaLinhaGrade('Azul', 'M'));
    expect(r.preco).toBe('99,90');
    expect(r.custo).toBe('40');
    expect(r.comprimentoCm).toBe('30');
  });

  it('override vale só para o campo destravado — os outros seguem herdando', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const r = resolverLinha(CABECALHO, {}, linha);
    expect(r.preco).toBe('129,90');
    expect(r.custo).toBe('40');
  });

  it('cabeçalho mudando depois não afeta campo com override', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { preco: '129,90' } };
    const r = resolverLinha({ ...CABECALHO, preco: '10' }, {}, linha);
    expect(r.preco).toBe('129,90');
    expect(r.custo).toBe('40');
  });

  it('"Voltar a herdar" (apagar a chave do override) volta a resolver do cabeçalho', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: {} };
    expect(resolverLinha(CABECALHO, {}, linha).preco).toBe('99,90');
  });

  // Override de string VAZIA é uma decisão do operador ("não quero custo nesta linha"), não
  // "ainda não mexi" — tem que vencer o cabeçalho, senão o campo nunca fica limpável.
  it('override vazio vence o cabeçalho em vez de cair na herança', () => {
    const linha = { ...novaLinhaGrade('Azul', 'M'), overrides: { custo: '' } };
    expect(resolverLinha(CABECALHO, {}, linha).custo).toBe('');
  });

  it('cabeçalho vazio resolve para vazio, não para estado quebrado', () => {
    const vazio: CamposHerdaveis = {
      preco: '', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '',
    };
    expect(resolverLinha(vazio, {}, novaLinhaGrade('Azul', 'M')).preco).toBe('');
  });

  it('foto vem da COR quando a linha não tem override de foto', () => {
    const azul = new File([''], 'azul.jpg');
    const r = resolverLinha(CABECALHO, { Azul: azul }, novaLinhaGrade('Azul', 'M'));
    expect(r.foto).toBe(azul);
  });

  it('foto destravada individualmente vence a foto da cor', () => {
    const azul = new File([''], 'azul.jpg');
    const propria = new File([''], 'propria.jpg');
    const linha = { ...novaLinhaGrade('Azul', 'M'), foto: propria };
    expect(resolverLinha(CABECALHO, { Azul: azul }, linha).foto).toBe(propria);
  });

  it('foto destravada e ESVAZIADA (null) não volta a herdar a da cor', () => {
    const azul = new File([''], 'azul.jpg');
    const linha = { ...novaLinhaGrade('Azul', 'M'), foto: null as File | null };
    expect(resolverLinha(CABECALHO, { Azul: azul }, linha).foto).toBeNull();
  });

  it('cor sem foto nenhuma resolve para null', () => {
    expect(resolverLinha(CABECALHO, {}, novaLinhaGrade('Azul', 'M')).foto).toBeNull();
  });
});

describe('ordenarEixos', () => {
  const ORDEM = {
    cores: ['Preto', 'Branco', 'Cinza'] as const,
    tamanhos: ['P', 'M', 'G', 'GG'] as const,
  };

  // O bug latente que esta função corrige: `Set` preserva ORDEM DE CLIQUE, e o operador que
  // marcou G antes de P via a coluna "G, M, P". Na lista de cards ninguém percebia.
  it('tamanho marcado fora de ordem sai na ordem canônica', () => {
    const r = ordenarEixos(new Set(['Preto']), new Set(['G', 'P', 'M']), ORDEM);
    expect(r.tamanhos).toEqual(['P', 'M', 'G']);
  });

  it('cor marcada fora de ordem sai em ordem alfabética (pt-BR)', () => {
    const r = ordenarEixos(new Set(['Cinza', 'Preto']), new Set(['P']), ORDEM);
    expect(r.cores).toEqual(['Cinza', 'Preto']);
  });

  it('cor personalizada entra na ordem alfabética junto com as demais', () => {
    const cores = new Set<string>();
    cores.add('Vinho'); cores.add('Branco'); cores.add('Caqui'); cores.add('Preto');
    const r = ordenarEixos(cores, new Set(['P']), ORDEM);
    expect(r.cores).toEqual(['Branco', 'Caqui', 'Preto', 'Vinho']);
  });

  it('eixo vazio devolve array vazio, sem inventar valor', () => {
    expect(ordenarEixos(new Set(), new Set(['P']), ORDEM)).toEqual({ cores: [], tamanhos: ['P'] });
  });

  // Numeração de calçado: a ordem canônica é a da lista, não a alfabética nem a numérica —
  // '33/34' vem DEPOIS de '46' em NUMERACOES_CALCADO, e ordenar por número quebraria isso.
  it('respeita a ordem da lista, não a ordem numérica', () => {
    const ordem = { cores: ['Preto'] as const, tamanhos: ['39', '40', '39/40'] as const };
    const r = ordenarEixos(new Set(['Preto']), new Set(['39/40', '40', '39']), ordem);
    expect(r.tamanhos).toEqual(['39', '40', '39/40']);
  });
});

describe('totaisDaGrade', () => {
  const CAB: CamposHerdaveis = {
    preco: '99,90', custo: '40', pesoGramas: '300',
    alturaCm: '5', larguraCm: '20', comprimentoCm: '30',
  };
  const linha = (cor: string, tam: string, estoque: string, gtin = '') => resolverLinha(
    CAB, {}, { ...novaLinhaGrade(cor, tam), estoqueInicial: estoque, gtin },
  );

  it('soma unidades por cor, por tamanho e no geral', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', '2'), linha('Preto', 'M', '3'), linha('Branco', 'P', '4')],
      ['Preto', 'Branco'], ['P', 'M'],
    );
    expect(t.porCor).toEqual({ Preto: 5, Branco: 4 });
    expect(t.porTamanho).toEqual({ P: 6, M: 3 });
    expect(t.geral).toBe(9);
  });

  // Eixo cujas células foram TODAS removidas na mão continua sendo coluna/linha da matriz — o
  // total dele é 0, não "ausente". Sem isto o rodapé perderia a coluna e desalinharia da tabela.
  it('eixo sem nenhuma linha resolvida vale 0, não some', () => {
    const t = totaisDaGrade([linha('Preto', 'P', '2')], ['Preto', 'Branco'], ['P', 'M']);
    expect(t.porCor).toEqual({ Preto: 2, Branco: 0 });
    expect(t.porTamanho).toEqual({ P: 2, M: 0 });
  });

  // `parseNum` devolve NaN em texto inválido e null em vazio — nenhum dos dois pode contaminar a
  // soma com NaN, senão o rodapé inteiro exibe "NaN unidades" por causa de UMA célula.
  it('estoque vazio ou inválido conta 0, nunca NaN', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', ''), linha('Preto', 'M', 'abc'), linha('Preto', 'G', '7')],
      ['Preto'], ['P', 'M', 'G'],
    );
    expect(t.geral).toBe(7);
    expect(t.porCor.Preto).toBe(7);
  });

  it('conta SKUs sem GTIN', () => {
    const t = totaisDaGrade(
      [linha('Preto', 'P', '1', '789'), linha('Preto', 'M', '1'), linha('Preto', 'G', '1', '   ')],
      ['Preto'], ['P', 'M', 'G'],
    );
    expect(t.semGtin).toBe(2);
  });

  it('grade vazia devolve zeros, não erro', () => {
    expect(totaisDaGrade([], [], [])).toEqual({ porCor: {}, porTamanho: {}, geral: 0, semGtin: 0 });
  });
});

describe('aplicarEmMassa', () => {
  const grade = () => [
    novaLinhaGrade('Preto', 'P'), novaLinhaGrade('Preto', 'G'),
    novaLinhaGrade('Branco', 'P'), novaLinhaGrade('Branco', 'G'),
  ];

  it('escopo "todos" atinge a grade inteira', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '10',
    });
    expect(r.map((l) => l.estoqueInicial)).toEqual(['10', '10', '10', '10']);
  });

  it('escopo "cor" atinge só as linhas daquela cor', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'estoqueInicial', escopo: { tipo: 'cor', valor: 'Preto' }, valor: '5',
    });
    expect(r.map((l) => l.estoqueInicial)).toEqual(['5', '5', '', '']);
  });

  // O fluxo real do Diego: preço diferente só no tamanho maior, resto continua herdando.
  it('escopo "tamanho" cria override só naquela coluna; o resto segue herdando', () => {
    const r = aplicarEmMassa(grade(), {
      campo: 'preco', escopo: { tipo: 'tamanho', valor: 'G' }, valor: '64,90',
    });
    expect(r.map((l) => l.overrides.preco)).toEqual([undefined, '64,90', undefined, '64,90']);
    // `undefined` por AUSÊNCIA da chave, não por valor `undefined` gravado: `resolverLinha` usa
    // `campo in overrides`, então uma chave presente com undefined resolveria para undefined.
    expect('preco' in r[0]!.overrides).toBe(false);
  });

  it('valor null num campo herdável REMOVE o override (volta a herdar)', () => {
    const linhas = grade().map((l) => ({ ...l, overrides: { preco: '129,90', custo: '50' } }));
    const r = aplicarEmMassa(linhas, {
      campo: 'preco', escopo: { tipo: 'todos' }, valor: null,
    });
    expect('preco' in r[0]!.overrides).toBe(false);
    // Só o campo pedido: o custo destravado continua destravado.
    expect(r[0]!.overrides.custo).toBe('50');
  });

  it('valor null em estoque/GTIN LIMPA para string vazia, não remove nada', () => {
    const linhas = grade().map((l) => ({ ...l, gtin: '789', estoqueInicial: '3' }));
    const r = aplicarEmMassa(linhas, { campo: 'gtin', escopo: { tipo: 'todos' }, valor: null });
    expect(r.map((l) => l.gtin)).toEqual(['', '', '', '']);
    expect(r.map((l) => l.estoqueInicial)).toEqual(['3', '3', '3', '3']);
  });

  // Regra inegociável: nenhuma função desta entrega inventa GTIN. Um "preencher em massa" que
  // gerasse sequência produziria código de barras falso num anúncio real.
  it('nunca gera GTIN — só escreve o que foi passado', () => {
    const r = aplicarEmMassa(grade(), { campo: 'gtin', escopo: { tipo: 'todos' }, valor: '789' });
    expect(r.map((l) => l.gtin)).toEqual(['789', '789', '789', '789']);
  });

  // TRAVA DO CASAMENTO POSICIONAL: a função é um `map` e nada mais. Um `filter`/`sort`/`concat`
  // aqui dentro desalinharia `linhas[i] ↔ resolvidas[i]` — o mesmo desalinho do bug f4a6df68.
  it('preserva contagem, ordem e identidade das linhas', () => {
    const entrada = grade();
    const saida = aplicarEmMassa(entrada, {
      campo: 'preco', escopo: { tipo: 'cor', valor: 'Preto' }, valor: '1',
    });
    expect(saida).toHaveLength(entrada.length);
    expect(saida.map((l) => l.clientId)).toEqual(entrada.map((l) => l.clientId));
    expect(saida.map((l) => `${l.cor}/${l.tamanho}`))
      .toEqual(entrada.map((l) => `${l.cor}/${l.tamanho}`));
  });

  it('não muta o array nem as linhas de entrada', () => {
    const entrada = grade();
    aplicarEmMassa(entrada, { campo: 'estoqueInicial', escopo: { tipo: 'todos' }, valor: '9' });
    expect(entrada.map((l) => l.estoqueInicial)).toEqual(['', '', '', '']);
  });
});

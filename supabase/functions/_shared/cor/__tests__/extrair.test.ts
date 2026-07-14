import { describe, it, expect } from 'vitest';
import { extrairCorDoTexto, extrairCorDeVariacao } from '../extrair';

describe('extrairCorDoTexto', () => {
  it('retorna null quando nenhuma cor é encontrada', () => {
    expect(extrairCorDoTexto(['LINHA P/COST.XIK 120 2000J 455'])).toBeNull();
  });

  it('encontra cor case-insensitive', () => {
    expect(extrairCorDoTexto(['LINHA VERMELHA PARA COSTURA'])).toBe('Vermelho');
    expect(extrairCorDoTexto(['fita preta 5mm'])).toBe('Preto');
  });

  it('respeita word boundary (não casa azulejado com azul)', () => {
    expect(extrairCorDoTexto(['piso azulejado decorado'])).toBeNull();
  });

  it('prefere sinônimo mais longo (azul royal antes de azul)', () => {
    expect(extrairCorDoTexto(['Linha azul royal premium'])).toBe('Azul Royal');
  });

  it('busca em múltiplos textos do array', () => {
    expect(extrairCorDoTexto(['código opaco', 'descrição: fita pink neon'])).toBe('Rosa Neon');
  });

  it('retorna a forma canônica (não a forma do texto)', () => {
    expect(extrairCorDoTexto(['cor: PRETA 100% poliéster'])).toBe('Preto');
    expect(extrairCorDoTexto(['cru natural'])).toBe('Cru');
  });

  it('ignora arrays vazios ou strings vazias', () => {
    expect(extrairCorDoTexto([])).toBeNull();
    expect(extrairCorDoTexto(['', '', null as unknown as string])).toBeNull();
  });
});

describe('extrairCorDoTexto — regressão lote #24', () => {
  it('Salmon (grafia inglesa) → Salmão', () => {
    expect(extrairCorDoTexto(['Tecido Oxford Liso Salmon de 10 mt para Uniforme e Decoração'])).toBe('Salmão');
  });

  it('Rosa Pink não perde o Pink (cor composta cadastrada no dicionário)', () => {
    expect(extrairCorDoTexto(['Tecido Oxford Liso Rosa Pink de 10 mt para Uniforme e Decoração'])).toBe('Rosa Pink');
  });
});

describe('extrairCorDeVariacao', () => {
  // A descrição detalhada é prosa de marketing por família: contém cores incidentais
  // que não nomeiam a cor do produto. Documenta o falso positivo que motivou o helper.
  const DESCRICAO_INCIDENTAL =
    'A LINHA DE CIMA (QUE FAZ O DESENHO COLORIDO) É MAIS GROSSA. USAR A MESMA LINHA BRILHANTE.';

  it('o dicionário casaria "colorido" da prosa como Multicolor (motivação do helper)', () => {
    expect(extrairCorDoTexto([DESCRICAO_INCIDENTAL])).toBe('Multicolor');
  });

  it('não usa a descrição: nome sem cor + descrição com cor incidental → null (cai no Vision)', () => {
    expect(
      extrairCorDeVariacao('LINHA 100% POLIESTER 150 15000MT', 'LINHA 100% POLIESTER 150 15000MT'),
    ).toBeNull();
  });

  it('extrai a cor quando está no nome da variação', () => {
    expect(extrairCorDeVariacao('LINHA P/COSTURA 1500MT BRANCO', 'LINHA P/COSTURA 1500MT CORES')).toBe('Branco');
  });

  it('extrai a cor quando está no nome do pai (família de cor única)', () => {
    expect(extrairCorDeVariacao('LINHA POLIESTER', 'LINHA POLIESTER PRETA')).toBe('Preto');
  });
});

import { extrairCorECodigo } from '../extrair';

describe('extrairCorECodigo', () => {
  it('código + cor literal (perde nada): VERMELHO TOMATE', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT'))
      .toEqual({ cor: 'Vermelho Tomate', codigo: '1354' });
  });
  it('expande abreviações: AZ TIFFANY → Azul Tiffany', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 247 AZ TIFFANY 10MT'))
      .toEqual({ cor: 'Azul Tiffany', codigo: '247' });
  });
  it('expande VD LIMA → Verde Lima', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2036 VD LIMA 10MT'))
      .toEqual({ cor: 'Verde Lima', codigo: '2036' });
  });
  it('expande AMA CL → Amarelo Claro', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2052 AMA CL 10MT'))
      .toEqual({ cor: 'Amarelo Claro', codigo: '2052' });
  });
  it('preserva zero à esquerda no código: 009', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 009 ROSA PETALA 10MT'))
      .toEqual({ cor: 'Rosa Pétala', codigo: '009' });
  });
  it('restaura acento de palavra única: SALMAO → Salmão', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 392 SALMAO 10MT'))
      .toEqual({ cor: 'Salmão', codigo: '392' });
  });
  it('restaura acento mantendo o resto literal: LRJ CITRICO → Lrj Cítrico', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 278 LRJ CITRICO 10MT'))
      .toEqual({ cor: 'Lrj Cítrico', codigo: '278' });
  });
  it('acento com abreviação no início: VD BOTANICO → Verde Botânico', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2017 VD BOTANICO 10MT'))
      .toEqual({ cor: 'Verde Botânico', codigo: '2017' });
  });
  it('palavra sem acento conhecido fica title-case: AMARANTO', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2055 RS AMARANTO 10MT'))
      .toEqual({ cor: 'Rs Amaranto', codigo: '2055' });
  });
  it('vários dígitos: usa o último seguido de letras (10 BCA → Branco 10)', () => {
    expect(extrairCorECodigo('LINHA P/COST.XIK 120 2000J 10 BCA'))
      .toEqual({ cor: 'Branco', codigo: '10' });
  });
  it('sem dígito antes da cor → null (cai no dicionário)', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.3 PRETO 10MT')).toBeNull();
  });
  it('ignora o tamanho (10MT) e tokens mistos', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1355 MARSALA 10MT'))
      .toEqual({ cor: 'Marsala', codigo: '1355' });
  });
  it('metragem separada ("10 mt ...") não é código+cor → null (bug lote #48)', () => {
    expect(extrairCorECodigo('Tecido Oxford Liso Branco de 10 mt para Uniforme e Decoração'))
      .toBeNull();
  });
});

describe('extrairCorDeVariacao com metragem separada (regressão lote #48)', () => {
  it('cai no dicionário e acha a cor do nome, não a frase da metragem', () => {
    expect(
      extrairCorDeVariacao(
        'Tecido Oxford Liso Branco de 10 mt para Uniforme e Decoração',
        'Tecido Oxford Liso de 10 m para Uniforme e Decoração',
      ),
    ).toBe('Branco');
  });
});

describe('extrairCorECodigo — regressão lote #33', () => {
  // "...901 AZ PISCINA UND" virava null (UND contava como 3ª palavra e estourava o
  // limite de 2), caindo no Vision — que colidiu com outra cor da mesma família
  // ("VD AGUA CL") no mesmo canônico "Azul Claro" por falta de bucket certo.
  it('sufixo de unidade do fornecedor (UND) no fim não conta como palavra da cor', () => {
    expect(extrairCorECodigo('EUROROMA FIORE 8/4 150G 500MT 901 AZ PISCINA UND'))
      .toEqual({ cor: 'Azul Piscina', codigo: '901' });
  });

  it('mesmo caso sem o sufixo UND já funcionava (referência)', () => {
    expect(extrairCorECodigo('EUROROMA FIORE 8/4 150G 500MT 901 AZ PISCINA'))
      .toEqual({ cor: 'Azul Piscina', codigo: '901' });
  });

  it('outro caso real do lote #33: ANIL PROFUNDO UND', () => {
    expect(extrairCorECodigo('CLEA DUPLO COR 2856 ANIL PROFUNDO UND'))
      .toEqual({ cor: 'Anil Profundo', codigo: '2856' });
  });

  it('cor de 3 palavras + UND continua null (limite de 2 palavras continua valendo)', () => {
    expect(extrairCorECodigo('EUROROMA FIORE 8/4 150G 500MT 800 VD AGUA CL UND')).toBeNull();
  });
});

describe('extrairCorDoTexto — regressão lote #30', () => {
  it('Champagne é cor própria (não colapsa pra "Bege")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Champagne Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Champagne');
  });

  it('Marfin é reconhecido e normalizado pra "Marfim" (não colapsa pra "Bege")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Marfin Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Marfim');
  });

  it('Azul Petróleo mantém o qualificador (não colapsa pra "Petróleo")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Azul Petróleo Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Azul Petróleo');
  });

  it('Cinza Médio mantém o qualificador (não colapsa pra "Cinza")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Cinza Médio Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Cinza Médio');
  });

  it('Amarelo Canário mantém o qualificador (não colapsa pra "Amarelo")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Amarelo Canário Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Amarelo Canário');
  });

  it('Roxo Médio mantém o qualificador (não colapsa pra "Roxo")', () => {
    expect(extrairCorDoTexto(['Tecido Helanca Light Roxo Médio Lycra Tensionada 3,00 X 1,80 Metros'])).toBe('Roxo Médio');
  });
});

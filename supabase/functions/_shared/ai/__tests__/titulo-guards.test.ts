import { describe, it, expect } from 'vitest';
import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('normalizarSlots', () => {
  it('expande abreviação de planilha', () => {
    const s = normalizarSlots(slots({ produto: 'COLCHETE C/GANCHO', compatibilidade: 'P/ZIPER DE NYLON' }));
    expect(s.produto).toBe('COLCHETE COM GANCHO');
    expect(s.compatibilidade).toBe('PARA ZIPER DE NYLON');
  });

  it('descarta ruído de planilha sem valor de busca', () => {
    expect(normalizarSlots(slots({ modelo: 'TAM UND' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'TAM VR' })).modelo).toBe('');
    expect(normalizarSlots(slots({ variacao: 'CORES' })).variacao).toBe('');
  });

  it('remove código interno de estoque', () => {
    expect(normalizarSlots(slots({ modelo: 'T-007' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'BAR-03-VR' })).modelo).toBe('');
  });

  it('preserva numeração que o consumidor usa', () => {
    expect(normalizarSlots(slots({ modelo: 'N.3' })).modelo).toBe('N.3');
    expect(normalizarSlots(slots({ modelo: '4/6' })).modelo).toBe('4/6');
    expect(normalizarSlots(slots({ modelo: 'TEX 29' })).modelo).toBe('TEX 29');
  });

  it('colapsa espaço e apara', () => {
    expect(normalizarSlots(slots({ produto: '  NOVELO   LINHA  ' })).produto).toBe('NOVELO LINHA');
  });

  it('remove pipe e caractere decorativo de qualquer slot', () => {
    expect(normalizarSlots(slots({ produto: 'FITA | CETIM ESPECIAL' })).produto).toBe('FITA CETIM ESPECIAL');
    expect(normalizarSlots(slots({ material: '100% POLIESTER ★' })).material).toBe('100% POLIESTER');
  });

  // Achado do experimento A/B: unidade por extenso/abreviada com espaço que a IA escreve no
  // slot atravessava o pipeline intocada quando a fonte não tinha medida nenhuma pra ancorar o
  // guard de dimensão em aplicarGuardsTitulo ("Linha Tex 376 500 Metros Polipropileno").
  it('canonicaliza unidade de medida escrita pela IA', () => {
    const casos: Array<[string, string]> = [
      ['500 Metros', '500m'],
      ['10 METROS', '10m'],
      ['13,71 MT', '13,71m'],
      ['500 GR', '500g'],
      ['1 KG', '1kg'],
      ['250 ML', '250ml'],
      ['10 UNIDADES', '10un'],
      ['12 PEÇAS', '12pc'],
      ['25MM', '25mm'],
      ['3,5 CM', '3,5cm'],
      ['Tex 376', 'Tex 376'],
      ['Metros de Fita', 'Metros de Fita'],
      ['N.3', 'N.3'],
      ['10X15CM', '10X15CM'],
    ];
    for (const [entrada, esperado] of casos) {
      expect(normalizarSlots(slots({ medida: entrada })).medida).toBe(esperado);
    }
  });

  // Achado do revisor: RE_DIMENSAO_COMPOSTA só absorve unidade colada/abreviada (mm|cm|m) no
  // próprio sufixo opcional — uma unidade por EXTENSO depois da composta ficava com o dígito já
  // consumido pela composta e sem número pra ancorar, atravessando intocada.
  it('gruda unidade por extenso que vem logo depois de uma dimensão composta', () => {
    expect(normalizarSlots(slots({ medida: '10 X 15 Centimetros' })).medida).toBe('10 X 15cm');
    expect(normalizarSlots(slots({ medida: '3,00 X 1,80 Metros' })).medida).toBe('3,00 X 1,80m');
  });

  // Sem abreviação de uma letra só: "G"/"L" colidem com tamanho de roupa (P/M/G/GG) e com a
  // convenção de fornecedor "L.CLEA" deste catálogo — fora do que o plano pediu.
  it('NÃO converte abreviação de uma letra só (fora do escopo do plano)', () => {
    expect(normalizarSlots(slots({ variacao: '3 G' })).variacao).toBe('3 G');
    expect(normalizarSlots(slots({ produto: '2 L.CLEA' })).produto).toBe('2 L.CLEA');
    expect(normalizarSlots(slots({ medida: '10 M' })).medida).toBe('10 M');
  });
});

describe('aplicarGuardsTitulo', () => {
  it('crava a metragem do nome quando a IA a omitiu', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA CETIM' }), fonte({ nomePai: 'FITA CETIM N.3 100MT' }));
    expect(s.medida).toContain('100m');
  });

  it('corrige metragem arredondada pela IA', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'BORDADO', medida: '13,7m' }), fonte({ nomePai: 'BORDADO C/13,71MT' }));
    expect(s.medida).toContain('13,71m');
    expect(s.medida).not.toContain('13,7m ');
  });

  it('preserva dimensão composta quando a IA a traz SOZINHA', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA', medida: '10X15CM' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND', descricaoPai: 'LARGURA: 10CM.' }),
    );
    expect(s.medida).toContain('10X15CM');
  });

  it('preserva dimensão composta quando a IA a traz JUNTO com a metragem — o caso que se perdia', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA', medida: '10X20CM 50m' }),
      fonte({ nomePai: 'FITA 10X20CM C/50MT' }),
    );
    expect(s.medida).toContain('10X20CM');
    expect(s.medida).toContain('50m');
  });

  it('não duplica a medida que a dimensão composta já expressa (Tecido Helanca real)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'TECIDO HELANCA LIGHT', medida: '3,00 X 1,80' }),
      fonte({ nomePai: 'Tecido Helanca Light  Lycra Tensionada 3,00 X 1,80 Metros' }),
    );
    expect(s.medida).toContain('3,00 X 1,80');
    expect(s.medida.match(/1,80/g)).toHaveLength(1);
  });

  it('não confunde a inicial de "Metros" por extenso com unidade da dimensão', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'TECIDO HELANCA LIGHT', medida: '3,00 X 1,80 Metros' }),
      fonte({ nomePai: 'Tecido Helanca Light  Lycra Tensionada 3,00 X 1,80 Metros' }),
    );
    expect(s.medida).not.toMatch(/\bM$/);
    expect(s.medida).toContain('3,00 X 1,80');
  });

  it('acrescenta a largura grounded à medida', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LANTEJOULA', medida: '50m' }),
      fonte({ nomePai: 'LANTEJOULAS C/50MT', descricaoPai: 'LARGURA: 6MM.' }),
    );
    expect(s.medida).toContain('6mm');
  });

  it('crava a quantidade grounded', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
    );
    expect(s.quantidade).toBe('10un');
  });

  it('não crava quantidade quando a contagem é 1 — boilerplate da planilha', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA CETIM' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3 16MM CORES 10MT', descricaoPai: 'FITA DE CETIM N.3. CONTÉM: 1 UNIDADE DE PEÇA COM 10 METROS.' }),
    );
    expect(s.quantidade).toBe('');
  });

  it('crava quantidade quando é maior que 1', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
    );
    expect(s.quantidade).toBe('10un');
  });

  it('descarta valor não-contagem que a IA pôs em quantidade (caso real: metragem)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FRANJA', medida: '5cm', quantidade: '5m' }),
      fonte({ nomePai: 'FRANJA 5MM 100%FIBRA DE POLI 5MT' }),
    );
    expect(s.quantidade).toBe('');
    // e a metragem não pode acabar duplicada entre medida e quantidade
    expect(`${s.medida} ${s.quantidade}`.match(/5m\b/g) ?? []).toHaveLength(1);
  });

  it('descarta contagem 1 vinda da IA, não só a vinda da fonte', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'PROTETOR SOLAR', quantidade: '1un' }),
      fonte({ nomePai: 'Protetor Solar Facial FPS 60 50ml' }),
    );
    expect(s.quantidade).toBe('');
  });

  it('a contagem da fonte vence a da IA', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA', quantidade: '3un' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
    );
    expect(s.quantidade).toBe('10un');
  });

  // Dedup cross-slot (lote #65 metragem, lote #40 contagem): a fonte já cravou medida/
  // quantidade acima; menção sobrevivente em QUALQUER outro slot é duplicata (quase sempre
  // arredondada pela IA) e precisa sumir — o guard antigo (garantirMetragemTitulo) limpava a
  // string inteira, o pipeline de slots só limpava o próprio slot `medida`/`quantidade`.
  it('remove metragem duplicada/arredondada de `produto` quando a fonte crava medida (lote #65)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'BORDADO INGLES BUFALO T-007 13,7MT' }),
      fonte({ nomePai: 'BORDADO INGLES BUFALO T-007 C/13,71MT' }),
    );
    expect(s.produto).toBe('BORDADO INGLES BUFALO T-007');
    expect(s.medida).toBe('13,71m');
  });

  it('remove metragem duplicada de `modelo` quando a fonte crava medida (variante lote #65)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'BORDADO INGLES BUFALO TC-002', modelo: '13,7MT' }),
      fonte({ nomePai: 'BORDADO INGLES BUFALO TC-002 C/13,71MT' }),
    );
    expect(s.modelo).toBe('');
    expect(s.medida).toBe('13,71m');
  });

  it('remove contagem duplicada de `produto` quando a fonte crava quantidade (lote #40)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA 10X15CM C/100UND' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES', descricaoPai: 'Pacote com 100 unidades.' }),
    );
    expect(s.produto).not.toMatch(/100\s*UND/i);
    expect(s.quantidade).toBe('100un');
  });

  it('NÃO mexe em slot sem metragem/contagem quando a fonte não crava nenhum dos dois (negativo)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LINHA SETTA XIK TEX 120', aplicacao: 'PARA MAQUINA DOMESTICA' }),
      fonte({ nomePai: 'LINHA SETTA XIK 2000J' }),
    );
    expect(s.produto).toBe('LINHA SETTA XIK TEX 120');
    expect(s.aplicacao).toBe('PARA MAQUINA DOMESTICA');
  });

  it('crava a cor no slot variacao quando há exatamente uma', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA' }), fonte({ cores: ['Branco'] }));
    expect(s.variacao).toBe('Branco');
  });

  it('não crava cor quando há várias (o comprador escolhe)', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA', variacao: 'AZUL' }), fonte({ cores: ['Branco', 'Preto'] }));
    expect(s.variacao).toBe('');
  });

  it('NUNCA crava cor indefinida no título (incidente do lote #31)', () => {
    for (const cor of ['Outra', '(sem cor identificada)']) {
      const s = aplicarGuardsTitulo(slots({ produto: 'COLA LIQUIDA SILICONE' }), fonte({ cores: [cor] }));
      expect(s.variacao, `cor "${cor}" vazou para o slot`).toBe('');
    }
  });

  it('crava o tipo de produto quando o nome não diz o que o produto é', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'EUROROMA 4/6' }),
      fonte({ nomePai: 'EUROROMA 4/6 CORES 600G', descricaoPai: 'BARBANTE PARA CROCHE', tipoProdutoBusca: 'barbante' }),
    );
    expect(s.produto.toUpperCase()).toContain('BARBANTE');
  });

  // Portado de titulo-tipo-produto.test.ts (deletado nesta task): não duplica quando o tipo já
  // está no produto. Fixture SEM metragem de propósito — a versão original tinha "4MT" em
  // nome_pai e produto, o que o fix de dedup cross-slot (rodada seguinte, lote #65) agora
  // remove de `produto` por ser duplicata da `medida`; misturar as duas checagens no mesmo
  // teste confundiria qual comportamento está sendo provado.
  it('não duplica o tipo de produto quando ele já está no produto', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'BAINHA INSTANTÂNEA UND' }),
      fonte({ nomePai: 'BAINHA INSTANTANEA', tipoProdutoBusca: 'bainha instantânea' }),
    );
    expect(s.produto).toBe('BAINHA INSTANTÂNEA UND');
  });

  // Portado de titulo-tipo-produto.test.ts: tipoProdutoBusca vazio não mexe no produto.
  it('tipoProdutoBusca vazio não mexe no produto', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'X Y' }), fonte({ tipoProdutoBusca: '' }));
    expect(s.produto).toBe('X Y');
  });

  // Portado de titulo-tipo-produto.test.ts ("BUG a evitar"): sem palavra >=3 letras não prefixa
  // às cegas — arriscaria duplicar (ex.: "FIO FIO DE COSTURA 100M").
  it('tipoProdutoBusca sem palavra significativa (>=3 letras) não prefixa às cegas', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO DE COSTURA 100M' }),
      fonte({ tipoProdutoBusca: 'e a' }),
    );
    expect(s.produto).toBe('FIO DE COSTURA 100M');
  });

  // Portado de titulo-tipo-produto.test.ts: caso de controle do fix desta task — prefixa
  // normalmente quando o tipo colado realmente NÃO está em nenhum slot (termoColado não pode
  // bloquear o caso legítimo).
  it('prefixa normalmente quando o tipo colado realmente não está em nenhum slot', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'BUFALO 14MM C/100UND' }),
      fonte({ nomePai: 'BUFALO 14MM C/100UND', tipoProdutoBusca: 'pompom' }),
    );
    expect(s.produto.toUpperCase().startsWith('POMPOM')).toBe(true);
  });

  it('usa o mapa para corrigir a grafia da marca', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', fornecedor: 'BUFALO' }),
    );
    expect(s.marca).toBe('Búfalo');
  });
});

describe('tipo de fio declarado no nome (ADR-0070)', () => {
  it('corrige FIO para LINHA quando a planilha diz L.CLEA', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO CLEA 1000' }),
      fonte({ nomePai: 'L.CLEA 1000 CORES', descricaoPai: 'LINHA CLÉA.' }),
    );
    expect(s.produto.toUpperCase()).toContain('LINHA');
    expect(s.produto.toUpperCase()).not.toMatch(/^FIO\b/);
  });

  it('corrige quando nome_pai declara BARBANTE por extenso', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LINHA ALGODAO' }),
      fonte({ nomePai: 'BARBANTE ALGODAO 600G', descricaoPai: '' }),
    );
    expect(s.produto.toUpperCase()).toContain('BARBANTE');
  });

  it('sem sinal em nome_pai não mexe — nunca inventa a partir da descrição', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO ECOAMIGURUMI' }),
      fonte({ nomePai: 'EUROROMA 160G', descricaoPai: 'LINHA RECICLADA.' }),
    );
    expect(s.produto.toUpperCase()).toMatch(/^FIO\b/);
  });

  // Portado de titulo-tipo-fio.test.ts (deletado nesta task): idempotência quando o produto
  // já usa o sinônimo certo — não pode reescrever à toa.
  it('não mexe quando já está correto (idempotente, sinônimo LINHA)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LINHA CLEA 125 CIRCULO' }),
      fonte({ nomePai: 'L.CLEA 125 CROCHE CORES' }),
    );
    expect(s.produto).toBe('LINHA CLEA 125 CIRCULO');
  });

  // Portado de titulo-tipo-fio.test.ts: idempotência do lado FIO (nome_pai declara FIO por
  // extenso e o produto já usa FIO) — cobre o outro sinônimo, não só LINHA.
  it('não mexe quando já está correto (idempotente, sinônimo FIO por extenso)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FIO NAUTICO CIRCULO 500G' }),
      fonte({ nomePai: 'FIO NAUTICO CORES UND 500G' }),
    );
    expect(s.produto).toBe('FIO NAUTICO CIRCULO 500G');
  });

  // Portado de titulo-tipo-fio.test.ts: a 1ª palavra não é sinônimo nenhum de tipo de fio —
  // corrigirTipoFio não pode mexer em palavra fora da lista fechada.
  it('não mexe quando a 1ª palavra do produto não é nenhum sinônimo de tipo de fio', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'CLÉA 1000 151,3G' }),
      fonte({ nomePai: 'L.CLEA 1000 CORES' }),
    );
    expect(s.produto).toBe('CLÉA 1000 151,3G');
  });

  // Portado (versão adaptada) de titulo-tipo-fio.test.ts "ordem correta com
  // garantirTipoProdutoTitulo". O teste original degenerava em no-op porque "FIO" já estava
  // presente no título antes do prefixo entrar em jogo. Esta versão realmente exercita a ordem:
  // o bloco de tipo de produto injeta "FIO DE CROCHÊ" como prefixo, e corrigirTipoFio, rodando
  // DEPOIS, corrige esse prefixo recém-injetado — prova que a ordem (depois do bloco de tipo)
  // importa de verdade.
  it('roda DEPOIS do bloco de tipo de produto e corrige o prefixo que ele acabou de injetar', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'CLEA 1000 151,3G' }),
      fonte({ nomePai: 'L.CLEA 1000 CORES', tipoProdutoBusca: 'fio de crochê' }),
    );
    expect(s.produto.toUpperCase()).toMatch(/^LINHA DE CROCH[ÊE]/);
  });
});

describe('dedup entre slots (lote #33)', () => {
  it('não recrava cor cujas palavras já estão em outro slot (lote #33)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LAPIS DE ESCREVER RESINA 7 VERDE' }),
      fonte({ nomePai: 'LAPIS DE ESCREVER RESINA 7 VERDE', cores: ['Verde 7'] }),
    );
    expect(s.variacao).toBe('');
  });

  it('crava a cor normalmente quando ela NÃO está em outro slot', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LAPIS DE ESCREVER RESINA' }),
      fonte({ nomePai: 'LAPIS DE ESCREVER RESINA', cores: ['Verde 7'] }),
    );
    expect(s.variacao).toBe('Verde 7');
  });

  it('não prefixa tipo de produto que já está na forma colada (lote #33)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'POM POM BUFALO' }),
      fonte({ nomePai: 'POM POM 14MM C/100UND CORES', descricaoPai: 'POMPOM DECORATIVO.', tipoProdutoBusca: 'pompom' }),
    );
    expect(s.produto.toLowerCase()).not.toContain('pompom pom pom');
  });

  // Portado de titulo-cor.test.ts (deletado nesta task): idempotência quando a cor já está
  // literalmente no produto — mesma trava do teste acima, caso de palavra única.
  it('é idempotente quando a cor já está literalmente em outro slot', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'ALFINETE DE SEGURANCA N.0 PRATA' }),
      fonte({ nomePai: 'ALFINETE DE SEGURANCA N.0 PRATA', cores: ['Prata'] }),
    );
    expect(s.variacao).toBe('');
  });

  // Portado de titulo-cor.test.ts: o dedup ignora acento na comparação (mesmo `normalizar` já
  // usado em todo o arquivo, ex.: marca "Búfalo"/"BUFALO").
  it('detecta cor já presente em outro slot ignorando acento', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'CADARCO CAFE 1,5CM' }), // sem acento no slot
      fonte({ nomePai: 'CADARCO CAFE 1,5CM', cores: ['Café'] }), // com acento na cor
    );
    expect(s.variacao).toBe('');
  });

  // Portado de titulo-cor.test.ts: cor multi-palavra PARCIALMENTE ausente (só "VERDE" está
  // presente, falta "7") ainda é cravada — o dedup exige TODAS as palavras cobertas, não just
  // uma. Preserva a diferenciação quando a cobertura é só parcial.
  it('cor multi-palavra parcialmente ausente em outro slot ainda é cravada', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LAPIS DE ESCREVER RESINA VERDE' }),
      fonte({ nomePai: 'LAPIS DE ESCREVER RESINA VERDE', cores: ['Verde 7'] }),
    );
    expect(s.variacao).toBe('Verde 7');
  });

  // Correção da rodada anterior (achado do revisor): suprimir `variacao` quando a cor está
  // coberta por um slot CORTÁVEL (aqui `modelo`) criava uma forma nova de perder o
  // discriminador — montarTitulo pode derrubar o slot cobridor no corte de 60 chars, e a cor
  // some do título inteiro. `corJaCoberta` agora só olha `produto`/`medida` (os únicos
  // INCORTÁVEIS, titulo-montar.ts), nunca `modelo` — cobertura ali não suprime.
  it('não suprime a cor quando quem a cobre é `modelo` (slot cortável, não incortável)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LAPIS DE ESCREVER RESINA', modelo: 'SL101066 VERDE 7' }),
      fonte({ nomePai: 'LAPIS DE ESCREVER RESINA SL101066', cores: ['Verde 7'] }),
    );
    expect(s.variacao).toBe('Verde 7');
  });
});

describe('validarSlotsAncorados', () => {
  it('remove marca que não aparece na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Detallia' }),
      fonte({ nomePai: 'FITAS DE VELUDO 20MM CORES', descricaoPai: 'FITA DE VELUDO.' }),
    );
    expect(s.marca).toBe('');
  });

  it('mantém marca ancorada, ignorando acento na comparação', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Búfalo' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', descricaoPai: '' }),
    );
    expect(s.marca).toBe('Búfalo');
  });

  it('NUNCA deixa nome da loja passar como marca', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Avil' }),
      fonte({ nomePai: 'FITA AVIL', descricaoPai: 'PRODUTO AVIL' }),
    );
    expect(s.marca).toBe('');
  });

  it('remove adjetivo vazio de qualquer slot', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', aplicacao: 'ALTA RESISTENCIA', sinonimo: 'QUALIDADE PREMIUM' }),
      fonte({ nomePai: 'FITA', descricaoPai: 'FITA DE CETIM.' }),
    );
    expect(s.aplicacao).toBe('');
    expect(s.sinonimo).toBe('');
  });

  it('remove sinônimo que não está na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'BARBANTE', sinonimo: 'CORDAO' }),
      fonte({ nomePai: 'BARBANTE EUROROMA', descricaoPai: 'BARBANTE PARA CROCHE.' }),
    );
    expect(s.sinonimo).toBe('');
  });

  it('mantém sinônimo presente na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'TECIDO HELANCA', sinonimo: 'HELANQUINHA' }),
      fonte({ nomePai: 'TECIDO HELANCA LIGHT', descricaoPai: 'CONHECIDO COMO HELANQUINHA.' }),
    );
    expect(s.sinonimo).toBe('HELANQUINHA');
  });

  it('remove adjetivo de marketing NÃO ancorado, por token (lote #28)', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'NOVO NOVELO ANNE' }),
      fonte({ nomePai: 'NOVELO ANNE 500MT', descricaoPai: 'NOVELO DE ALGODAO.' }),
    );
    expect(s.produto).toBe('NOVELO ANNE');
  });

  it('mantém o termo quando ele consta na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FIO PREMIUM' }),
      fonte({ nomePai: 'FIO DE MALHA EXTRA PREMIUM 25MM', descricaoPai: '' }),
    );
    expect(s.produto).toBe('FIO PREMIUM');
  });

  // Minor da rodada anterior: remover um token de marketing do MEIO/fim de um slot pode deixar
  // conectivo pendurado ("PARA ARTESANATO E NOVO" → remove "NOVO" → "PARA ARTESANATO E").
  it('remove conectivo solto que a remoção do token de marketing deixou no fim do slot', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA CETIM', medida: '10m', aplicacao: 'PARA ARTESANATO E NOVO' }),
      fonte({ nomePai: 'FITA CETIM', descricaoPai: 'FITA PARA ARTESANATO.' }),
    );
    expect(s.aplicacao).toBe('PARA ARTESANATO');
  });

  it('não confunde NOVO com NOVELO (comparação por token, nunca substring)', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'NOVELO ANNE' }),
      fonte({ nomePai: 'NOVELO ANNE 500MT', descricaoPai: '' }),
    );
    expect(s.produto).toBe('NOVELO ANNE');
  });
});

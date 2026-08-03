import { describe, it, expect } from 'vitest';
import { posProcessarTitulo } from '../titulo-pos';
import { type DadosFonteTitulo } from '../titulo-guards';
import { TituloInviavelError } from '../titulo-montar';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('posProcessarTitulo', () => {
  it('produz título no padrão ML, sem pipe e com unidade canônica', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO', modelo: 'N.3', material: '100% POLIESTER' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3 16MM CORES 10MT', descricaoPai: 'LARGURA: 16MM. 100% POLIESTER.', fornecedor: 'BUFALO' }),
    );
    expect(t).not.toContain('|');
    expect(t).toContain('10m');
    expect(t).toContain('Búfalo');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('é IDEMPOTENTE — mesma entrada, mesmo título, qualquer número de execuções', () => {
    const s = slots({ produto: 'LANTEJOULA', marca: 'BUFALO', material: 'PVC' });
    const f = fonte({ nomePai: 'LANTEJOULAS TAM 8 CORES C/50MT', descricaoPai: 'LANTEJOULA BÚFALO. LARGURA: 8MM.', fornecedor: 'BUFALO', cores: ['Prata'] });
    const um = posProcessarTitulo(s, f);
    const dois = posProcessarTitulo(s, f);
    const tres = posProcessarTitulo(s, f);
    expect(dois).toBe(um);
    expect(tres).toBe(um);
  });

  it('remove o adjetivo vazio que a IA insistiu em mandar', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA VELUDO', material: '100% POLIESTER', aplicacao: 'ALTA RESISTENCIA' }),
      fonte({ nomePai: 'FITAS VELUDO 16MM CORES C/25MTS', descricaoPai: '100% POLIESTER.' }),
    );
    expect(t.toLowerCase()).not.toContain('resist');
  });

  it('nunca deixa nome da loja virar marca', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA', marca: 'AVIL' }),
      fonte({ nomePai: 'FITA AVIL 10MT', descricaoPai: 'PRODUTO AVIL.', fornecedor: 'AVIL' }),
    );
    expect(t).not.toContain('Avil');
  });

  it('preserva a cor como discriminador quando a família é mono-cor', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA ESPECIAL PARA RENASCENCA', marca: 'CIRCULO', material: '100% ALGODAO' }),
      fonte({ nomePai: 'LINHA ESP. P/RENASCENCA COR BEGE C/10UND', descricaoPai: 'LINHA CÍRCULO 100% ALGODÃO.', fornecedor: 'CIRCULO S.A.', cores: ['Bege'] }),
    );
    expect(t).toContain('Bege');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('valida a ancoragem DEPOIS de cravar — marca do mapa sem menção na fonte não vaza', () => {
    // A ordem é o desenho: aplicarGuardsTitulo escreve a marca do mapa (grafia), e só então
    // validarSlotsAncorados a derruba por falta de respaldo na fonte. Invertida, a marca vaza.
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA', material: '100% ALGODAO' }),
      fonte({ nomePai: 'LINHA CONES CORES', descricaoPai: 'LINHA PARA COSTURA.', fornecedor: 'CIRCULO S.A.' }),
    );
    expect(t).not.toContain('Círculo');
    expect(t).toContain('Linha');
  });

  it('cor única vira discriminador protegido; várias cores não', () => {
    const base = {
      produto: 'LINHA ESPECIAL PARA RENASCENCA BORDADA MANUAL',
      material: '100% ALGODAO MERCERIZADO',
    };
    const fonteBase = {
      nomePai: 'LINHA ESP. P/RENASCENCA BORDADA MANUAL C/10UND',
      descricaoPai: 'LINHA 100% ALGODAO MERCERIZADO PARA BORDADO A MAO.',
    };
    const umaCor = posProcessarTitulo(slots(base), fonte({ ...fonteBase, cores: ['Bege Clarinho'] }));
    const variasCores = posProcessarTitulo(slots(base), fonte({ ...fonteBase, cores: ['Bege', 'Branco'] }));

    expect(umaCor).toContain('Bege Clarinho');   // protegida do corte
    expect(variasCores).not.toContain('Bege');   // nem entra: o comprador escolhe
    expect(umaCor).not.toBe(variasCores);
  });

  it('nenhum pipe sobrevive ao pipeline, venha de onde vier', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA | CETIM', material: '100% POLIESTER' }),
      fonte({ nomePai: 'FITA CETIM 10MT', descricaoPai: '100% POLIESTER.' }),
    );
    expect(t).not.toContain('|');
  });

  it('cor indefinida não vira discriminador nem aparece no título', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'COLA LIQUIDA SILICONE', medida: '100ml' }),
      fonte({ nomePai: 'COLA LIQUIDA SILICONE 100ML', descricaoPai: 'COLA DE SILICONE.', cores: ['Outra'] }),
    );
    expect(t).not.toContain('Outra');
  });

  // Famílias reais medidas em produção (lote #33) que publicavam hoje sem o termo duplicado —
  // POMPOM BÚFALO 14MM/20MM — e que o pipeline de slots, sem a trava, regeneraria quebrado.
  it('família POM POM real não gera título com o termo duplicado', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'POM POM', marca: 'BUFALO', medida: '14mm', quantidade: '100un' }),
      fonte({ nomePai: 'POM POM 14MM C/100UND CORES', descricaoPai: 'POMPOM BÚFALO 100% POLIESTER.', tipoProdutoBusca: 'pompom', fornecedor: 'BUFALO' }),
    );
    expect(t.toLowerCase()).not.toMatch(/pom\s*pom\s*pom/);
  });

  // Achado do revisor (rodada anterior): a supressão de `variacao` quando a cor está coberta
  // por um slot CORTÁVEL (`modelo`) deixava o discriminador sumir do título inteiro quando o
  // corte de 60 chars derrubava esse slot — duas famílias-irmãs mono-cor gerariam título
  // idêntico. Este teste força os dois efeitos JUNTOS (dedup + corte de 60), que nenhuma
  // mutação anterior exercitava ao mesmo tempo. Fixture calibrada pra realmente forçar o corte:
  // com produto curto (ex.: só "LAPIS DE ESCREVER RESINA") o título fica em 49 chars e `modelo`
  // NUNCA é derrubado — o bug não se manifesta e o teste passaria mesmo sem o fix. Alongado o
  // produto pra estourar 60 e derrubar `modelo` de fato: título real = "Lapis de Escrever
  // Resina Colorida Infantil Escolar Verde 7" (58 chars), sem "sl101066" nenhum — `modelo`
  // inteiro sumiu, e mesmo assim "Verde 7" sobrevive.
  it('não suprime a cor quando quem a cobre é um slot cortável (o corte levaria os dois)', () => {
    const t = posProcessarTitulo(
      slots({
        produto: 'LAPIS DE ESCREVER RESINA COLORIDA INFANTIL ESCOLAR',
        marca: 'FABER CASTELL',
        modelo: 'SL101066 VERDE 7',
      }),
      fonte({
        nomePai: 'LAPIS DE ESCREVER RESINA COLORIDA INFANTIL ESCOLAR SL101066',
        descricaoPai: 'LAPIS EM RESINA.',
        cores: ['Verde 7'],
      }),
    );
    expect(t.toLowerCase()).not.toContain('sl101066'); // prova que modelo foi de fato derrubado
    expect(t).toContain('Verde 7');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  // Achado do experimento A/B contra produção: extrairLargura exige a palavra LARGURA perto do
  // número, e "FITAS VELUDO 25MM CORES C/1MT" não tem — então largura saía null e a medida virava
  // só "1m", derrubando o "25mm" que a IA extraiu corretamente do nome. Resultado real: FITAS
  // VELUDO 25MM e FITAS VELUDO 20MM geravam o MESMO título ("Fita Veludo Búfalo 1m 100%
  // Poliéster"). 20 famílias no catálogo têm esse padrão; 4 grupos de irmãs (16/20/25/50MM
  // C/1MT) se distinguiam SÓ pela largura. As quatro têm que gerar quatro títulos distintos.
  it('quatro fitas de veludo irmãs (16/20/25/50mm) geram quatro títulos distintos', () => {
    const larguras = ['16mm', '20mm', '25mm', '50mm'];
    const titulos = larguras.map((medida) => posProcessarTitulo(
      slots({ produto: 'FITA VELUDO', marca: 'BUFALO', medida, material: '100% POLIESTER' }),
      fonte({
        nomePai: `FITAS VELUDO ${medida.toUpperCase()} CORES C/1MT`,
        descricaoPai: '100% POLIESTER.',
        fornecedor: 'BUFALO',
      }),
    ));
    expect(new Set(titulos).size).toBe(4);
  });

  // Achado do experimento A/B contra a API real: "L.LIZA GROSSA CORES" não tem medida nenhuma
  // no nome, então extrairMetragem/extrairLargura devolvem null e o bloco de dimensão em
  // aplicarGuardsTitulo nem roda — o "500 Metros" que a IA escreveu no slot atravessava cru.
  it('unidade por extenso vinda da IA é canonicalizada mesmo sem medida na fonte', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA', modelo: 'TEX 376', medida: '500 Metros', material: 'POLIPROPILENO' }),
      fonte({ nomePai: 'L.LIZA GROSSA CORES', descricaoPai: 'LINHA DE POLIPROPILENO COM 500 METROS.' }),
    );
    expect(t).toContain('500m');
    expect(t).not.toMatch(/\bMetros\b/i);
  });

  // CRITICAL-1: unidade por extenso na medida composta duplicava a dimensão quando
  // normalizarSlots já tinha colado a unidade ("1,80m") antes de aplicarGuardsTitulo rodar —
  // os testes antigos de composta chamavam aplicarGuardsTitulo direto e nunca viram esse "m"
  // colado, por isso a regressão (nascida no último commit da branch) passou despercebida.
  // Os quatro casos abaixo rodam o pipeline INTEIRO (normalizarSlots + aplicarGuardsTitulo
  // juntos), que é a lacuna que faltava cobrir.
  describe('CRITICAL-1 — dimensão composta não duplica (pipeline completo)', () => {
    it('unidade por extenso na medida da IA + mesma medida no nome_pai: 1,80 aparece uma vez', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Tecido Helanca', medida: '3,00 X 1,80 Metros' }),
        fonte({ nomePai: 'TECIDO HELANCA 3,00 X 1,80 METROS' }),
      );
      expect(t.match(/1,80/g)).toHaveLength(1);
    });

    it('medida já canônica (sem unidade por extenso) + mesma medida no nome_pai: 1,80 uma vez', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Tecido Helanca', medida: '3,00 X 1,80' }),
        fonte({ nomePai: 'TECIDO HELANCA 3,00 X 1,80 METROS' }),
      );
      expect(t.match(/1,80/g)).toHaveLength(1);
    });

    // NOTA (ver relatório final, "casos que não bateram"): o valor ditado era `contém 10X15CM`
    // (maiúsculo). tituloCase (titulo-case.ts) só preserva caixa de tokens que batem RE_UNIDADE
    // (número+unidade simples, ex. "25mm"); "10X15CM" não bate esse padrão e cai no capitalizar()
    // genérico, que baixa-caixa o resto → "10x15cm". Guard-level (aplicarGuardsTitulo, testado
    // acima em titulo-guards.test.ts) preserva "10X15CM" exatamente — o slot `medida` nunca é
    // mutilado; é só a etapa de Title Case, alheia ao CRITICAL-1, que perde a caixa. Não é
    // duplicação (o bug sendo corrigido aqui), por isso o teste verifica presença sem duplicar.
    it('dimensão composta em CM sem metragem/largura extraível: aparece uma vez, sem duplicar', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Saco de Organza', medida: '10X15CM' }),
        fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
      );
      expect(t.toLowerCase().match(/10x15cm/g)).toHaveLength(1);
    });

    // Achado do revisor (advisor) durante esta rodada: ampliar a checagem de "já presente" pra
    // TODOS os slots, se aplicada também à metragem, apaga a metragem inteira do título. A IA
    // escreveu a metragem em `produto` (canonicalizada por normalizarSlots pra "500m"); o bloco
    // de dimensão veria "500" já presente em `produto` e não cravaria em `medida` — e o guard de
    // limpeza cross-slot (linhas seguintes) então APAGA "500m" de `produto` por ser duplicata de
    // uma `medida` que nunca foi cravada. Resultado: "500m" sumia dos dois lugares. Por isso
    // metragem só compara contra `baseAncorada` (o que já está em `medida`), nunca contra outros
    // slots — só largura pode olhar o título inteiro (RE_METRAGEM_TOKEN nunca limpa mm/cm).
    it('metragem sobrevive quando a IA a escreveu em produto, não em medida', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Barbante 500 Metros' }),
        fonte({ nomePai: 'BARBANTE BANDEIRANTE 500MT' }),
      );
      expect(t).toContain('500m');
    });

    // Segunda face do mesmo risco: comparar por número CRU colidiria entre unidades diferentes
    // no MESMO produto — metragem "10m" e quantidade "10un" compartilham o número "10".
    it('metragem não é confundida com quantidade de mesmo número cru (10m vs 10un)', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Fita', quantidade: '10un' }),
        fonte({ nomePai: 'FITA 10MT C/10UND' }),
      );
      expect(t).toContain('10m');
      expect(t).toContain('10un');
    });

    // N2 (achado do revisor): largura "já coberta" só por `variacao` era falso-positivo — a IA
    // pôs '25mm' em `variacao` (uso previsto: cor/tamanho/ESPESSURA, titulo-slots.ts), o guard de
    // largura via "já coberta" e não cravava `medida`, e o bloco de cor mais abaixo, rodando
    // DEPOIS, zera `variacao` porque a família é multi-cor — a largura sumia junto. Restrito a
    // `produto` (durável), a largura sobrevive independente do que acontece com `variacao`.
    it('largura não é suprimida por cobertura em `variacao`, que é zerada depois (N2)', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Fita Veludo', variacao: '25mm' }),
        fonte({ nomePai: 'FITA VELUDO', descricaoPai: 'LARGURA: 25MM.', cores: ['Azul', 'Preto'] }),
      );
      expect(t).toMatch(/\b25mm\b/);
    });

    // N3 (achado do revisor): tipo de produto coberto só por um slot CORTÁVEL mais longo que o
    // prefixo é falsa segurança — o guard de tipo roda ANTES do corte de 60 chars, decide "já
    // presente" vendo 'Barbante' em `aplicacao`, e o corte (que roda depois, sem volta) derruba
    // `aplicacao` primeiro por ser a mais baixa prioridade — o tipo some do título inteiro.
    // `produto` calibrado pra caber sozinho com o prefixo (<=60) mas estourar com `aplicacao`
    // junto, forçando o corte a de fato remover `aplicacao`.
    it('tipo de produto sobrevive quando a única cobertura está num slot cortável longo demais (N3)', () => {
      const produto = 'EUROROMA DUPLO 4/6 PARA TRICO E ARTESANATO GERAL';
      const t = posProcessarTitulo(
        slots({ produto, aplicacao: 'Barbante para Croche' }),
        fonte({ nomePai: produto, tipoProdutoBusca: 'barbante' }),
      );
      expect(t.toLowerCase()).toContain('barbante');
      expect(t.length).toBeLessThanOrEqual(60);
    });

    it('largura simples (mm) + metragem grounded distintas: as duas sobrevivem', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Fitas Veludo', medida: '25mm' }),
        fonte({ nomePai: 'FITAS VELUDO 25MM CORES C/1MT' }),
      );
      expect(t).toContain('25mm');
      expect(t).toContain('1m');
    });

    // N1 (achado do revisor pós-CRITICAL-1): numeroAncorado comparava o número CRU sem olhar a
    // unidade — "5" de "5mm" (largura) "cobria" o "5" de "5m" (metragem), duas medidas
    // DIFERENTES do mesmo produto, e a metragem sumia em silêncio. Caso real do catálogo
    // (scripts/experimento-titulo/resultado.md).
    it('largura e metragem de mesmo número, unidades diferentes: as duas sobrevivem (N1)', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Franja', medida: '5mm' }),
        fonte({ nomePai: 'FRANJA 5MM 100%FIBRA DE POLI 5MT' }),
      );
      // \b...\b: "5mm" contém "5m" como substring — precisa do token "5m" ISOLADO (não colado
      // a outro "m"), senão a asserção passaria mesmo com a metragem ausente.
      expect(t).toMatch(/\b5mm\b/);
      expect(t).toMatch(/\b5m\b/);
    });

    // Variante pedida: mesmo número (25) em `medida`(largura, mm) e na fonte (metragem, MT) —
    // sem a trava de unidade, "25" batia como já ancorado e a metragem "25m" sumia.
    it('largura 25mm e metragem 25MT (mesmo número): as duas sobrevivem (N1)', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Fitas Veludo', medida: '25mm' }),
        fonte({ nomePai: 'FITAS VELUDO 25MM CORES C/25MT' }),
      );
      expect(t).toMatch(/\b25mm\b/);
      expect(t).toMatch(/\b25m\b/);
    });
  });

  // CRITICAL-2: cores.length === 0 não pode zerar `variacao` — é o discriminador (tamanho,
  // espessura) da família perante as irmãs quando não há cor nenhuma envolvida.
  describe('CRITICAL-2 — variacao sem cor sobrevive como discriminador', () => {
    it('família sem cor: variacao (tamanho) sobrevive no título', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Camiseta', variacao: 'Tamanho G' }),
        fonte({ nomePai: 'CAMISETA BASICA TAMANHO G', cores: [] }),
      );
      expect(t).toContain('Tamanho G');
    });

    it('família multi-cor: variacao continua zerada (comprador escolhe na variação)', () => {
      const t = posProcessarTitulo(
        slots({ produto: 'Camiseta', variacao: 'Tamanho G' }),
        fonte({ nomePai: 'CAMISETA BASICA TAMANHO G', cores: ['Azul', 'Preto'] }),
      );
      expect(t).not.toContain('Tamanho G');
    });

    // Integração: duas famílias-irmãs sem cor, diferindo só por tamanho, têm que gerar títulos
    // DISTINTOS — é exatamente a falha que este desenho existe para impedir (ML derruba a
    // segunda por duplicado). `produto` calibrado pra estourar 60 chars COM a variação: sem a
    // proteção de corte (variacaoDiscrimina), o corte derrubaria `variacao` — o único slot
    // cortável presente — e as duas famílias colapsariam no MESMO título (só `produto`).
    it('duas famílias-irmãs sem cor, diferindo só por tamanho, geram títulos distintos', () => {
      // Calibrado pra forçar o corte de verdade: produto+variacao+material estoura 60 (98
      // chars), então `variacao` entra na fila de corte (ORDEM_CORTE testa `variacao` antes de
      // `material`). Sem a proteção, `variacao` é o que sai — e como `material` é igual nas
      // duas famílias, ambas colapsam em "Produto ... Material", o mesmo título. Protegida,
      // `material` é quem sai (produto+variacao sozinhos já cabem em 60), e as duas distinguem.
      const produto = 'CAMISETA BASICA ALGODAO PENTEADO GOLA REDONDA';
      const material = '100% ALGODAO PENTEADO PREMIUM COM ELASTANO EXTRA MACIO';
      const camisetaG = posProcessarTitulo(
        slots({ produto, variacao: 'Tamanho G', material }),
        fonte({ nomePai: `${produto} TAMANHO G`, descricaoPai: material, cores: [] }),
      );
      const camisetaM = posProcessarTitulo(
        slots({ produto, variacao: 'Tamanho M', material }),
        fonte({ nomePai: `${produto} TAMANHO M`, descricaoPai: material, cores: [] }),
      );
      expect(camisetaG).not.toBe(camisetaM);
      expect(camisetaG).toContain('Tamanho G');
      expect(camisetaM).toContain('Tamanho M');
    });
  });

  // IMPORTANT-2: título vazio é inviável, nunca deve virar '' silencioso — isso vira
  // `title: ''` no publish (_shared/ml/publicar.ts:207) e um 400 do ML longe da causa.
  it('lança TituloInviavelError quando produto some por ser adjetivo vazio (IMPORTANT-2)', () => {
    expect(() => posProcessarTitulo(
      slots({ produto: 'Premium' }),
      fonte({}),
    )).toThrow(TituloInviavelError);
  });
});

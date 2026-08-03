import { describe, it, expect } from 'vitest';
import { posProcessarTitulo } from '../titulo-pos';
import { type DadosFonteTitulo } from '../titulo-guards';
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
});

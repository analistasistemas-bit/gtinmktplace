import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calcularVereditoAnuncios, concentracaoAmostra, contextoNichoAnuncios, insightEntrada, rivaisPodio,
  rivaisPodioVisitas, subamostraNomeada,
} from '../veredito-sonar';
import type { VereditoAnuncios } from '../veredito-sonar';
import type { ItemVendasSonar, PainelVendasSonar, VisitasAnuncio } from '../sonar';

// =============== Veredito v2 (ADR-0127/D10-D12): a unidade é o ANÚNCIO ==========================
// Fixtures REAIS medidos em 19/08 (US$ 0,30 de Apify), congelados em fixtures/sonar-gabarito/.
// O gabarito herdado do ADR-0124 é inegociável: média / média / ALTA, nessa ordem.
// `scripts/sonar-gabarito-verificar.mjs` é a definição executável das fórmulas — se estes testes
// e o script divergirem, quem errou foi a implementação, não o corte.

const fixture = (slug: string): { vendas: PainelVendasSonar; visitas_total: number | null } =>
  JSON.parse(readFileSync(resolve(import.meta.dirname!, 'fixtures/sonar-gabarito', `${slug}.json`), 'utf8'));

const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 100, vendidos: 100, link: null, imagem: null, vendedor: 'LOJA-A',
  frete_gratis: false, loja_oficial: false, internacional: false, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});

const painelSintetico = (itens: ItemVendasSonar[]): PainelVendasSonar => {
  const comVendas = itens.filter((i) => i.vendidos != null);
  return {
    configurado: true, termo: 'sintético', gerado_em: 'g', itens,
    itens_analisados: itens.length, itens_com_vendas: comVendas.length,
    vendas_totais: comVendas.reduce((a, i) => a + (i.vendidos ?? 0), 0),
    valor_mercado: comVendas.reduce((a, i) => a + (i.vendidos ?? 0) * (i.preco ?? 0), 0),
    produto_destaque: null, palavras_chave_titulos: [],
    por_anuncio: Object.fromEntries(itens.filter((i) => i.item_id).map((i) => [i.item_id!, i])),
    raio_x: {
      total_anuncios: null, ticket_medio: null,
      lojas_oficiais: itens.filter((i) => i.loja_oficial === true).length,
      full: itens.filter((i) => i.full === true).length,
      frete_gratis: itens.filter((i) => i.frete_gratis === true).length,
      internacionais: itens.filter((i) => i.internacional === true).length,
    },
  };
};

/** Todo texto que a UI mostra — alimenta a trava de vocabulário (ADR-0127 §Fragilidades). */
const textosGerados = (v: VereditoAnuncios): string[] => [
  v.titulo, v.motivo,
  ...v.fatores.map((f) => f.detalhe),
  ...(v.marca ? [v.marca.detalhe] : []),
  v.explicacao.acao,
  ...v.explicacao.fatores.flatMap((f) => [f.frase, f.destravar ?? '']),
];

describe('calcularVereditoAnuncios — gabarito D12 (fixtures REAIS medidos na Task 7)', () => {
  it('EUCERIN protetor solar → média (4/6)', () => {
    const { vendas, visitas_total } = fixture('eucerin-protetor-solar');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.nivel).toBe('media');
    expect(v.explicacao.pontuacao).toEqual({ soma: 4, maximo: 6 });
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'ruim', 'bom']);
    expect(v.parcial).toBe(false);
    expect(v.resumo).toBe('Bom volume de venda, mas poucas lojas já dominam o topo — pouco espaço pra mais um player.');
  });
  it('protetor solar facial → média (4/6)', () => {
    const { vendas, visitas_total } = fixture('protetor-solar-facial');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.nivel).toBe('media');
    expect(v.explicacao.pontuacao).toEqual({ soma: 4, maximo: 6 });
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'ruim', 'bom']);
  });
  it('tecido oxford 10 metros → ALTA (critério de aceitação do ADR-0124 — NUNCA relaxar)', () => {
    const { vendas, visitas_total } = fixture('tecido-oxford-10-metros');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.nivel).toBe('alta');
    expect(v.entrada).toBe('aberta');
    expect(v.titulo).toBe('Oportunidade alta');
    expect(v.explicacao.pontuacao).toEqual({ soma: 5, maximo: 6 });
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'bom', 'medio']);
  });
  it('cobertura exatamente 0,50 (oxford) PASSA na trava — só "menos de 50%" derruba', () => {
    const { vendas } = fixture('tecido-oxford-10-metros');
    expect(subamostraNomeada(vendas).cobertura).toBe(0.5);
    expect(calcularVereditoAnuncios(vendas, null).fatores).toHaveLength(3);
  });
});

describe('cobertura de rótulo <50% (D10) — cede ao caminho B quando há dado suficiente (ADR-0137)', () => {
  // Mesma amostra que antes travava tudo (só 4/20 nomeados): agora os 20 itens são elegíveis por
  // venda (vendidos+preço), então o caminho B mede a Disputa em vez de desistir.
  const semRotuloComVendas = () => {
    const nomeados = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLB${i}`, vendedor: `V${i}`, vendidos: 2000 }));
    const anonimos = Array.from({ length: 16 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendedor: null, vendidos: 2000 }));
    return calcularVereditoAnuncios(painelSintetico([...nomeados, ...anonimos]), null);
  };

  it('4/20 nomeados mas 20 elegíveis por venda → caminho B mede a Disputa (medio); Tração continua fora (exige rótulo)', () => {
    const v = semRotuloComVendas();
    expect(v.fatores.map((f) => f.chave)).toEqual(['demanda', 'disputa']);
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('medio');
  });

  it('caminho B mediu → parcial false e entrada aberta, mas o veredito PARA em média (errata do ADR-0137)', () => {
    const v = semRotuloComVendas();
    expect(v.parcial).toBe(false);
    expect(v.entrada).toBe('aberta');
    // "Alta" significa "compre estoque" e exige a Disputa medida por rótulo. Sem esta trava o teto
    // 'medio' do caminho B não chegaria ao veredito: com a Tração fora, `soma >= maximo - 1` aprova
    // disputa 🟡 (3/4) e 🟢 (4/4) igualmente — o teto ficaria invisível justo na faixa que decide
    // compra de estoque.
    expect(v.nivel).toBe('media');
    expect(v.titulo).toBe('Oportunidade média');
  });

  it('mesmo sem rótulo, a explicação de Tração aparece explicando por que ela saiu da conta', () => {
    const v = semRotuloComVendas();
    const tracaoExplicacao = v.explicacao.fatores.find((f) => f.chave === 'tracao');
    expect(tracaoExplicacao?.regua).toBeNull();
    expect(tracaoExplicacao?.frase).toMatch(/rótulo de loja/i);
  });
});

describe('ADR-0128 — Demanda ≠ Entrada', () => {
  it('cobertura 2/20 mas 20 elegíveis por venda → caminho B mede a Disputa, entrada aberta, nivel alta (ADR-0137)', () => {
    const nomeados = Array.from({ length: 2 }, (_, i) => itemV2({
      item_id: `MLBn${i}`, vendedor: `LOJA-${i}`, vendidos: 10_000, preco: 100, full: false,
    }));
    const fantasmas = Array.from({ length: 18 }, (_, i) => itemV2({
      item_id: `MLBg${i}`, vendedor: null, vendidos: 5_000, preco: 80, full: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico([...nomeados, ...fantasmas]), null);
    expect(v.fatores.find((f) => f.chave === 'demanda')?.nivel).toBe('bom');
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('medio');
    expect(v.entrada).toBe('aberta');
    expect(v.parcial).toBe(false);
    // Entrada destravada (era o ponto do ADR-0137), mas sem chegar a "alta": a Disputa veio do
    // caminho B, cuja evidência o próprio ADR classifica como fraca.
    expect(v.nivel).toBe('media');
    expect(v.titulo).toBe('Oportunidade média');
  });

  it('fantasma com alto faturamento aparece no rivaisPodio com vendedor null', () => {
    const painel = painelSintetico([
      itemV2({ item_id: 'MLB1', vendedor: 'LOJA-A', vendidos: 10, preco: 10, full: false }),
      itemV2({ item_id: 'MLB2', vendedor: null, vendidos: 9_000, preco: 200, full: false }),
      ...Array.from({ length: 18 }, (_, i) => itemV2({
        item_id: `MLBx${i}`, vendedor: `L${i}`, vendidos: 100, preco: 50, full: false,
      })),
    ]);
    const v = calcularVereditoAnuncios(painel, null);
    const topo = v.rivaisPodio[0];
    expect(topo.vendedor).toBeNull();
    expect(topo.faturamento).toBe(9_000 * 200);
    expect(v.rivaisPodio.some((r) => r.vendedor == null)).toBe(true);
  });

  it('demanda ok + Full ruim → nivel baixa mas titulo/acao falam entrada fechada, nao demanda insuficiente', () => {
    // Caso abraçadeira nylon: demanda medio (60% vendem, >=5k vendas), disputa ruim (>=60% Full),
    // tracao medio → soma 2/6 = baixa, mas gateDemanda false.
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`,
      vendedor: `LOJA-${i}`,
      vendidos: i < 12 ? 500 : null,
      preco: 100,
      full: i < 19,
      loja_oficial: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.fatores.find((f) => f.chave === 'demanda')?.nivel).toBe('medio');
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('ruim');
    expect(v.nivel).toBe('baixa');
    expect(v.entrada).toBe('fechada');
    expect(v.explicacao.gateDemanda).toBe(false);
    expect(v.titulo).toMatch(/entrada fechada/);
    expect(v.resumo).toBe('Mercado aquecido, mas dominado por quem já tem Full — entrar com estoque grande é nadar contra a maré.');
    expect(v.explicacao.acao).not.toMatch(/Demanda insuficiente/i);
    expect(v.explicacao.acao).toMatch(/entrada fechada|Full/i);
  });

  it('marca ruim (>50% loja oficial) impede nivel alta mesmo com scores altos', () => {
    // 20 anúncios pulverizados, Full baixo, demanda forte — sem marca seria alta; com >50% oficial → fechada.
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`,
      vendedor: `LOJA-${i}`,
      vendidos: 1_000,
      preco: 400,
      full: false,
      loja_oficial: i < 11, // 11/20 = 55% > 50%
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.marca?.nivel).toBe('ruim');
    expect(v.entrada).toBe('fechada');
    expect(v.nivel).not.toBe('alta');
    expect(v.parcial).toBe(false);
    expect(v.titulo).toMatch(/entrada fechada/);
  });
});

describe('invariância ao tamanho da amostra (D11) — a censura não pode mudar o nível', () => {
  it('nicho totalmente pulverizado com 6 e com 20 itens → mesmo nível de Disputa', () => {
    const nicho = (n: number) => painelSintetico(Array.from({ length: n }, (_, i) =>
      itemV2({ item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1000, full: false })));
    const v6 = calcularVereditoAnuncios(nicho(6), null);
    const v20 = calcularVereditoAnuncios(nicho(20), null);
    const disputa6 = v6.fatores.find((f) => f.chave === 'disputa');
    const disputa20 = v20.fatores.find((f) => f.chave === 'disputa');
    expect(disputa6?.nivel).toBe(disputa20?.nivel);
    expect(disputa6?.nivel).toBe('bom');
  });
});

describe('visitas na Demanda (D12: informativa, nunca pontuada)', () => {
  const bom = () => painelSintetico(Array.from({ length: 20 }, (_, i) =>
    itemV2({ item_id: `MLB${i}`, vendedor: i % 3 === 0 ? 'LOJA-A' : `LOJA-${i}`, vendidos: 1000 })));

  it('visitasTotal null NÃO rebaixa (LOUD: ausência não pune)', () => {
    const demanda = calcularVereditoAnuncios(bom(), null).fatores.find((f) => f.chave === 'demanda');
    expect(demanda?.nivel).toBe('bom');
  });

  it('visitas baixas NÃO rebaixam: sem corte medido, o número só aparece como contexto', () => {
    const comVisitas = calcularVereditoAnuncios(bom(), 12);
    const demanda = comVisitas.fatores.find((f) => f.chave === 'demanda');
    expect(demanda?.nivel).toBe('bom');
    expect(demanda?.detalhe).toContain('12 visitas');
    expect(comVisitas.nivel).toBe(calcularVereditoAnuncios(bom(), null).nivel);
  });
});

describe('subamostraNomeada — numerador e denominador do MESMO universo', () => {
  it('faturamento só conta itens com rótulo de loja', () => {
    const s = subamostraNomeada(painelSintetico([
      itemV2({ item_id: 'MLB1', vendedor: 'A', vendidos: 10, preco: 10 }),
      itemV2({ item_id: 'MLB2', vendedor: null, vendidos: 1000, preco: 100 }),
    ]));
    expect(s).toEqual({ analisados: 2, nomeados: 1, distintos: 1, cobertura: 0.5, faturamento: 100 });
  });

  it('rótulo é o texto CRU do card (o gabarito foi medido assim): "EUCERIN" ≠ "EUCERIN Loja oficial"', () => {
    const s = subamostraNomeada(fixture('eucerin-protetor-solar').vendas);
    expect(s).toMatchObject({ analisados: 20, nomeados: 20, distintos: 2, cobertura: 1 });
  });
});

// =============== Caminho B da Disputa (ADR-0137): concentração por anúncio ======================

describe('concentracaoAmostra', () => {
  it('menos de 5 elegíveis → null (o caso da consulta real que motivou o ADR)', () => {
    const painel = painelSintetico(Array.from({ length: 4 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: null, vendidos: 100, preco: 10,
    })));
    expect(concentracaoAmostra(painel)).toBeNull();
  });

  it('item sem vendidos ou sem preço não é elegível', () => {
    const elegiveis = Array.from({ length: 5 }, (_, i) => itemV2({
      item_id: `MLBe${i}`, vendedor: null, vendidos: 10, preco: 10, // faturamento 100 cada, 500 no total
    }));
    const naoElegiveis = [
      itemV2({ item_id: 'MLBn1', vendedor: null, vendidos: null, preco: 999_999 }),
      itemV2({ item_id: 'MLBn2', vendedor: null, vendidos: 999_999, preco: null }),
    ];
    const painel = painelSintetico([...elegiveis, ...naoElegiveis]);
    const c = concentracaoAmostra(painel);
    // Se os "fantasmas" tivessem entrado na conta, dominariam o faturamento — como ficaram de
    // fora, o líder é só mais 1/5 do total medido.
    expect(c).toEqual({ elegiveis: 5, top1: 0.2, corte: 0.4, dominante: false });
  });

  it('top1 calculado sobre o faturamento medido, com o corte de 30% quando há muitos elegíveis', () => {
    const lider = itemV2({ item_id: 'MLB-lider', vendedor: null, vendidos: 325, preco: 1 });
    const outros = Array.from({ length: 9 }, (_, i) => itemV2({ item_id: `MLBo${i}`, vendedor: null, vendidos: 75, preco: 1 }));
    const painel = painelSintetico([lider, ...outros]);
    const c = concentracaoAmostra(painel);
    expect(c).toEqual({ elegiveis: 10, top1: 0.325, corte: 0.3, dominante: true });
  });

  it('base pequena: com 5 elegíveis o corte é 40% (2/5), então top1 de 35% NÃO é dominante — prova do fator 2× sobre o uniforme', () => {
    const lider = itemV2({ item_id: 'MLB-lider', vendedor: null, vendidos: 350, preco: 1 });
    const outros = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLBo${i}`, vendedor: null, vendidos: 162.5, preco: 1 }));
    const painel = painelSintetico([lider, ...outros]);
    const c = concentracaoAmostra(painel);
    expect(c).toEqual({ elegiveis: 5, top1: 0.35, corte: 0.4, dominante: false });
  });
});

describe('Disputa caminho B (ADR-0137) — via calcularVereditoAnuncios, cobertura de rótulo < 50%', () => {
  it('Full ≥ 60% fecha a Disputa mesmo sem rótulo nenhum e sem concentração calculável', () => {
    const itens = Array.from({ length: 10 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: null, vendidos: null, preco: null, full: i < 7,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('ruim');
  });

  it('líder dominante fecha a Disputa mesmo com Full baixo', () => {
    const lider = itemV2({ item_id: 'MLB-lider', vendedor: null, vendidos: 1000, preco: 1, full: false });
    const outros = Array.from({ length: 5 }, (_, i) => itemV2({ item_id: `MLBo${i}`, vendedor: null, vendidos: 100, preco: 1, full: false }));
    const v = calcularVereditoAnuncios(painelSintetico([lider, ...outros]), null);
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('ruim');
  });

  it('sem dominância e Full baixo → medio, nunca bom (teto do caminho B)', () => {
    const itens = Array.from({ length: 6 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: null, vendidos: 100, preco: 1, full: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    const disputa = v.fatores.find((f) => f.chave === 'disputa');
    expect(disputa?.nivel).toBe('medio');
    expect(disputa?.nivel).not.toBe('bom');
  });

  it('parcial === false e a Entrada não fica nao_medida quando o caminho B mediu — regressão que o ADR-0137 corrige', () => {
    const itens = Array.from({ length: 6 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: null, vendidos: 100, preco: 1, full: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.parcial).toBe(false);
    expect(v.entrada).not.toBe('nao_medida');
  });

  it('sem envio identificado E menos de 5 elegíveis → Disputa fora, parcial === true, razão cita venda/envio (nunca rótulo)', () => {
    // Demanda com dados suficientes (evita o gate) via itens com `vendidos` mas SEM `preco` — contam
    // pra liquidez da Demanda mas não pra elegibilidade de concentração (que exige os dois).
    const nomeados = Array.from({ length: 3 }, (_, i) => itemV2({
      item_id: `MLBn${i}`, vendedor: `V${i}`, vendidos: null, preco: 100,
    }));
    const comVendaSemPreco = Array.from({ length: 5 }, (_, i) => itemV2({
      item_id: `MLBv${i}`, vendedor: null, vendidos: 1000, preco: null,
    }));
    const elegiveis = Array.from({ length: 2 }, (_, i) => itemV2({
      item_id: `MLBe${i}`, vendedor: null, vendidos: 1000, preco: 50,
    }));
    const v = calcularVereditoAnuncios(painelSintetico([...nomeados, ...comVendaSemPreco, ...elegiveis]), null);
    expect(v.fatores.map((f) => f.chave)).not.toContain('disputa');
    expect(v.parcial).toBe(true);
    expect(v.motivo).toMatch(/tipo de envio/i);
    expect(v.motivo).toMatch(/vendidos e preço|concentração/i);
    expect(v.motivo).not.toMatch(/rótulo/i);
  });

  it('não-regressão do caminho A: painel com cobertura ≥ 50% continua medindo por pulverização, resultado intocado', () => {
    const { vendas, visitas_total } = fixture('eucerin-protetor-solar');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'ruim', 'bom']);
    expect(v.explicacao.pontuacao).toEqual({ soma: 4, maximo: 6 });
    // Caminho A tem régua de 2 cortes (pulverização); caminho B nunca tem régua (corte único).
    expect(v.explicacao.fatores.find((f) => f.chave === 'disputa')?.regua).not.toBeNull();
  });
});

describe('vocabulário (ADR-0127 §Fragilidades) — o card imprime a MARCA, não o nickname', () => {
  it('nenhum texto gerado diz "vendedor": só "rótulo de loja"', () => {
    const casos: VereditoAnuncios[] = [
      ...['eucerin-protetor-solar', 'protetor-solar-facial', 'tecido-oxford-10-metros'].map((s) => {
        const { vendas, visitas_total } = fixture(s);
        return calcularVereditoAnuncios(vendas, visitas_total);
      }),
      calcularVereditoAnuncios(painelSintetico([itemV2({ vendedor: null, vendidos: 1 })]), null),
      // liquidez 0,20 com 2.000 vendas: único caso que exercita o branch "ruim por liquidez" do
      // fraseDemanda — os outros caem no branch de vendas mínimas e nunca leem aquela frase.
      calcularVereditoAnuncios(painelSintetico([
        ...Array.from({ length: 2 }, (_, i) => itemV2({ item_id: `MLB${i}`, vendidos: 1000 })),
        ...Array.from({ length: 8 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendidos: null })),
      ]), null),
    ];
    for (const v of casos) {
      // "ficha" morreu junto com o painel de catálogo (D1/D3): a unidade agora é o anúncio.
      for (const texto of textosGerados(v)) expect(texto).not.toMatch(/vendedor|ficha/i);
      expect(textosGerados(v).some((t) => /rótulo/i.test(t))).toBe(true);
    }
  });
});

describe('Full não medido (LOUD) — ausência de dado não pode PROMOVER a Disputa', () => {
  it('facial com envio anulado em todos os anúncios NÃO sobe para alta', () => {
    const { vendas } = fixture('protetor-solar-facial');
    const semFull: PainelVendasSonar = {
      ...vendas,
      por_anuncio: Object.fromEntries(
        Object.entries(vendas.por_anuncio!).map(([k, i]) => [k, { ...i, full: null }]),
      ),
      raio_x: { ...vendas.raio_x, full: 0 },
    };
    // O facial é 🔴 SÓ pela cláusula de Full (100% sobre os medidos >= 60). Sem Full medido, deixar o termo sair dos
    // dois lados da regra faria 0,69 de pulverização virar Disputa 🟢 → 6/6 → "alta", em silêncio,
    // num nicho que o gabarito fixa em média. Ausência de dado nunca melhora um veredito.
    const v = calcularVereditoAnuncios(semFull, null);
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('medio');
    expect(v.nivel).not.toBe('alta');
  });

  it('Full medido em PARTE da amostra: denominador é o medido, não a amostra inteira', () => {
    // 8 anúncios com envio medido (todos Full) + 12 com `envio: ""` (full null) — caso real do
    // dataset da Apify. Diluído sobre N daria 8/20 = 40% (<= fullPouco) e, com pulverização 0,50,
    // a Disputa sairia 🟢 → 5/6 → "alta", com `parcial: false` (nenhum aviso na tela). Sobre o que
    // foi medido são 8/8 = 100% (>= fullMuito) → 🔴 → 3/6 → média. Ausência nunca promove.
    const medidos = Array.from({ length: 8 }, (_, i) => itemV2({
      item_id: `MLBf${i}`, vendedor: `LOJA-${i}`, vendidos: 500, full: true,
    }));
    const semEnvio = Array.from({ length: 12 }, (_, i) => itemV2({
      item_id: `MLBn${i}`, vendedor: `LOJA-${i % 10}`, vendidos: 500, full: null,
    }));
    const v = calcularVereditoAnuncios(painelSintetico([...medidos, ...semEnvio]), null);
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'ruim', 'medio']);
    expect(v.explicacao.pontuacao).toEqual({ soma: 3, maximo: 6 });
    expect(v.nivel).toBe('media');
    expect(v.fatores.find((f) => f.chave === 'disputa')?.detalhe).toContain('100% Full');
  });
});

describe('contextoNichoAnuncios — leitura complementar, fora do score', () => {
  it('mediana de preço, ticket, % Full e % internacionais da amostra de anúncios', () => {
    const { vendas } = fixture('tecido-oxford-10-metros');
    const itens = contextoNichoAnuncios(vendas);
    const rotulos = itens.map((i) => i.rotulo);
    expect(rotulos).toContain('Preço mediano da amostra');
    expect(rotulos).toContain('% Full na amostra');
    expect(rotulos).toContain('% internacionais na amostra');
    // 4 Full em 19 anúncios com envio medido (1 dos 20 vem com `envio: ""`) = 21%, não 4/20.
    expect(itens.find((i) => i.rotulo === '% Full na amostra')!.valor).toBe('21%');
  });
});

// =============== Insights do nicho (ADR-0124 addendum 2026-08-21) ===============================

describe('insightEntrada', () => {
  it('entrada aberta com folga restante → menciona o próximo delta (destravar)', () => {
    const { vendas, visitas_total } = fixture('tecido-oxford-10-metros');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.entrada).toBe('aberta');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Entrada aberta');
    expect(insight.tom).toBe('bom');
    expect(insight.detalhe).toMatch(/Ainda dá para melhorar/);
  });

  it('entrada fechada por disputa (Full dominante) → detalhe usa o destravar da disputa', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: i < 12 ? 500 : null, preco: 100,
      full: i < 19, loja_oficial: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.entrada).toBe('fechada');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Entrada fechada');
    expect(insight.tom).toBe('ruim');
    expect(insight.detalhe).toMatch(/Para destravar:/);
  });

  it('entrada fechada por marca (disputa boa) → detalhe usa o destravar da marca, não da disputa', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1_000, preco: 400,
      full: false, loja_oficial: i < 11, // 11/20 = 55% > 50%
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.entrada).toBe('fechada');
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).not.toBe('ruim');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Entrada fechada');
    expect(insight.detalhe).toMatch(/loja oficial/);
  });

  it('entrada não medida (nenhum caminho da Disputa mediu) → detalhe cita a cobertura de rótulo de loja', () => {
    // Diferente da trava D10 antiga: aqui nem o caminho A (rótulo) nem o B (concentração por
    // anúncio, ADR-0137) medem — cobertura de rótulo <50% E menos de 5 anúncios elegíveis por venda.
    const nomeados = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLBn${i}`, vendedor: `V${i}`, vendidos: null, preco: 100 }));
    const anonimosSemVenda = Array.from({ length: 14 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendedor: null, vendidos: null, preco: 100 }));
    const anonimosComVenda = Array.from({ length: 2 }, (_, i) => itemV2({ item_id: `MLBv${i}`, vendedor: null, vendidos: 500, preco: 50 }));
    const v = calcularVereditoAnuncios(painelSintetico([...nomeados, ...anonimosSemVenda, ...anonimosComVenda]), null);
    expect(v.entrada).toBe('nao_medida');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Concorrência não medida');
    expect(insight.tom).toBe('medio');
    expect(insight.detalhe).toMatch(/rótulo de loja/);
  });

  it('entrada não medida por Full não informado (cobertura OK, sem trava D10) → detalhe cita o envio, não o genérico', () => {
    // Mesma amostra do teste "Full não medido" acima: cobertura de rótulo passa (>=50%), mas
    // nenhum anúncio informa o tipo de envio — causa É o fator 'disputa' comum, não o de regua:null.
    const { vendas } = fixture('protetor-solar-facial');
    const semFull: PainelVendasSonar = {
      ...vendas,
      por_anuncio: Object.fromEntries(
        Object.entries(vendas.por_anuncio!).map(([k, i]) => [k, { ...i, full: null }]),
      ),
      raio_x: { ...vendas.raio_x, full: 0 },
    };
    const v = calcularVereditoAnuncios(semFull, null);
    expect(v.entrada).toBe('nao_medida');
    expect(v.explicacao.fatores.some((f) => f.regua === null)).toBe(false); // sem trava D10 aqui
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Concorrência não medida');
    expect(insight.detalhe).toMatch(/tipo de envio/);
    expect(insight.detalhe).not.toBe('Não deu para medir a concorrência do nicho com os dados desta amostra.');
  });

  it('entrada aberta sem nenhum destravar (tudo já bom) → detalhe genérico de campo livre', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1_000, preco: 400,
      full: false, loja_oficial: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.entrada).toBe('aberta');
    expect(v.explicacao.fatores.every((f) => f.destravar == null)).toBe(true);
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Entrada aberta');
    expect(insight.tom).toBe('bom');
    expect(insight.detalhe).toBe('Sem barreira estrutural detectada nesta amostra — campo livre pra quem chega agora.');
  });
});

describe('rivaisPodioVisitas — pódio por visitas (independente de `vendidos`)', () => {
  const v = (total: number): VisitasAnuncio => ({ total, por_dia: [] });

  it('item com visitas e SEM vendidos entra no pódio — NÃO herda o filtro `vendidos != null` de rivaisPodio', () => {
    const vendas = painelSintetico([itemV2({ item_id: 'MLB1', vendidos: null, preco: 80 })]);
    const visitasPorItem = new Map([['MLB1', v(290)]]);
    expect(rivaisPodioVisitas(vendas, visitasPorItem)).toEqual([
      { item_id: 'MLB1', titulo: 'X', preco: 80, visitas: 290, href: 'https://produto.mercadolivre.com.br/MLB-1' },
    ]);
  });

  it('ordena por visitas desc e corta no top 5', () => {
    const itens = Array.from({ length: 6 }, (_, i) => itemV2({ item_id: `MLB${i}`, vendidos: null }));
    const vendas = painelSintetico(itens);
    const visitasPorItem = new Map(itens.map((it, i) => [it.item_id!, v((i + 1) * 10)]));
    const resultado = rivaisPodioVisitas(vendas, visitasPorItem);
    expect(resultado).toHaveLength(5);
    expect(resultado.map((r) => r.visitas)).toEqual([60, 50, 40, 30, 20]);
  });

  it('exclui visitas == 0 e exclui item cujo Map devolve null (falha de medição)', () => {
    const vendas = painelSintetico([
      itemV2({ item_id: 'MLB1' }),
      itemV2({ item_id: 'MLB2' }),
      itemV2({ item_id: 'MLB3' }),
    ]);
    const visitasPorItem = new Map<string, VisitasAnuncio | null>([
      ['MLB1', v(0)],
      ['MLB2', null],
      ['MLB3', v(15)],
    ]);
    expect(rivaisPodioVisitas(vendas, visitasPorItem).map((r) => r.item_id)).toEqual(['MLB3']);
  });

  it('exclui item com item_id == null (não dá para chavear no Map)', () => {
    const vendas = painelSintetico([itemV2({ item_id: null })]);
    const visitasPorItem = new Map<string, VisitasAnuncio | null>();
    expect(rivaisPodioVisitas(vendas, visitasPorItem)).toEqual([]);
  });

  it('lista vazia devolve []', () => {
    expect(rivaisPodioVisitas(painelSintetico([]), new Map())).toEqual([]);
  });

  it('item_id conhecido produz href apontando para o anúncio', () => {
    const vendas = painelSintetico([itemV2({ item_id: 'MLB999', vendidos: null, link: null })]);
    const visitasPorItem = new Map([['MLB999', v(10)]]);
    expect(rivaisPodioVisitas(vendas, visitasPorItem)[0].href).toBe('https://produto.mercadolivre.com.br/MLB-999');
  });
});

describe('rivaisPodio — href resolvido no lib (ADR-0136)', () => {
  it('item com item_id conhecido produz href apontando para o anúncio', () => {
    const vendas = painelSintetico([itemV2({ item_id: 'MLB1', link: null, vendidos: 10, preco: 10 })]);
    expect(rivaisPodio(vendas)[0].href).toBe('https://produto.mercadolivre.com.br/MLB-1');
  });

  it('rival fantasma sem item_id e sem link tem href: null', () => {
    const vendas = painelSintetico([itemV2({ item_id: null, link: null, vendedor: null, vendidos: 9_000, preco: 200 })]);
    expect(rivaisPodio(vendas)[0].href).toBeNull();
  });
});

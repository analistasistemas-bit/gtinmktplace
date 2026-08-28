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
  v.titulo, v.resumo, v.chip ?? '',
  ...v.ramosEntrada.flatMap((r) => [r.rotulo, r.texto]),
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
    expect(v.resumo).toBe('Mercado aquecido, mas poucos concorrentes dominam o topo. Entrar exige preço melhor que o deles.');
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
    expect(v.titulo).toBe('Alta demanda · campo aberto');
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
    expect(v.titulo).toBe('Alta demanda · topo aparentemente aberto');
  });

  it('mesmo sem rótulo, a explicação de Tração aparece explicando por que ela saiu da conta', () => {
    const v = semRotuloComVendas();
    const tracaoExplicacao = v.explicacao.fatores.find((f) => f.chave === 'tracao');
    expect(tracaoExplicacao?.regua).toBeNull();
    expect(tracaoExplicacao?.frase).toMatch(/nome de loja/i);
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
    expect(v.titulo).toBe('Alta demanda · topo aparentemente aberto');
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
    expect(v.titulo).toMatch(/concorrência pesada|risco de marca/);
    expect(v.resumo).toBe('Mercado aquecido e disputado no prazo: o topo entrega por Full. Dá pra entrar, mas o preço tem que compensar a entrega.');
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
    expect(v.titulo).toMatch(/concorrência pesada|risco de marca/);
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
    expect(v.explicacao.acao).toMatch(/tipo de envio/i);
    expect(v.explicacao.acao).toMatch(/vendidos e preço|concentração/i);
    expect(v.explicacao.acao).not.toMatch(/rótulo/i);
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
      // ADR-0138: o termo deliberado na tela virou "concorrente" — comercial e, ao contrário de
      // "vendedor", sem afirmar que o card traz uma conta de loja (ele traz a marca).
      expect(textosGerados(v).some((t) => /concorrente/i.test(t))).toBe(true);
      // "entrada fechada" nunca é impressa: o dado mede custo de entrada, não porta trancada.
      for (const texto of textosGerados(v)) expect(texto).not.toMatch(/entrada fechada/i);
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

describe('ADR-0138 — matriz de título (Demanda × Barreira) e travas de linguagem', () => {
  // Uma amostra por par, montada pelos fatores que produzem cada barreira. O que este bloco pega
  // e nenhum outro pega: um par (demanda, barreira) mapeado para o texto errado.
  const casos: { nome: string; itens: ItemVendasSonar[]; titulo: string; barreira: string }[] = [
    {
      nome: 'sem prova de venda (gate) — título sem segundo eixo',
      itens: Array.from({ length: 10 }, (_, i) => itemV2({ item_id: `A${i}`, vendedor: `L${i}`, vendidos: i < 1 ? 100 : null })),
      titulo: 'Sem prova de venda', barreira: 'nao_medida',
    },
    {
      nome: 'alta demanda · campo aberto',
      itens: Array.from({ length: 20 }, (_, i) => itemV2({ item_id: `B${i}`, vendedor: `L${i}`, vendidos: 1_000, preco: 400, full: i < 4 })),
      titulo: 'Alta demanda · campo aberto', barreira: 'nenhuma',
    },
    {
      nome: 'alta demanda · concorrência pesada (Full)',
      itens: Array.from({ length: 20 }, (_, i) => itemV2({ item_id: `C${i}`, vendedor: `L${i}`, vendidos: 1_000, preco: 400, full: true })),
      titulo: 'Alta demanda · concorrência pesada', barreira: 'concorrencia',
    },
    {
      nome: 'alta demanda · risco de marca',
      itens: Array.from({ length: 20 }, (_, i) => itemV2({ item_id: `D${i}`, vendedor: `L${i}`, vendidos: 1_000, preco: 400, full: false, loja_oficial: i < 11 })),
      titulo: 'Alta demanda · risco de marca', barreira: 'marca',
    },
    {
      nome: 'demanda comprovada · concorrência pesada (o print do Diego)',
      itens: Array.from({ length: 20 }, (_, i) => itemV2({ item_id: `E${i}`, vendedor: `L${i}`, vendidos: i < 12 ? 500 : null, preco: 100, full: true })),
      titulo: 'Demanda comprovada · concorrência pesada', barreira: 'concorrencia',
    },
    {
      nome: 'alta demanda · mercado apertado (topo livre, bolo pequeno)',
      itens: Array.from({ length: 20 }, (_, i) => itemV2({ item_id: `F${i}`, vendedor: `L${i}`, vendidos: 1_000, preco: 1, full: i < 4 })),
      titulo: 'Alta demanda · mercado apertado', barreira: 'mercado_apertado',
    },
  ];

  for (const caso of casos) {
    it(caso.nome, () => {
      const v = calcularVereditoAnuncios(painelSintetico(caso.itens), null);
      expect(v.barreira).toBe(caso.barreira);
      expect(v.titulo).toBe(caso.titulo);
      // A trava que importa: a condição de entrada só existe onde há handicap de Full a compensar,
      // e nunca sob risco de marca (moderação por IP) ou sem prova de venda — ali preço não resolve.
      const fullDomina = caso.itens.every((i) => i.full === true);
      const podeTerCondicao = fullDomina && !v.explicacao.gateDemanda
        && v.barreira !== 'marca' && v.barreira !== 'nao_medida';
      expect(v.ramosEntrada.length > 0).toBe(podeTerCondicao);
      for (const t of textosGerados(v)) {
        expect(t).not.toMatch(/entrada fechada|Oportunidade (alta|média|baixa)/i);
      }
      // Valor absoluto é exclusivo da consulta por EAN: neste card, só percentual (ADR-0138 §3).
      for (const r of v.ramosEntrada) expect(r.texto).not.toMatch(/R\$/);
    });
  }
});

describe('ADR-0138 — travas de coerência do card (o que 53 verdes não pegavam)', () => {
  /** Todas as barreiras alcançáveis, cada uma com uma amostra que a produz de verdade. */
  const cenarios = (): { barreira: string; v: VereditoAnuncios }[] => {
    const uniforme = (o: Partial<ItemVendasSonar>, n = 20) =>
      Array.from({ length: n }, (_, i) => itemV2({ item_id: `${o.item_id ?? 'I'}${i}`, vendedor: `L${i}`, ...o }));
    return [
      { barreira: 'nenhuma', v: calcularVereditoAnuncios(painelSintetico(uniforme({ item_id: 'A', vendidos: 1_000, preco: 400, full: false })), null) },
      { barreira: 'concorrencia', v: calcularVereditoAnuncios(painelSintetico(uniforme({ item_id: 'B', vendidos: 1_000, preco: 400, full: true })), null) },
      { barreira: 'mercado_apertado', v: calcularVereditoAnuncios(painelSintetico(uniforme({ item_id: 'C', vendidos: 1_000, preco: 1, full: false })), null) },
      {
        barreira: 'marca',
        v: calcularVereditoAnuncios(painelSintetico(Array.from({ length: 20 }, (_, i) => itemV2({
          item_id: `D${i}`, vendedor: `L${i}`, vendidos: 1_000, preco: 400, full: false, loja_oficial: i < 11,
        }))), null),
      },
      {
        barreira: 'topo_nao_confirmado',
        v: calcularVereditoAnuncios(painelSintetico([
          ...Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `E${i}`, vendedor: `L${i}`, vendidos: 2_000 })),
          ...Array.from({ length: 16 }, (_, i) => itemV2({ item_id: `Ex${i}`, vendedor: null, vendidos: 2_000 })),
        ]), null),
      },
      {
        barreira: 'nao_medida',
        v: calcularVereditoAnuncios(painelSintetico([
          ...Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `F${i}`, vendedor: `V${i}`, vendidos: 2_000, preco: null })),
          ...Array.from({ length: 14 }, (_, i) => itemV2({ item_id: `Fx${i}`, vendedor: null, vendidos: null, preco: 100 })),
          ...Array.from({ length: 2 }, (_, i) => itemV2({ item_id: `Fv${i}`, vendedor: null, vendidos: 500, preco: 50 })),
        ]), null),
      },
    ];
  };

  it('cada barreira é alcançável e produz o rótulo esperado no título', () => {
    for (const { barreira, v } of cenarios()) expect(v.barreira).toBe(barreira);
  });

  it('o título NUNCA declara campo aberto quando a Disputa veio do caminho B (ADR-0137)', () => {
    // A trava que faltava: o Saiba mais do caminho B diz "este caminho nunca declara o campo
    // aberto". Sem este teste, o título dizia exatamente isso — em verde — e 53 testes passavam.
    for (const { v } of cenarios()) {
      const caminhoB = v.explicacao.fatores.some((f) => f.chave === 'disputa' && /nome de loja/i.test(f.frase));
      if (!caminhoB) continue;
      expect(v.titulo).not.toMatch(/campo aberto/);
      expect(v.resumo).not.toMatch(/campo (aberto|livre)/);
      expect(insightEntrada(v).tom).not.toBe('bom');
      expect(insightEntrada(v).detalhe).not.toMatch(/campo livre/);
    }
  });

  it('"não compre" só aparece sob gate de demanda; risco de marca avisa do takedown, não proíbe', () => {
    for (const { barreira, v } of cenarios()) {
      const proibe = /não compre|não entre/i.test(v.explicacao.acao) || /não compre|não entre/i.test(v.resumo);
      // Implicação, não equivalência: fora do gate nenhum texto pode mandar não comprar — é a
      // promessa central do ADR-0138 §5, e é o que impede o card de contradizer "Como entrar".
      if (proibe) expect(v.explicacao.gateDemanda).toBe(true);
      if (barreira === 'marca') {
        expect(v.explicacao.acao).toMatch(/propriedade intelectual/i);
        expect(v.explicacao.acao).toMatch(/Preço não resolve/i);
      }
    }
    const semVenda = calcularVereditoAnuncios(painelSintetico(Array.from({ length: 10 }, (_, i) => itemV2({
      item_id: `G${i}`, vendedor: `L${i}`, vendidos: i < 1 ? 100 : null,
    }))), null);
    expect(semVenda.explicacao.acao).toMatch(/Não compre estoque/);
  });

  it('chip: número que sustenta a barreira, nunca conta "lojas", e ausente sob gate de demanda', () => {
    // "loja oficial" é nome de recurso do ML e continua válido; o proibido é CONTAR lojas
    // ("3 lojas no topo"), que afirmaria conta de vendedor onde o card do ML imprime a marca.
    for (const { v } of cenarios()) {
      if (v.chip != null && v.barreira !== 'marca') expect(v.chip).not.toMatch(/\blojas?\b/i);
    }
    const porRotulo = calcularVereditoAnuncios(painelSintetico(Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `H${i}`, vendedor: `L${i % 3}`, vendidos: 1_000, preco: 400, full: false,
    }))), null);
    expect(porRotulo.barreira).toBe('concorrencia');
    expect(porRotulo.chip).toBe('3 concorrentes no topo');

    const semVenda = calcularVereditoAnuncios(painelSintetico(Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `J${i}`, vendedor: `L${i}`, vendidos: i < 1 ? 100 : null, full: true,
    }))), null);
    expect(semVenda.explicacao.gateDemanda).toBe(true);
    expect(semVenda.chip).toBeNull();
  });

  it('gate + avaliação parcial: a causa da parcialidade continua visível na ação', () => {
    // O subtítulo que explicava isso morreu no §6; sob o gate o insight fala de demanda, não de
    // concorrência — então a razão tem de sobreviver na ação, ou o badge "parcial" fica órfão.
    const v = calcularVereditoAnuncios(painelSintetico([
      ...Array.from({ length: 9 }, (_, i) => itemV2({ item_id: `K${i}`, vendedor: `L${i}`, vendidos: null, preco: 100 })),
      itemV2({ item_id: 'Kv', vendedor: 'LX', vendidos: 100, preco: 100 }),
    ]), null);
    expect(v.explicacao.gateDemanda).toBe(true);
    expect(v.parcial).toBe(true);
    expect(v.explicacao.acao).toMatch(/não deu para avaliar a concorrência/i);
  });
});

describe('insightEntrada', () => {
  it('campo aberto → card "Como entrar" com o preço a bater do líder', () => {
    const { vendas, visitas_total } = fixture('tecido-oxford-10-metros');
    const v = calcularVereditoAnuncios(vendas, visitas_total);
    expect(v.barreira).toBe('nenhuma');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Como entrar neste nicho');
    expect(insight.tom).toBe('bom');
    expect(insight.ramos).toEqual([]); // Full não domina: sem handicap de prazo, nada a compensar
  });

  it('concorrência pesada por Full → dois ramos, e o "Sem Full" traz 5% abaixo do líder', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: i < 12 ? 500 : null, preco: 100,
      full: i < 19, loja_oficial: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.barreira).toBe('concorrencia');
    expect(v.chip).toBe('95% Full');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Como entrar neste nicho');
    expect(insight.ramos.map((r) => r.rotulo)).toEqual(['Com Full', 'Sem Full']);
    // Percentual, nunca reais: a busca por termo mistura embalagens (ADR-0138 §3).
    expect(insight.ramos[1].texto).toMatch(/5% abaixo/);
  });

  it('amostra com embalagens diferentes: NENHUM valor em reais, só percentual', () => {
    // O caso real do print: Kit 500 a R$ 39,90, Kit 1000 a R$ 77,96 e Kit 50 a R$ 19,06 no mesmo
    // nicho. A Errata 1 do ADR-0124 matou faixas de preço justamente porque estatística de preço
    // sobre embalagens diferentes não descreve nicho — um "bata R$ 39,90" aqui seria alvo de
    // prejuízo para quem for cadastrar outro kit. Percentual atravessa embalagem; reais não.
    const itens = [
      itemV2({ item_id: 'K500', vendedor: 'L1', titulo: 'Kit 500 Abraçadeira Nylon', vendidos: 10_000, preco: 39.9, full: true }),
      itemV2({ item_id: 'K1000', vendedor: 'L2', titulo: 'Kit 1000 Abraçadeiras Nylon', vendidos: 1_000, preco: 77.96, full: true }),
      itemV2({ item_id: 'K50', vendedor: 'L3', titulo: 'Kit 50 Abraçadeira Universal', vendidos: 1_000, preco: 19.06, full: true }),
      ...Array.from({ length: 9 }, (_, i) => itemV2({ item_id: `X${i}`, vendedor: `L${i + 4}`, titulo: `Outro ${i}`, vendidos: 500, preco: 30 + i, full: true })),
    ];
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.barreira).toBe('concorrencia');
    const [comFull, semFull] = v.ramosEntrada;
    expect(comFull.texto).toMatch(/equivalente ao seu produto/);
    expect(semFull.texto).toMatch(/5% abaixo do concorrente equivalente/);
    // A trava: nenhum ramo pode imprimir reais na busca por termo (valor é exclusivo do EAN).
    for (const r of v.ramosEntrada) expect(r.texto).not.toMatch(/R\$/);
  });

  it('risco de marca NUNCA mostra preço a bater — desconto não evita moderação por IP', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1_000, preco: 400,
      full: false, loja_oficial: i < 11, // 11/20 = 55% > 50%
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.barreira).toBe('marca');
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).not.toBe('ruim');
    expect(v.ramosEntrada).toEqual([]);
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Risco de marca');
    expect(insight.ramos).toEqual([]);
    expect(insight.detalhe).toMatch(/loja oficial/);
    expect(insight.detalhe).toMatch(/Preço não resolve/);
  });

  it('marca ruim vence Full dominante: a barreira mais cara é a que aparece (ADR-0138 §1)', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1_000, preco: 400,
      full: true, loja_oficial: i < 11, // Full 100% E loja oficial 55%
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.fatores.find((f) => f.chave === 'disputa')?.nivel).toBe('ruim');
    expect(v.barreira).toBe('marca');
    expect(v.ramosEntrada).toEqual([]);
  });

  it('concorrência não medida → sem preço a bater, detalhe cita a causa real', () => {
    // Nem o caminho A (nome de loja <50%) nem o B (menos de 5 elegíveis por venda) medem.
    // `preco: null` nos nomeados: contam pra liquidez da Demanda (evita o gate) mas não são
    // elegíveis para concentração, que exige vendidos E preço.
    const nomeados = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLBn${i}`, vendedor: `V${i}`, vendidos: 2_000, preco: null }));
    const anonimosSemVenda = Array.from({ length: 14 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendedor: null, vendidos: null, preco: 100 }));
    const anonimosComVenda = Array.from({ length: 2 }, (_, i) => itemV2({ item_id: `MLBv${i}`, vendedor: null, vendidos: 500, preco: 50 }));
    const v = calcularVereditoAnuncios(painelSintetico([...nomeados, ...anonimosSemVenda, ...anonimosComVenda]), null);
    expect(v.entrada).toBe('nao_medida');
    expect(v.barreira).toBe('nao_medida');
    expect(v.explicacao.gateDemanda).toBe(false);
    expect(v.ramosEntrada).toEqual([]);
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Concorrência não medida');
    expect(insight.tom).toBe('medio');
    expect(insight.detalhe).toMatch(/nome de loja/);
  });

  it('sem prova de venda → card diz que não existe preço a bater, nunca um número', () => {
    const itens = Array.from({ length: 10 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: i < 1 ? 100 : null, preco: 100,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.explicacao.gateDemanda).toBe(true);
    expect(v.titulo).toBe('Sem prova de venda');
    expect(v.ramosEntrada).toEqual([]);
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Sem prova de venda');
    expect(insight.ramos).toEqual([]);
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

  it('campo aberto sem nenhuma barreira → detalhe genérico de campo livre', () => {
    const itens = Array.from({ length: 20 }, (_, i) => itemV2({
      item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1_000, preco: 400,
      full: false, loja_oficial: false,
    }));
    const v = calcularVereditoAnuncios(painelSintetico(itens), null);
    expect(v.entrada).toBe('aberta');
    expect(v.explicacao.fatores.every((f) => f.destravar == null)).toBe(true);
    expect(v.barreira).toBe('nenhuma');
    const insight = insightEntrada(v);
    expect(insight.titulo).toBe('Como entrar neste nicho');
    expect(insight.tom).toBe('bom');
    expect(insight.detalhe).toBe('Sem barreira estrutural detectada nesta amostra — campo livre pra quem chega agora.');
    expect(insight.ramos).toEqual([]); // Full não domina: sem handicap de prazo, nada a compensar
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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calcularVeredito, calcularVereditoAnuncios, contextoNicho, contextoNichoAnuncios, subamostraNomeada,
} from '../veredito-sonar';
import type { VereditoAnuncios } from '../veredito-sonar';
import type { ItemVendasSonar, PainelSonar, PainelVendasSonar } from '../sonar';

// Fixtures dos 3 nichos REAIS medidos em 18/08 — são o gabarito da calibração (ADR-0124).
// O caso decisivo é o tecido oxford: é um nicho em que o Diego vende de verdade, então uma regra
// que o classifique como oportunidade baixa está errada por construção.
function painel(over: {
  visitas?: number; ofertas?: number; vendedores?: number; frete?: number;
  catalogo?: number; fichasComOficial?: number; fichasAtivas?: number;
}): PainelSonar {
  const ativas = over.fichasAtivas ?? 10;
  const comOficial = over.fichasComOficial ?? 0;
  return {
    termo: 'x',
    gerado_em: '2026-08-18T00:00:00.000Z',
    total_catalogo: over.catalogo ?? 10_000,
    fichas: Array.from({ length: ativas }, (_, i) => ({
      product_id: `MLB${i}`,
      nome: `Produto ${i}`,
      category_id: null,
      ofertas: 1,
      preco: { min: 10, mediana: 20, max: 30 },
      frete_gratis_pct: 0,
      visitas_30d: null,
      visitas_por_dia: [],
      vendedores: [{ seller_id: i, uf: 'SP', transacoes_total: 10, loja_oficial: i < comOficial }],
    })),
    agregado: {
      visitas_30d_total: over.visitas ?? 0,
      visitas_por_dia: [],
      ofertas_total: over.ofertas ?? 0,
      vendedores_distintos: over.vendedores ?? 0,
      frete_gratis_pct: over.frete ?? 0,
    },
    palavras_chave: [],
  };
}

function vendas(over: Partial<PainelVendasSonar>): PainelVendasSonar {
  return {
    configurado: true,
    termo: 'x',
    gerado_em: '2026-08-18T00:00:00.000Z',
    itens_analisados: 20,
    itens_com_vendas: 15,
    vendas_totais: 100_000,
    valor_mercado: 1_000_000,
    produto_destaque: null,
    palavras_chave_titulos: [],
    raio_x: {
      total_anuncios: null, ticket_medio: null, lojas_oficiais: 0, full: 0,
      frete_gratis: 0, internacionais: 0,
    },
    ...over,
  };
}

describe('calcularVeredito — gabarito dos nichos reais', () => {
  it('EUCERIN protetor solar: MÉDIA — mercado forte, mas disputa profissionalizada', () => {
    const v = calcularVeredito(
      painel({ visitas: 79_830, ofertas: 60, vendedores: 27, frete: 88 }),
      vendas({ itens_com_vendas: 15, itens_analisados: 20, vendas_totais: 154_100, valor_mercado: 17_470_820 }),
    );
    expect(v.nivel).toBe('media');
    expect(v.fatores.find((f) => f.chave === 'demanda')!.nivel).toBe('bom');
    expect(v.fatores.find((f) => f.chave === 'disputa')!.nivel).toBe('ruim'); // 27 vendedores, 88% frete
    expect(v.fatores.find((f) => f.chave === 'tracao')!.nivel).toBe('bom');   // R$ 647k por vendedor
    expect(v.motivo).toMatch(/disputa alta/i);

    // explicacao: pontuação, gate e frases com os números reais
    expect(v.explicacao.pontuacao).toEqual({ soma: 4, maximo: 6 });
    expect(v.explicacao.gateDemanda).toBe(false);

    const demanda = v.explicacao.fatores.find((f) => f.chave === 'demanda')!;
    expect(demanda.nivel).toBe('bom');
    expect(demanda.frase).toContain('75%');
    expect(demanda.frase).toContain('154.100');
    expect(demanda.destravar).toBeNull();

    const disputa = v.explicacao.fatores.find((f) => f.chave === 'disputa')!;
    expect(disputa.nivel).toBe('ruim');
    expect(disputa.frase).toContain('27 vendedores');
    expect(disputa.frase).toContain('25'); // corte citado na frase
    expect(disputa.destravar).toBe('com até 25 vendedores a disputa sairia da zona crítica — hoje são 27');
    expect(disputa.regua).toEqual({ min: 0, max: 40, cortes: [10, 25], valor: 27, invertida: true });

    const tracao = v.explicacao.fatores.find((f) => f.chave === 'tracao')!;
    expect(tracao.nivel).toBe('bom');
    expect(tracao.frase).toContain('647,1 mil');
    expect(tracao.destravar).toBeNull();

    expect(v.explicacao.acao).toMatch(/nicho viável com ressalvas/i);
  });

  it('protetor solar facial (genérico): MÉDIA — mesma leitura em escala maior', () => {
    const v = calcularVeredito(
      painel({ visitas: 79_830, ofertas: 60, vendedores: 27, frete: 88 }),
      vendas({ itens_com_vendas: 17, itens_analisados: 20, vendas_totais: 812_000, valor_mercado: 58_841_260 }),
    );
    expect(v.nivel).toBe('media');
  });

  it('tecido oxford 10 metros: ALTA — nicho pequeno não pode ser punido por ser pequeno', () => {
    const v = calcularVeredito(
      painel({ visitas: 452, ofertas: 13, vendedores: 7, frete: 23 }),
      vendas({ itens_com_vendas: 39, itens_analisados: 48, vendas_totais: 8_100, valor_mercado: 596_215 }),
    );
    expect(v.nivel).toBe('alta');
    expect(v.fatores.find((f) => f.chave === 'disputa')!.nivel).toBe('bom');
    expect(v.motivo).toMatch(/quase sem disputa/i);

    expect(v.explicacao.pontuacao).toEqual({ soma: 5, maximo: 6 });
    expect(v.explicacao.gateDemanda).toBe(false);

    const disputa = v.explicacao.fatores.find((f) => f.chave === 'disputa')!;
    expect(disputa.nivel).toBe('bom');
    expect(disputa.frase).toContain('7 vendedores');
    expect(disputa.destravar).toBeNull();

    const tracao = v.explicacao.fatores.find((f) => f.chave === 'tracao')!;
    expect(tracao.nivel).toBe('medio');
    expect(tracao.destravar).toBe('a partir de R$ 150 mil por vendedor a tração deixaria de ser intermediária e passaria a puxar o veredito para cima');

    expect(v.explicacao.acao).toMatch(/sinais favoráveis/i);
  });

  it('catálogo saturado em 10.000 não derruba a Disputa (os dois nichos reais mostram 10.000)', () => {
    const base = { visitas: 452, ofertas: 13, vendedores: 7, frete: 23 };
    const comSaturacao = calcularVeredito(painel({ ...base, catalogo: 10_000 }), vendas({
      itens_com_vendas: 39, itens_analisados: 48, vendas_totais: 8_100, valor_mercado: 596_215,
    }));
    const semSaturacao = calcularVeredito(painel({ ...base, catalogo: 300 }), vendas({
      itens_com_vendas: 39, itens_analisados: 48, vendas_totais: 8_100, valor_mercado: 596_215,
    }));
    expect(comSaturacao.nivel).toBe(semSaturacao.nivel);
  });
});

describe('calcularVeredito — gates e casos de borda', () => {
  it('sem venda comprovada é BAIXA por gate, mesmo com disputa ótima', () => {
    const v = calcularVeredito(
      painel({ visitas: 50_000, vendedores: 2, frete: 10 }),
      vendas({ itens_com_vendas: 1, itens_analisados: 20, vendas_totais: 300, valor_mercado: 20_000 }),
    );
    expect(v.nivel).toBe('baixa');
    expect(v.motivo).toMatch(/sem vendas comprovadas/i);

    expect(v.explicacao.gateDemanda).toBe(true);
    const demanda = v.explicacao.fatores.find((f) => f.chave === 'demanda')!;
    expect(demanda.nivel).toBe('ruim');
    expect(demanda.frase).toContain('300');
    expect(demanda.frase).toContain('1.000');
    expect(demanda.destravar).toBe('com 1.000 vendas na amostra a demanda sairia do piso — hoje são 300');
    expect(v.explicacao.acao).toMatch(/demanda insuficiente derruba o veredito para baixa/i);
  });

  it('dinheiro diluído entre muitos vendedores derruba a tração', () => {
    const v = calcularVeredito(
      painel({ visitas: 50_000, vendedores: 24, frete: 40 }),
      vendas({ itens_com_vendas: 18, itens_analisados: 20, vendas_totais: 60_000, valor_mercado: 500_000 }),
    );
    expect(v.fatores.find((f) => f.chave === 'tracao')!.nivel).toBe('ruim'); // R$ 20,8k por vendedor
    expect(v.nivel).toBe('media');
  });

  it('sem vendas (Apify fora): cai no proxy de visitas, sai Tração e avisa semVendas', () => {
    const v = calcularVeredito(painel({ visitas: 50_000, vendedores: 5, frete: 20 }), null);
    expect(v.semVendas).toBe(true);
    expect(v.fatores.map((f) => f.chave)).toEqual(['demanda', 'disputa']);
    expect(v.fatores[0].detalhe).toMatch(/visitas/);
    expect(v.nivel).toBe('alta');

    // sem vendas: Tração some da explicação também; Demanda vira frase de visitas (proxy, não prova).
    expect(v.explicacao.fatores.map((f) => f.chave)).not.toContain('tracao');
    const demanda = v.explicacao.fatores.find((f) => f.chave === 'demanda')!;
    expect(demanda.frase).toMatch(/50 mil visitas/);
    expect(demanda.frase).toMatch(/sem dados de venda/i);
    expect(demanda.destravar).toBeNull();
  });

  it('sem vendas e sem procura: BAIXA com motivo de procura, não de venda', () => {
    const v = calcularVeredito(painel({ visitas: 120, vendedores: 5, frete: 20 }), null);
    expect(v.nivel).toBe('baixa');
    expect(v.motivo).toMatch(/procura/i);

    expect(v.explicacao.gateDemanda).toBe(true);
    const demanda = v.explicacao.fatores.find((f) => f.chave === 'demanda')!;
    expect(demanda.frase).toContain('120');
    expect(demanda.frase).toMatch(/sem dados de venda/i);
    expect(demanda.destravar).toBe('a partir de 300 visitas em 30 dias a demanda sairia do piso — hoje são 120');
    expect(demanda.regua).toEqual({ min: 0, max: 15_000, cortes: [300, 10_000], valor: 120, invertida: false });
  });

  it('marca é só alerta: não muda o veredito, mas reporta o percentual', () => {
    const args = [
      painel({ visitas: 452, ofertas: 13, vendedores: 7, frete: 23, fichasAtivas: 10, fichasComOficial: 8 }),
      vendas({ itens_com_vendas: 39, itens_analisados: 48, vendas_totais: 8_100, valor_mercado: 596_215 }),
    ] as const;
    const v = calcularVeredito(...args);
    expect(v.nivel).toBe('alta');              // 80% loja oficial NÃO derruba
    expect(v.marca!.nivel).toBe('ruim');
    expect(v.marca!.detalhe).toMatch(/80%/);

    const marca = v.explicacao.fatores.find((f) => f.chave === 'marca')!;
    expect(marca.nivel).toBe('ruim');
    expect(marca.frase).toContain('80%');
    expect(marca.frase).toMatch(/não entra na pontuação/i);
    expect(marca.frase).toMatch(/propriedade intelectual/i);
    expect(marca.destravar).toBe('abaixo de 50% das fichas com loja oficial este alerta sairia da zona crítica — hoje são 80%');
    expect(marca.regua).toEqual({ min: 0, max: 100, cortes: [20, 50], valor: 80, invertida: true });
  });
});

describe('calcularVeredito — explicacao: pontuação nunca some quando fator é bom', () => {
  it('demanda, disputa e tração bons: destravar é sempre null (nada pra destravar)', () => {
    // valor_mercado bem alto por vendedor pra garantir tração 'bom' também.
    const v = calcularVeredito(
      painel({ visitas: 452, ofertas: 13, vendedores: 5, frete: 20 }),
      vendas({ itens_com_vendas: 18, itens_analisados: 20, vendas_totais: 8_100, valor_mercado: 1_000_000 }),
    );
    for (const f of v.explicacao.fatores) {
      if (f.nivel === 'bom') expect(f.destravar).toBeNull();
      else expect(f.destravar).not.toBeNull();
    }
  });
});

describe('contextoNicho — leitura complementar, fora do score', () => {
  it('sem vendas configuradas: só a mediana de preço das fichas', () => {
    const itens = contextoNicho(painel({ visitas: 452, vendedores: 7, frete: 23 }), null);
    expect(itens).toEqual([{ rotulo: 'Preço mediano das fichas', valor: 'R$ 20,00' }]);
  });

  it('com vendas configuradas: soma ticket médio, % Full e % internacionais da amostra', () => {
    const v = vendas({
      itens_analisados: 20,
      raio_x: { total_anuncios: null, ticket_medio: 99.9, lojas_oficiais: 0, full: 4, frete_gratis: 0, internacionais: 2 },
    });
    const itens = contextoNicho(painel({ visitas: 452, vendedores: 7, frete: 23 }), v);
    const rotulos = itens.map((i) => i.rotulo);
    expect(rotulos).toEqual([
      'Preço mediano das fichas',
      'Ticket médio da amostra',
      '% Full na amostra',
      '% internacionais na amostra',
    ]);
    expect(itens.find((i) => i.rotulo === '% Full na amostra')!.valor).toBe('20%');
    expect(itens.find((i) => i.rotulo === '% internacionais na amostra')!.valor).toBe('10%');
  });
});

// =============== Veredito v2 (ADR-0127/D10-D12): a unidade é o ANÚNCIO ==========================
// Fixtures REAIS medidos em 19/08 (US$ 0,30 de Apify), congelados em fixtures/sonar-gabarito/.
// O gabarito herdado do ADR-0124 é inegociável: média / média / ALTA, nessa ordem.
// `scripts/sonar-gabarito-verificar.mjs` é a definição executável das fórmulas — se estes testes
// e o script divergirem, quem errou foi a implementação, não o corte.

const fixture = (slug: string): { vendas: PainelVendasSonar; visitas_total: number | null } =>
  JSON.parse(readFileSync(`src/lib/__tests__/fixtures/sonar-gabarito/${slug}.json`, 'utf8'));

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
    expect(v.explicacao.pontuacao).toEqual({ soma: 5, maximo: 6 });
    expect(v.fatores.map((f) => f.nivel)).toEqual(['bom', 'bom', 'medio']);
  });
  it('cobertura exatamente 0,50 (oxford) PASSA na trava — só "menos de 50%" derruba', () => {
    const { vendas } = fixture('tecido-oxford-10-metros');
    expect(subamostraNomeada(vendas).cobertura).toBe(0.5);
    expect(calcularVereditoAnuncios(vendas, null).fatores).toHaveLength(3);
  });
});

describe('trava de cobertura <50% (D10) — nunca medir concorrência sobre meia dúzia de rótulos', () => {
  const travado = () => {
    const nomeados = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLB${i}`, vendedor: `V${i}`, vendidos: 2000 }));
    const anonimos = Array.from({ length: 16 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendedor: null, vendidos: 2000 }));
    return calcularVereditoAnuncios(painelSintetico([...nomeados, ...anonimos]), null);
  };

  it('4/20 nomeados → só o fator Demanda pontua; Disputa e Tração fora', () => {
    expect(travado().fatores.map((f) => f.chave)).toEqual(['demanda']);
  });

  it('Demanda 🟢 sozinha NÃO vira oportunidade alta (piso de 2 fatores)', () => {
    const v = travado();
    expect(v.fatores[0].nivel).toBe('bom');
    expect(v.nivel).toBe('media');
  });

  it('veredito se declara PARCIAL — a trava não rebaixa em silêncio', () => {
    const v = travado();
    expect(v.parcial).toBe(true);
    expect(v.motivo).toMatch(/concorrência/i);
    expect(v.explicacao.acao).toMatch(/parcial/i);
    expect(v.explicacao.fatores.some((f) => f.chave === 'disputa' && f.regua === null)).toBe(true);
  });
});

describe('invariância ao tamanho da amostra (D11) — a censura não pode mudar o nível', () => {
  it('nicho totalmente pulverizado com 6 e com 20 itens → mesmo nível de Disputa', () => {
    const nicho = (n: number) => painelSintetico(Array.from({ length: n }, (_, i) =>
      itemV2({ item_id: `MLB${i}`, vendedor: `LOJA-${i}`, vendidos: 1000 })));
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

describe('vocabulário (ADR-0127 §Fragilidades) — o card imprime a MARCA, não o nickname', () => {
  it('nenhum texto gerado diz "vendedor": só "rótulo de loja"', () => {
    const casos: VereditoAnuncios[] = [
      ...['eucerin-protetor-solar', 'protetor-solar-facial', 'tecido-oxford-10-metros'].map((s) => {
        const { vendas, visitas_total } = fixture(s);
        return calcularVereditoAnuncios(vendas, visitas_total);
      }),
      calcularVereditoAnuncios(painelSintetico([itemV2({ vendedor: null, vendidos: 1 })]), null),
    ];
    for (const v of casos) {
      for (const texto of textosGerados(v)) expect(texto).not.toMatch(/vendedor/i);
      expect(textosGerados(v).some((t) => /rótulo/i.test(t))).toBe(true);
    }
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
    expect(itens.find((i) => i.rotulo === '% Full na amostra')!.valor).toBe('20%');
  });
});

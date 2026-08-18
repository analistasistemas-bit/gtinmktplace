import { describe, expect, it } from 'vitest';
import { calcularVeredito, contextoNicho } from '../veredito-sonar';
import type { PainelSonar, PainelVendasSonar } from '../sonar';

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

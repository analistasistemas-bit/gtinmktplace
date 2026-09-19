import { describe, expect, it } from 'vitest';
import {
  COMPRIMENTO_PE_CM, CONTORNO_PEITO_CM, domainIdSemPrefixo, mensagemForaDoSuperset,
  mensagemNumeracaoNaoSuportada, montarLinhasChart, montarLinhasChartCalcado, nomeChart,
  parseLinhasCalcado, parseLinhasResposta, tabelaComprimentoPe,
} from '../size-chart.ts';

// Achado real (produção, 2026-09-19): a 1ª tentativa de publicação real ficou presa em retry
// porque POST /catalog/charts recusou o nome com `invalid_chart_name` — a mensagem cita "máximo
// 60 caracteres" mas o nome tinha 45; reproduzido isolado contra a API real, o `_` de
// "JACKETS_AND_COATS" (domain_id cru) é que invalida o nome, não o tamanho. Nome sem `_` (mesmo
// mais longo) passou. `nomeChart` nunca pode deixar `_` vazar pro campo `names`.
describe('nomeChart (ADR-0167 — achado real de produção)', () => {
  it('nunca contém underscore, mesmo com domain_id cru (JACKETS_AND_COATS)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome).not.toContain('_');
  });

  it('troca underscore por espaço, preservando legibilidade', () => {
    expect(nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M'])).toBe('PubliAI Guia Jackets And Coats masculino P-M');
  });

  it('nunca passa de 60 caracteres (limite real confirmado)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome.length).toBeLessThanOrEqual(60);
  });
});

describe('domainIdSemPrefixo (ADR-0167)', () => {
  it('remove o prefixo MLB- do catalog_domain', () => {
    expect(domainIdSemPrefixo('MLB-JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('mantém intacto quando já não tem prefixo', () => {
    expect(domainIdSemPrefixo('JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('null/undefined vira null', () => {
    expect(domainIdSemPrefixo(null)).toBeNull();
    expect(domainIdSemPrefixo(undefined)).toBeNull();
  });
});

// Achado real (2026-09-19, pedido do Diego "acrescente o tamanho Único"): confirmado por 3
// chamadas reais (Spike 051 §12) que "Tamanho Único" não pode entrar no guia de tamanhos em
// JACKETS_AND_COATS/SPORT_T_SHIRTS — FILTRABLE_SIZE não tem essa opção no catálogo do ML, e o
// item exige SIZE_GRID_ID incondicionalmente (nenhuma isenção pra Único). A mensagem de erro
// precisa deixar claro que é limite do ML, não lacuna nossa — senão parece um bug a corrigir.
describe('mensagemForaDoSuperset (ADR-0167 / achado real "Tamanho Único")', () => {
  it('tamanho Único cita a causa real (FILTRABLE_SIZE sem essa opção no ML)', () => {
    const msg = mensagemForaDoSuperset(['Único']);
    expect(msg).toMatch(/FILTRABLE_SIZE/);
    expect(msg).toMatch(/Mercado Livre|ML/);
  });

  it('outros tamanhos fora do superset mantêm a mensagem genérica', () => {
    const msg = mensagemForaDoSuperset(['XG']);
    expect(msg).toMatch(/sem medida confirmada/);
    expect(msg).not.toMatch(/FILTRABLE_SIZE/);
  });

  it('mistura de Único com outro tamanho cita os dois casos', () => {
    const msg = mensagemForaDoSuperset(['XG', 'Único']);
    expect(msg).toMatch(/XG/);
    expect(msg).toMatch(/Único/);
    expect(msg).toMatch(/FILTRABLE_SIZE/);
  });
});

describe('montarLinhasChart (ADR-0167 / Spike 051 §3)', () => {
  const sizeValores = [{ id: '17552780', nome: 'P' }, { id: '2282666', nome: 'M' }];
  // Achado real do spike: FILTRABLE_SIZE tem value_id PRÓPRIO, diferente de SIZE, para o mesmo tamanho.
  const filtravelValores = [{ id: '13853813', nome: 'P' }, { id: '12917795', nome: 'M' }];

  it('monta SIZE + FILTRABLE_SIZE + CHEST_CIRCUMFERENCE_FROM por linha, com ids corretos de cada namespace', () => {
    const linhas = montarLinhasChart(['P', 'M'], sizeValores, filtravelValores);
    expect(linhas).toEqual([
      { attributes: [
        { id: 'SIZE', values: [{ id: '17552780', name: 'P' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '13853813', name: 'P' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '88 cm' }] },
      ] },
      { attributes: [
        { id: 'SIZE', values: [{ id: '2282666', name: 'M' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '12917795', name: 'M' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '96 cm' }] },
      ] },
    ]);
  });

  it('tamanho sem medida confirmada (ex.: Tamanho Único) falha alto em vez de inventar', () => {
    expect(() => montarLinhasChart(['Único'], sizeValores, filtravelValores))
      .toThrow(/sem valor\/medida confirmado/);
  });

  it('tamanho sem value_id em SIZE ou FILTRABLE_SIZE falha alto', () => {
    expect(() => montarLinhasChart(['G'], sizeValores, filtravelValores)).toThrow();
  });

  it('CONTORNO_PEITO_CM só cobre P/M/G/GG — trava contra regressão silenciosa', () => {
    expect(Object.keys(CONTORNO_PEITO_CM).sort()).toEqual(['G', 'GG', 'M', 'P']);
  });
});

describe('parseLinhasResposta (ADR-0167 / Spike 051 §3)', () => {
  it('extrai tamanho -> {rowId, sizeLabel} da resposta real do ML', () => {
    const rows = [
      { id: '8522331:1', attributes: [{ id: 'SIZE', values: [{ name: 'P' }] }, { id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] },
      { id: '8522331:2', attributes: [{ id: 'SIZE', values: [{ name: 'M' }] }] },
    ];
    const mapa = parseLinhasResposta(rows);
    expect(mapa.get('P')).toEqual({ rowId: '8522331:1', sizeLabel: 'P' });
    expect(mapa.get('M')).toEqual({ rowId: '8522331:2', sizeLabel: 'M' });
    expect(mapa.size).toBe(2);
  });

  it('linha sem atributo SIZE não entra no mapa', () => {
    const rows = [{ id: '8522331:9', attributes: [{ id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] }];
    expect(parseLinhasResposta(rows).size).toBe(0);
  });
});

// ADR-0167 / achado real 2026-09-19 (pedido do Diego: "veja agora a de sapato/sandalias"):
// FOOTWEAR não usa SIZE+FILTRABLE_SIZE+CHEST_CIRCUMFERENCE_FROM como vestuário — usa
// BR_SIZE+FOOT_LENGTH (confirmado via POST /catalog/charts real contra SANDALS_AND_CLOGS,
// Spike 051 §13). COMPRIMENTO_PE_CM vem do chart STANDARD oficial do próprio ML (masculino
// id 210058, feminino id 210059) — não é tabela inventada, é dado publicado pelo ML.
describe('COMPRIMENTO_PE_CM (ADR-0167 / Spike 051 §13 — dado real do chart STANDARD do ML)', () => {
  it('masculino cobre 33 a 48 (chart STANDARD real 210058)', () => {
    expect(COMPRIMENTO_PE_CM.masculino['33']).toBe(22.5);
    expect(COMPRIMENTO_PE_CM.masculino['40']).toBe(26.5);
    expect(COMPRIMENTO_PE_CM.masculino['48']).toBe(33);
  });

  it('feminino cobre 33 a 44 (chart STANDARD real 210059)', () => {
    expect(COMPRIMENTO_PE_CM.feminino['33']).toBe(22);
    expect(COMPRIMENTO_PE_CM.feminino['37']).toBe(24.7);
    expect(COMPRIMENTO_PE_CM.feminino['44']).toBe(29.3);
  });
});

describe('tabelaComprimentoPe (ADR-0167)', () => {
  it('feminino usa a própria tabela', () => {
    expect(tabelaComprimentoPe('feminino')).toBe(COMPRIMENTO_PE_CM.feminino);
  });

  it('masculino usa a própria tabela', () => {
    expect(tabelaComprimentoPe('masculino')).toBe(COMPRIMENTO_PE_CM.masculino);
  });

  // Decisão explícita: o ML não publica chart STANDARD "Sem gênero" (testado, resposta vazia,
  // Spike 051 §13) — unissex reaproveita a tabela masculino (cobre 33-48 por completo, igual à
  // faixa de NUMERACOES_CALCADO; a feminino para em 44). Assunção sinalizada ao Diego.
  it('unissex reaproveita a tabela masculino (sem chart STANDARD "Sem gênero" no ML)', () => {
    expect(tabelaComprimentoPe('unissex')).toBe(COMPRIMENTO_PE_CM.masculino);
  });
});

describe('montarLinhasChartCalcado (ADR-0167 / Spike 051 §13)', () => {
  it('monta BR_SIZE + FOOT_LENGTH com struct numérico (formato real confirmado)', () => {
    const linhas = montarLinhasChartCalcado(['37', '40'], COMPRIMENTO_PE_CM.feminino);
    expect(linhas).toEqual([
      { attributes: [
        { id: 'BR_SIZE', values: [{ name: '37 BR', struct: { number: 37, unit: 'BR' } }] },
        { id: 'FOOT_LENGTH', values: [{ name: '24.7 cm', struct: { number: 24.7, unit: 'cm' } }] },
      ] },
      { attributes: [
        { id: 'BR_SIZE', values: [{ name: '40 BR', struct: { number: 40, unit: 'BR' } }] },
        { id: 'FOOT_LENGTH', values: [{ name: '26.7 cm', struct: { number: 26.7, unit: 'cm' } }] },
      ] },
    ]);
  });

  it('numeração fora da tabela (ex.: par "33/34") falha alto em vez de inventar', () => {
    expect(() => montarLinhasChartCalcado(['33/34'], COMPRIMENTO_PE_CM.masculino)).toThrow();
  });
});

// Achado real (2026-09-19, sandália): /items/validate recusou o item com SIZE="37"
// (invalid.fashion_grid.size.values) e só aceitou com SIZE="37 BR" — o rótulo da linha do chart,
// não o valor cru da categoria. `sizeLabel` existe pra carregar esse rótulo até o payload do item.
describe('parseLinhasCalcado (ADR-0167 / Spike 051 §13 — sizeLabel é o achado real de produção)', () => {
  it('extrai numeração -> {rowId, sizeLabel} de um chart STANDARD real (atributo SIZE com struct.number)', () => {
    const rows = [
      { id: '210058:8', attributes: [{ id: 'SIZE', values: [{ name: '40 BR', struct: { number: 40 } }] }] },
    ];
    expect(parseLinhasCalcado(rows).get('40')).toEqual({ rowId: '210058:8', sizeLabel: '40 BR' });
  });

  it('extrai numeração -> {rowId, sizeLabel} de um chart SPECIFIC nosso (atributo BR_SIZE com struct.number)', () => {
    const rows = [
      { id: '8077736:1', attributes: [{ id: 'BR_SIZE', values: [{ name: '37 BR', struct: { number: 37 } }] }] },
    ];
    expect(parseLinhasCalcado(rows).get('37')).toEqual({ rowId: '8077736:1', sizeLabel: '37 BR' });
  });

  it('linha sem SIZE nem BR_SIZE não entra no mapa', () => {
    const rows = [{ id: 'x:1', attributes: [{ id: 'FOOT_LENGTH', values: [{ name: '24 cm' }] }] }];
    expect(parseLinhasCalcado(rows).size).toBe(0);
  });
});

describe('mensagemNumeracaoNaoSuportada (ADR-0167)', () => {
  it('cita o(s) valor(es) e explica que não é lacuna de mapeamento', () => {
    const msg = mensagemNumeracaoNaoSuportada(['33/34', '45/46']);
    expect(msg).toMatch(/33\/34/);
    expect(msg).toMatch(/45\/46/);
    expect(msg).toMatch(/comprimento de p[ée]/i);
  });
});

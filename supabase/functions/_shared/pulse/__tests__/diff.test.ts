import { describe, it, expect } from 'vitest';
import { diffOfertas, entradaDiffRelevante } from '../diff.ts';
import type { OfertaAnterior, OfertaColetada } from '../tipos.ts';

const oferta = (over: Partial<OfertaColetada> = {}): OfertaColetada => ({
  item_id: 'MLB1',
  seller_id: 1,
  preco: 100,
  tier: 'gold_special',
  frete_gratis: false,
  full_ml: false,
  loja_oficial: false,
  permalink: null,
  ...over,
});
const anterior = (over: Partial<OfertaAnterior> = {}): OfertaAnterior => ({ ...oferta(), ativo: true, ...over });
type OfertaQualificavelDiff = OfertaColetada & {
  transactions_total: number | null;
  visitas_30d: number | null;
  nivel: string | null;
};
const ofertaQualificavel = (
  over: Partial<OfertaQualificavelDiff> = {},
): OfertaQualificavelDiff => ({
  ...oferta(), transactions_total: 10, visitas_30d: 1, nivel: '3_yellow', ...over,
});
const anteriorQualificavel = (
  over: Partial<OfertaQualificavelDiff & { ativo: boolean }> = {},
): OfertaQualificavelDiff & { ativo: boolean } => ({ ...ofertaQualificavel(), ativo: true, ...over });

describe('diffOfertas', () => {
  it('primeira coleta: grava tudo, 0 alertas', () => {
    const atuais = [oferta({ item_id: 'MLB1' }), oferta({ item_id: 'MLB2', seller_id: 2 })];
    const r = diffOfertas([], atuais);
    expect(r.gravar).toEqual(atuais);
    expect(r.desativar).toEqual([]);
    expect(r.alertas).toEqual([]);
  });

  it('preço caiu (menor preço do produto): gravar + alerta preco_caiu com de/para', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 80 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toEqual(atuais);
    expect(r.alertas).toContainEqual({
      tipo: 'preco_caiu', payload: { de: 100, para: 80, meu_preco: null }, severidade: 'info',
    });
  });

  it('oferta nova: alerta novo_concorrente', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [
      oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      oferta({ item_id: 'MLB2', seller_id: 2, preco: 90 }),
    ];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toContainEqual(atuais[1]);
    expect(r.alertas).toContainEqual({
      tipo: 'novo_concorrente',
      payload: { item_id: 'MLB2', seller_id: 2, preco: 90, meu_preco: null, nickname: null },
      severidade: 'info',
    });
  });

  it('oferta sumiu mas seller ainda presente (outro item): desativa, sem alerta concorrente_saiu', () => {
    const anteriores = [
      anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      anterior({ item_id: 'MLB2', seller_id: 1, preco: 110 }),
    ];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.desativar).toEqual([anteriores[1]]);
    expect(r.alertas.some((a) => a.tipo === 'concorrente_saiu')).toBe(false);
  });

  it('seller saiu de vez (nenhum item restante dele): alerta concorrente_saiu', () => {
    const anteriores = [
      anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 }),
      anterior({ item_id: 'MLB2', seller_id: 2, preco: 110 }),
    ];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.desativar).toEqual([anteriores[1]]);
    expect(r.alertas).toContainEqual({
      tipo: 'concorrente_saiu',
      payload: { item_id: 'MLB2', seller_id: 2, preco: 110, meu_preco: null, nickname: null },
      severidade: 'info',
    });
  });

  it('full_ml mudou (entrou/saiu da FULL): regrava mesmo com preço estável', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100, full_ml: false })];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100, full_ml: true })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toEqual([atuais[0]]);
  });

  it('nada mudou: gravar vazio, sem alertas', () => {
    const anteriores = [anterior({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const atuais = [oferta({ item_id: 'MLB1', seller_id: 1, preco: 100 })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toEqual([]);
    expect(r.desativar).toEqual([]);
    expect(r.alertas).toEqual([]);
  });

  // Sem isto, uma oferta de preço estável ficaria para sempre sem link, esperando uma mudança de
  // preço que pode nunca vir.
  it('link do anúncio aparecendo numa oferta estável faz gravar (backfill), sem alertar', () => {
    const anteriores = [anterior({ item_id: 'MLB1', preco: 100, permalink: null })];
    const atuais = [oferta({ item_id: 'MLB1', preco: 100, permalink: 'https://x/MLB-1' })];
    const r = diffOfertas(anteriores, atuais);
    expect(r.gravar).toHaveLength(1);
    expect(r.gravar[0].permalink).toBe('https://x/MLB-1');
    expect(r.alertas).toEqual([]);
  });

  // O diff isolado continua idempotente com links ausentes; na coleta real, o enriquecimento
  // anterior a esta etapa deriva o permalink do item_id.
  it('links ausentes nos dois lados não geram regravação em toda execução', () => {
    const anteriores = [anterior({ item_id: 'MLB1', preco: 100, permalink: null })];
    const atuais = [oferta({ item_id: 'MLB1', preco: 100, permalink: null })];
    expect(diffOfertas(anteriores, atuais).gravar).toEqual([]);
  });

  it('não alerta a entrada de oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ item_id: 'MLB1' })]);
    const atuais = entradaDiffRelevante([
      ofertaQualificavel({ item_id: 'MLB1' }),
      ofertaQualificavel({ item_id: 'MLB2', seller_id: 2, transactions_total: 0 }),
    ]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('histórico só fora da referência não suprime alerta da primeira entrada relevante', () => {
    const anterioresBrutos = [
      anteriorQualificavel({ item_id: 'MLB-FORA', transactions_total: 0 }),
    ];
    const anteriores = entradaDiffRelevante(anterioresBrutos);
    const atuais = entradaDiffRelevante([
      ofertaQualificavel({ item_id: 'MLB-RELEVANTE', seller_id: 2, preco: 90 }),
    ]);

    expect(diffOfertas(anteriores, atuais, {
      primeiraColeta: anterioresBrutos.length === 0,
    }).alertas).toContainEqual({
      tipo: 'novo_concorrente',
      payload: { item_id: 'MLB-RELEVANTE', seller_id: 2, preco: 90, meu_preco: null, nickname: null },
      severidade: 'info',
    });
  });

  it('não alerta queda de preço causada por oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ item_id: 'MLB1', preco: 100 })]);
    const atuais = entradaDiffRelevante([
      ofertaQualificavel({ item_id: 'MLB1', preco: 100 }),
      ofertaQualificavel({ item_id: 'MLB2', seller_id: 2, preco: 50, transactions_total: 0 }),
    ]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('não alerta saída de oferta fora da referência', () => {
    const anteriores = entradaDiffRelevante([
      anteriorQualificavel({ item_id: 'MLB1' }),
      anteriorQualificavel({ item_id: 'MLB2', seller_id: 2, transactions_total: 0 }),
    ]);
    const atuais = entradaDiffRelevante([ofertaQualificavel({ item_id: 'MLB1' })]);

    expect(diffOfertas(anteriores, atuais).alertas).toEqual([]);
  });

  it('mantém alerta para queda de preço de oferta relevante', () => {
    const anteriores = entradaDiffRelevante([anteriorQualificavel({ preco: 100 })]);
    const atuais = entradaDiffRelevante([ofertaQualificavel({ preco: 80 })]);

    expect(diffOfertas(anteriores, atuais).alertas).toContainEqual({
      tipo: 'preco_caiu', payload: { de: 100, para: 80, meu_preco: null }, severidade: 'info',
    });
  });
});

describe('severidade do alerta (ADR-0133)', () => {
  it('preco_caiu vira acao quando o menor fica abaixo do nosso preço', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 80 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'preco_caiu')?.severidade).toBe('acao');
  });

  it('preco_caiu fica info quando o menor continua acima do nosso preço', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 95 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'preco_caiu')?.severidade).toBe('info');
  });

  it('sem meuPreco todo alerta é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 10 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 5 })],
      { primeiraColeta: false },
    );
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertas.every((a) => a.severidade === 'info')).toBe(true);
  });

  it('novo_concorrente vira acao só quando entra abaixo de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 80 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    const novo = alertas.filter((a) => a.tipo === 'novo_concorrente');
    expect(novo).toHaveLength(1);
    expect(novo[0].severidade).toBe('acao');
  });

  it('concorrente_saiu vira acao quando o único abaixo de nós sai', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 95 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 95 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    const saiu = alertas.filter((a) => a.tipo === 'concorrente_saiu');
    expect(saiu).toHaveLength(1);
    expect(saiu[0].severidade).toBe('acao');
  });

  it('concorrente_saiu fica info quando ainda resta alguém abaixo de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 70 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 71 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 71 })],
      { primeiraColeta: false, meuPreco: 75 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  it('concorrente_saiu fica info quando quem saiu estava acima de nós', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 120 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 130 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 130 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  // "Ficha esvaziou" vive no bloco da errata 1 logo abaixo: sozinho, o mercado relevante vazio não
  // distingue ficha vazia de falha de qualificação, e a distinção é o que autoriza subir preço.

  it('congela o nickname no payload quando o mapa o conhece', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 80 })],
      { primeiraColeta: false, meuPreco: 90, nicknames: new Map([[2, 'LOJA DOIS']]) },
    );
    expect(alertas.find((a) => a.tipo === 'novo_concorrente')?.payload.nickname).toBe('LOJA DOIS');
  });
});

describe('severidade: ausência de dado nunca aprova subir preço (ADR-0133 errata 1)', () => {
  it('não vira acao quando não sobrou relevante mas a ficha AINDA tem ofertas observadas', () => {
    // S2 continua vendendo a 85 (abaixo dos nossos 90), só não pôde ser qualificado nesta rodada:
    // vendedor visto pela 1ª vez no tier quente não tem perfil. Dizer "pode subir" aqui custa venda.
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      [],
      { primeiraColeta: false, meuPreco: 90, mercadoObservadoVazio: false },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  it('vira acao quando a ficha esvaziou de verdade', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      [],
      { primeiraColeta: false, meuPreco: 90, mercadoObservadoVazio: true },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('acao');
  });

  it('sem a informação, o default é não aprovar', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      [],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });
});

describe('severidade: as células que faltavam da matriz 3×3 (ADR-0133)', () => {
  it('novo_concorrente que entra ACIMA do nosso preço é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 95 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'novo_concorrente')?.severidade).toBe('info');
  });

  it('concorrente_saiu com meuPreco nulo é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      [],
      { primeiraColeta: false, meuPreco: null, mercadoObservadoVazio: true },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('info');
  });

  // Empate exato não é ameaça: quem está no MESMO preço que nós não nos tira a posição, e tratá-lo
  // como ameaça encheria a aba de decisões que não existem. Trava o `<` estrito contra virar `<=`.
  it('novo_concorrente que entra EXATAMENTE no nosso preço é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 100 }), oferta({ item_id: 'MLB2', seller_id: 2, preco: 90 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'novo_concorrente')?.severidade).toBe('info');
  });

  it('preco_caiu que para EXATAMENTE no nosso preço é info', () => {
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', preco: 100 })],
      [oferta({ item_id: 'MLB1', preco: 90 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'preco_caiu')?.severidade).toBe('info');
  });

  it('concorrente_saiu com quem sobrou EXATAMENTE no nosso preço é acao', () => {
    // Ninguém abaixo de nós — empate não nos tira a posição, então subir preço é decisão real.
    // Trava o `minAtual >= meuPreco` contra virar `>`.
    const { alertas } = diffOfertas(
      [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 }), anterior({ item_id: 'MLB2', seller_id: 2, preco: 90 })],
      [oferta({ item_id: 'MLB2', seller_id: 2, preco: 90 })],
      { primeiraColeta: false, meuPreco: 90 },
    );
    expect(alertas.find((a) => a.tipo === 'concorrente_saiu')?.severidade).toBe('acao');
  });
});

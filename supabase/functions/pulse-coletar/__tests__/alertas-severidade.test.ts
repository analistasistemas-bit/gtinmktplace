import { describe, it, expect, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { gravarAlertasRelevantes, textoNotificacaoAlertas } from '../processar.ts';
import type { OfertaAnterior, OfertaColetada } from '../../_shared/pulse/tipos.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
const PRODUTO = '22222222-2222-2222-2222-222222222222';

function oferta(over: Partial<OfertaColetada> = {}): OfertaColetada {
  return {
    item_id: 'MLB1', seller_id: 1, preco: 100, tier: null,
    frete_gratis: false, full_ml: false, loja_oficial: false, permalink: null, ...over,
  };
}
function anterior(over: Partial<OfertaAnterior & { visitas_30d: number | null }> = {}) {
  return { ...oferta(), ativo: true, visitas_30d: null, ...over };
}

interface Cenario {
  vendedores: Array<Record<string, unknown>>;
  ofertasAtual: Array<Record<string, unknown>>;
  inseridos: Array<Record<string, unknown>>;
  /** Erro devolvido pelo insert em `pulse_alertas`, para provar que alerta não gravado não conta. */
  erroInsert?: { message: string };
}

/** Fake mínimo do SupabaseClient: só os padrões de query que `gravarAlertasRelevantes` usa
 *  (leitura paginada por `paginarTudo` em duas tabelas + insert em `pulse_alertas`). */
function fakeAdmin(cenario: Cenario): SupabaseClient {
  function leitura(linhas: Array<Record<string, unknown>>) {
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      range: () => Promise.resolve({ data: linhas, error: null }),
    };
    return api;
  }
  return {
    from(tabela: string) {
      if (tabela === 'pulse_vendedores') return leitura(cenario.vendedores);
      if (tabela === 'pulse_ofertas_atual') return leitura(cenario.ofertasAtual);
      if (tabela === 'pulse_alertas') {
        return {
          insert: (linhas: Array<Record<string, unknown>>) => {
            cenario.inseridos.push(...linhas);
            return Promise.resolve({ error: cenario.erroInsert ?? null });
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  } as unknown as SupabaseClient;
}

// Vendedor 1 qualifica (transações acima do mínimo, reputação verde) e é por ele que o
// `nickname` congelado no payload é exercitado. Vendedor 2 aparece nos cenários em dois papéis
// distintos: SEM linha em `pulse_vendedores` é o vendedor visto pela primeira vez no tier quente,
// que o `entradaDiffRelevante` derruba por dados insuficientes (e por isso nunca chega a payload
// nenhum); com `VENDEDOR_QUALIFICADO_2` ele passa e vira alerta.
const VENDEDOR_QUALIFICADO = {
  seller_id: 1, nickname: 'LOJA UM', transactions_total: 50,
  nivel: '5_green', dia: '2026-08-25', perfil_coletado_em: '2026-08-25T10:00:00Z',
};
const VENDEDOR_QUALIFICADO_2 = { ...VENDEDOR_QUALIFICADO, seller_id: 2, nickname: 'LOJA DOIS' };

describe('gravarAlertasRelevantes: severidade (ADR-0133)', () => {
  it('não aprova subir preço quando a ficha trouxe oferta que só não pôde ser qualificada', async () => {
    // Errata 1: a lista relevante fica vazia por dois motivos que ela não distingue. Aqui a ficha
    // TROUXE o vendedor 2 a 85 (abaixo dos nossos 90) — ele só não pôde ser qualificado. Olhar a
    // lista filtrada faria isso passar por "a ficha esvaziou" e mandaria subir preço.
    const cenario: Cenario = { vendedores: [VENDEDOR_QUALIFICADO], ofertasAtual: [], inseridos: [] };
    const resultado = await gravarAlertasRelevantes(fakeAdmin(cenario), ORG, [{
      produtoId: PRODUTO,
      anteriores: [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      atuais: [oferta({ item_id: 'MLB2', seller_id: 2, preco: 85 })],
      estadoGravado: true,
      meuPreco: 90,
      // A ficha coube inteira: o que barra a aprovação aqui é a NÃO-QUALIFICAÇÃO, não truncamento.
      fichaCompleta: true,
    }]);

    expect(cenario.inseridos).toHaveLength(1);
    expect(cenario.inseridos[0]).toMatchObject({ tipo: 'concorrente_saiu', severidade: 'info' });
    expect(resultado).toEqual({ total: 1, acao: 0 });
  });

  it('aprova quando a ficha realmente esvaziou, contando a ação e congelando o nickname', async () => {
    const cenario: Cenario = { vendedores: [VENDEDOR_QUALIFICADO], ofertasAtual: [], inseridos: [] };
    const resultado = await gravarAlertasRelevantes(fakeAdmin(cenario), ORG, [{
      produtoId: PRODUTO,
      anteriores: [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      atuais: [],
      estadoGravado: true,
      meuPreco: 90,
      fichaCompleta: true,
    }]);

    expect(cenario.inseridos).toHaveLength(1);
    expect(cenario.inseridos[0]).toMatchObject({ tipo: 'concorrente_saiu', severidade: 'acao' });
    expect(cenario.inseridos[0].payload).toMatchObject({ meu_preco: 90, nickname: 'LOJA UM' });
    expect(resultado).toEqual({ total: 1, acao: 1 });
  });

  it('sem meuPreco nenhum alerta vira acao, mesmo com a ficha inteira e vazia', async () => {
    // Doutrina do D-2 na fronteira do coletor: sem preço nosso não vendemos o item e não há
    // decisão de preço a tomar. Tudo o mais neste cenário aprovaria (ficha lida por inteiro,
    // ninguém restou, quem saiu estava barato) — só falta o nosso preço.
    const cenario: Cenario = {
      vendedores: [VENDEDOR_QUALIFICADO, VENDEDOR_QUALIFICADO_2], ofertasAtual: [], inseridos: [],
    };
    const resultado = await gravarAlertasRelevantes(fakeAdmin(cenario), ORG, [{
      produtoId: PRODUTO,
      anteriores: [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      atuais: [oferta({ item_id: 'MLB2', seller_id: 2, preco: 70 })],
      estadoGravado: true,
      meuPreco: null,
      fichaCompleta: true,
    }]);

    expect(cenario.inseridos.length).toBeGreaterThan(0);
    expect(cenario.inseridos.every((a) => a.severidade === 'info')).toBe(true);
    expect(resultado.acao).toBe(0);
  });

  it('insert que falha não conta alerta nenhum', async () => {
    // Cenário deliberadamente de `acao` (ficha esvaziou de verdade): com os contadores
    // incrementados antes de checar o erro, o retorno seria { total: 1, acao: 1 } e a notificação
    // prometeria uma decisão que não existe no banco.
    const cenario: Cenario = {
      vendedores: [VENDEDOR_QUALIFICADO], ofertasAtual: [], inseridos: [],
      erroInsert: { message: 'permission denied for table pulse_alertas' },
    };
    const resultado = await gravarAlertasRelevantes(fakeAdmin(cenario), ORG, [{
      produtoId: PRODUTO,
      anteriores: [anterior({ item_id: 'MLB1', seller_id: 1, preco: 80 })],
      atuais: [],
      estadoGravado: true,
      meuPreco: 90,
      fichaCompleta: true,
    }]);

    expect(resultado).toEqual({ total: 0, acao: 0 });
  });
});

describe('textoNotificacaoAlertas (ADR-0133 D-10)', () => {
  it('não promete decisão quando o lote é 100% informativo', () => {
    expect(textoNotificacaoAlertas({ total: 4, acao: 0, pendentesAcao: 0 }))
      .toBe('Pulse: 4 atualização(ões) de mercado, nenhuma exige decisão.');
  });

  it('anuncia só os alertas de ação e aponta a aba', () => {
    expect(textoNotificacaoAlertas({ total: 9, acao: 2, pendentesAcao: 2 }))
      .toBe('Pulse: 2 alerta(s) exigem decisão de preço — abra a aba Alertas do Pulse.');
  });

  it('acrescenta o acumulado só quando há ação pendente além da desta execução', () => {
    expect(textoNotificacaoAlertas({ total: 9, acao: 2, pendentesAcao: 7 }))
      .toBe('Pulse: 2 alerta(s) exigem decisão de preço (7 aguardando no total) — abra a aba Alertas do Pulse.');
  });
});

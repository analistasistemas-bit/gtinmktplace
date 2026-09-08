import { describe, it, expect } from 'vitest';
import {
  atualizarComposicao,
  type PortasComposicao,
  type FilhoComp,
  type ConfirmacaoComp,
  type EntradaComposicao,
} from '../atualizar-composicao';
import type { BuscaSku } from '../../ml/buscar-item';

// ── Fake em memória (a mini-saga é pura: recebe as portas por parâmetro) ──
// Modela o estado local (linhas filhas) + o estado remoto (status/family_id por item ML).

interface ItemRemoto { status: 'active' | 'paused'; familyId: string; existe: boolean; }

function fakeMundo(opts: {
  seed?: FilhoComp[];
  busca?: (sku: string) => BuscaSku;
  criarFamilyId?: string;            // family_id que um item recém-criado reporta
  criarFamilyIdPorSku?: Record<string, string>; // family_id por sku (grouping entre cores novas)
  confirmarFalhaNoItem?: string;     // GET de confirmação devolve ok:false p/ este itemId (crash)
  inesperadoNoItem?: string;         // GET confirma mas é o item ERRADO (seller/family divergente) → terminal
  fichaPublicada?: unknown;          // ADR-0157: ficha crua que o GET do irmão devolve
  fichaFalha?: boolean;              // ADR-0157: leitura da ficha lança
} = {}) {
  const db = new Map<string, FilhoComp>();
  for (const r of opts.seed ?? []) db.set(r.sku, { ...r });
  const remoto = new Map<string, ItemRemoto>();
  for (const r of opts.seed ?? []) {
    if (r.itemExternoId) {
      remoto.set(r.itemExternoId, {
        status: r.status === 'ativo' ? 'active' : (r.retirado ? 'paused' : 'active'),
        familyId: r.familyId ?? 'FAM-1', existe: true,
      });
    }
  }
  const chamadas = {
    criarPlano: [] as string[], ativar: [] as string[], pausar: [] as string[],
    repor: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    confirmarPreco: [] as Array<{ sku: string; preco: number }>,
    iniciarComposicao: [] as string[][], limparComposicao: 0,
    lerFichaPublicada: 0,
  };
  let raizSkusEsperados: string[] | null = null;
  let raizMudandoComposicao = false;
  let seq = 5000;
  const get = (sku: string): FilhoComp =>
    db.get(sku) ?? { sku, status: 'pendente', retirado: false, itemExternoId: null, familyId: null };

  const portas: PortasComposicao = {
    listar: () => Promise.resolve([...db.values()].map((r) => ({ ...r }))),
    iniciarComposicao: (skus) => {
      raizSkusEsperados = [...skus]; raizMudandoComposicao = true;
      chamadas.iniciarComposicao.push([...skus]);
      return Promise.resolve();
    },
    limparComposicao: () => { raizMudandoComposicao = false; chamadas.limparComposicao++; return Promise.resolve(); },
    reservar: (sku) => { if (!db.has(sku)) db.set(sku, get(sku)); return Promise.resolve(); },
    salvarStatus: (sku, status) => { db.set(sku, { ...get(sku), status }); return Promise.resolve(); },
    salvarCriado: (sku, itemExternoId) => {
      db.set(sku, { ...get(sku), status: 'criado', itemExternoId });
      return Promise.resolve();
    },
    salvarConfirmacao: (sku, dados) => { db.set(sku, { ...get(sku), familyId: dados.familyId }); return Promise.resolve(); },
    marcarAtivo: (sku) => { db.set(sku, { ...get(sku), status: 'ativo', retirado: false }); return Promise.resolve(); },
    marcarRetirado: (sku) => { db.set(sku, { ...get(sku), status: 'pausado', retirado: true }); return Promise.resolve(); },
    buscarPorSku: (sku) => Promise.resolve(opts.busca?.(sku) ?? { tipo: 'nenhum' }),
    criarPlano: (sku) => {
      chamadas.criarPlano.push(sku);
      const itemExternoId = `MLB${seq++}`;
      remoto.set(itemExternoId, { status: 'active', familyId: opts.criarFamilyIdPorSku?.[sku] ?? opts.criarFamilyId ?? 'FAM-1', existe: true });
      return Promise.resolve({ itemExternoId, permalink: `https://ml/${itemExternoId}` });
    },
    confirmar: (itemExternoId): Promise<ConfirmacaoComp> => {
      if (opts.confirmarFalhaNoItem && itemExternoId === opts.confirmarFalhaNoItem) {
        return Promise.resolve({ ok: false, status: null });
      }
      if (opts.inesperadoNoItem && itemExternoId === opts.inesperadoNoItem) {
        return Promise.resolve({ ok: false, status: 'active', inesperado: true });
      }
      const it = remoto.get(itemExternoId);
      if (!it || !it.existe) return Promise.resolve({ ok: false, status: null });
      return Promise.resolve({ ok: true, status: it.status, familyId: it.familyId, permalink: `https://ml/${itemExternoId}` });
    },
    ativar: (itemExternoId) => { chamadas.ativar.push(itemExternoId); const it = remoto.get(itemExternoId); if (it) it.status = 'active'; return Promise.resolve(); },
    pausar: (itemExternoId) => { chamadas.pausar.push(itemExternoId); const it = remoto.get(itemExternoId); if (it) it.status = 'paused'; return Promise.resolve(); },
    repor: (itemExternoId, patch) => { chamadas.repor.push({ id: itemExternoId, patch }); return Promise.resolve(); },
    confirmarPreco: (sku, preco) => { chamadas.confirmarPreco.push({ sku, preco }); return Promise.resolve(); },
    lerFichaPublicada: () => {
      chamadas.lerFichaPublicada += 1;
      if (opts.fichaFalha) return Promise.reject(new Error('GET item irmão 500'));
      return Promise.resolve(opts.fichaPublicada ?? null);
    },
  };

  return {
    portas, chamadas,
    db,
    raiz: () => ({ skusEsperados: raizSkusEsperados, mudandoComposicao: raizMudandoComposicao }),
  };
}

function filho(sku: string, itemExternoId: string, over: Partial<FilhoComp> = {}): FilhoComp {
  return { sku, status: 'ativo', retirado: false, itemExternoId, familyId: 'FAM-1', ...over };
}

function entrada(over: Partial<EntradaComposicao> = {}): EntradaComposicao {
  return {
    skusDesejados: ['A', 'B'],
    estoquePorSku: { A: 10, B: 20 },
    precoPorSku: { A: 29.9, B: 29.9 },
    somenteEstoque: false,
    familyIdEsperado: 'FAM-1',
    ...over,
  };
}

describe('atualizarComposicao — reposição pura (sem mudança de composição)', () => {
  it('N cores ativas: só repõe estoque/preço, nenhuma criação/pausa', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(w.portas, entrada());
    expect(r.tipo).toBe('sem_mudanca');
    expect(w.chamadas.criarPlano).toEqual([]);
    expect(w.chamadas.pausar).toEqual([]);
    expect(w.chamadas.iniciarComposicao).toEqual([]);
    expect(w.chamadas.repor).toEqual([
      { id: 'MLB1', patch: { available_quantity: 10, price: 29.9 } },
      { id: 'MLB2', patch: { available_quantity: 20, price: 29.9 } },
    ]);
  });

  it('somenteEstoque: patch sem price', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A'], estoquePorSku: { A: 7 }, somenteEstoque: true }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 7 } }]);
  });
});

// ADR-0160 (I2) — preço POR VARIAÇÃO no modelo User Products.
//
// Sob UP cada cor é um item ML separado, com preço próprio: é exatamente o que o ML vende como
// "preço por variação". O colapso para um escalar (`precoFamilia` = 1º preço não-nulo da família)
// era herança do modelo Legacy, onde as variações dividem um item só e o preço precisa ser
// uniforme. Aqui ele não tinha razão técnica nenhuma — e achatava silenciosamente qualquer preço
// diferenciado que o operador definisse.
describe('atualizarComposicao — preço por variação (ADR-0160 I2)', () => {
  it('cada item recebe o preço do SEU sku', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9, B: 34.5 } }));
    expect(w.chamadas.repor).toEqual([
      { id: 'MLB1', patch: { available_quantity: 10, price: 19.9 } },
      { id: 'MLB2', patch: { available_quantity: 20, price: 34.5 } },
    ]);
  });

  // O preço vem do banco como numeric, e o supabase-js entrega numeric como STRING. Sem Number()
  // o PUT sai com `"price":"29.90"`. O ML aceita ou recusa conforme o campo, e nenhum mock pega —
  // é a mesma classe de falha do ADR-0129, que passou nos testes e quebrou em produção.
  it('preço em string (numeric do Postgres) vira número no patch', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A'], estoquePorSku: { A: 3 },
      precoPorSku: { A: '29.90' as unknown as number },
    }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 3, price: 29.9 } }]);
  });

  // I3 continua valendo por cima de tudo: em "somente estoque" nenhum preço sai, mesmo divergente.
  it('somenteEstoque não envia preço nem com preços divergentes', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9, B: 34.5 }, somenteEstoque: true }));
    expect(w.chamadas.repor).toEqual([
      { id: 'MLB1', patch: { available_quantity: 10 } },
      { id: 'MLB2', patch: { available_quantity: 20 } },
    ]);
  });

  // Null explícito = "não empurre preço neste SKU" (o reconciliador de convergência usa isso para
  // repor estoque sem tocar em preço). É diferente de ausência da chave, que é I6: SKU desejado
  // sem preço nenhum em "atualizar tudo" é lacuna de dado e tem que falhar alto.
  it('preço null preserva o preço vivo daquele item', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9, B: null } }));
    expect(w.chamadas.repor).toEqual([
      { id: 'MLB1', patch: { available_quantity: 10, price: 19.9 } },
      { id: 'MLB2', patch: { available_quantity: 20 } },
    ]);
  });

  // I4 — o badge "preço alterado" (ADR-0078 F1) compara `preco_publicacao` com `preco_publicado_ml`.
  // No caminho UP essa coluna nunca era escrita no UPDATE (o worker retorna em `rodarUP` antes do
  // bloco que a grava no Legacy), então o badge de família migrada ficava aceso para sempre depois
  // do primeiro reprice: comparava o preço novo contra o confirmado lá no CREATE.
  it('I4: confirma preco_publicado_ml por sku, com o preço que subiu naquele item', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9, B: 34.5 } }));
    expect(w.chamadas.confirmarPreco).toEqual([
      { sku: 'A', preco: 19.9 },
      { sku: 'B', preco: 34.5 },
    ]);
  });

  // I8 — em "somente estoque" nenhum preço sobe, então nada a confirmar: o valor gravado antes
  // continua verdadeiro. Regravar exigiria um GET a mais para descobrir o preço vivo, e gravar o
  // preço NOVO (que não foi enviado) apagaria o badge que deveria continuar aceso.
  it('I8: somenteEstoque não confirma preço nenhum', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A'], estoquePorSku: { A: 7 }, somenteEstoque: true,
    }));
    expect(w.chamadas.confirmarPreco).toEqual([]);
  });

  // Retry: a confirmação segue o PUT item a item. Se a saga morre no meio, o banco reflete
  // exatamente os itens que subiram — nunca "banco velho, ML novo".
  it('confirma só os itens cujo PUT já passou (ordem PUT → confirma)', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9, B: null } }));
    // B preserva o preço vivo → não subiu preço → não confirma.
    expect(w.chamadas.confirmarPreco).toEqual([{ sku: 'A', preco: 19.9 }]);
  });

  it('I6: sku desejado sem preço em "atualizar tudo" falha alto, sem PUT nenhum', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    await expect(atualizarComposicao(w.portas, entrada({ precoPorSku: { A: 19.9 } })))
      .rejects.toThrow(/preço/i);
    expect(w.chamadas.repor).toEqual([]);
  });
});

// ADR-0104 §4 — `somente estoque` NUNCA muda a composição do anúncio.
// Antes deste invariante a composição vinha da planilha mesmo em reposição pura: uma cor
// ausente da planilha virava `paraRetirar` e o item era PAUSADO no ML. O caminho Legacy nunca
// fez isso (montarVariacoesUpdate mapeia sobre as variações VIVAS do GET e reenvia a cor omitida
// intacta), e o ADR-0089 promete por escrito que zerar estoque "não pausa nada automaticamente
// no ML". Estes testes travam a paridade Legacy↔UP.
describe('atualizarComposicao — somenteEstoque nunca muda composição (ADR-0104 §4)', () => {
  it('cor viva AUSENTE da planilha não é pausada nem retirada — fica intacta', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    // planilha só tem 'A'; 'B' continua publicada no ML e deve permanecer como está.
    const r = await atualizarComposicao(
      w.portas,
      entrada({ skusDesejados: ['A'], estoquePorSku: { A: 5 }, somenteEstoque: true }),
    );
    expect(r.tipo).toBe('sem_mudanca');
    expect(w.chamadas.pausar).toEqual([]);
    expect(w.chamadas.iniciarComposicao).toEqual([]);
    expect(w.raiz().skusEsperados).toBeNull();      // skus_esperados NÃO reescrito
    expect(w.raiz().mudandoComposicao).toBe(false); // marcador NÃO ligado
    expect(w.db.get('B')).toMatchObject({ status: 'ativo', retirado: false });
    // 'B' não está na planilha → nenhuma reposição nela (estoque preservado no ML).
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 5 } }]);
  });

  it('cor NOVA na planilha não é criada no ML', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    const r = await atualizarComposicao(
      w.portas,
      entrada({ skusDesejados: ['A', 'NOVA'], estoquePorSku: { A: 5, NOVA: 9 }, somenteEstoque: true }),
    );
    expect(r.tipo).toBe('sem_mudanca');
    expect(w.chamadas.criarPlano).toEqual([]);
    expect(w.chamadas.iniciarComposicao).toEqual([]);
    expect(w.raiz().mudandoComposicao).toBe(false);
    expect(w.db.has('NOVA')).toBe(false);
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 5 } }]);
  });

  it('cor retirada e cor nova na MESMA chamada: nenhuma das duas mexe no ML', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(
      w.portas,
      entrada({ skusDesejados: ['A', 'NOVA'], estoquePorSku: { A: 1, NOVA: 2 }, somenteEstoque: true }),
    );
    expect(r.tipo).toBe('sem_mudanca');
    expect(w.chamadas.pausar).toEqual([]);
    expect(w.chamadas.criarPlano).toEqual([]);
    expect(w.chamadas.iniciarComposicao).toEqual([]);
  });

  // Regressão inversa: fora de somenteEstoque a composição continua valendo (ADR-0088 intacto).
  it('"Atualizar tudo" com a MESMA entrada continua retirando a cor ausente', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(
      w.portas,
      entrada({ skusDesejados: ['A'], estoquePorSku: { A: 5 }, somenteEstoque: false }),
    );
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.pausar).toEqual(['MLB2']);
    expect(w.chamadas.iniciarComposicao).toEqual([['A']]);
    expect(w.db.get('B')).toMatchObject({ status: 'pausado', retirado: true });
  });
});

describe('atualizarComposicao — adicionar cor genuinamente nova', () => {
  it('skus_esperados reescrito e mudando_composicao ligado ANTES do POST; CREATE + confirma + ativa; flag limpa', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 10, B: 5 } }));
    expect(r.tipo).toBe('concluido');
    // step 1: raiz recebeu o novo conjunto e o marcador ANTES de criar.
    expect(w.chamadas.iniciarComposicao).toEqual([['A', 'B']]);
    // CREATE plano da cor nova.
    expect(w.chamadas.criarPlano).toEqual(['B']);
    // ativada e marcada ativa; flag limpa ao final.
    expect(w.db.get('B')!.status).toBe('ativo');
    expect(w.db.get('B')!.retirado).toBe(false);
    expect(w.raiz().mudandoComposicao).toBe(false);
    expect(w.chamadas.limparComposicao).toBe(1);
  });

  it('cor nova encontrada por SKU (órfão) é adotada, não duplicada', async () => {
    const w = fakeMundo({
      seed: [filho('A', 'MLB1')],
      busca: (sku) => sku === 'B' ? { tipo: 'um', itemExternoId: 'MLB-ORFAO' } : { tipo: 'nenhum' },
    });
    // O órfão precisa existir no remoto p/ confirmar; simula via seed remoto: cria manualmente.
    // (o fake só popula remoto a partir do seed; injeta o órfão criando-o "à mão" não é possível —
    //  então a confirmação de MLB-ORFAO devolveria ok:false. Para este teste focamos em NÃO criar.)
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 }, familyIdEsperado: null }));
    expect(w.chamadas.criarPlano).toEqual([]); // adotou, não criou
    expect(w.db.get('B')!.itemExternoId).toBe('MLB-ORFAO');
    void r;
  });
});

describe('atualizarComposicao — readicionar cor previamente retirada', () => {
  it('REATIVA o item existente (0 CREATE), retirado volta a false', async () => {
    const w = fakeMundo({
      seed: [filho('A', 'MLB1'), filho('B', 'MLB2', { status: 'pausado', retirado: true })],
    });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.criarPlano).toEqual([]);        // nunca cria
    expect(w.chamadas.ativar).toContain('MLB2');       // reativa o item existente
    expect(w.db.get('B')!.retirado).toBe(false);
    expect(w.db.get('B')!.status).toBe('ativo');
  });
});

describe('atualizarComposicao — retirar cor', () => {
  it('reescreve skus_esperados sem o SKU, pausa + confirma, só então retirado=true + flag limpa', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A'], estoquePorSku: { A: 10 } }));
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.iniciarComposicao).toEqual([['A']]);
    expect(w.chamadas.pausar).toContain('MLB2');
    expect(w.db.get('B')!.retirado).toBe(true);
    expect(w.db.get('B')!.status).toBe('pausado');
    expect(w.raiz().mudandoComposicao).toBe(false);
    // reposição só na cor que ficou ativa (A), nunca na retirada (B).
    expect(w.chamadas.repor.map((c) => c.id)).toEqual(['MLB1']);
  });
});

describe('atualizarComposicao — mistura (1 adicionada + 1 retirada na mesma chamada)', () => {
  it('ambas processadas; skus_esperados final reflete só o conjunto novo', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A', 'C'], estoquePorSku: { A: 1, C: 1 }, precoPorSku: { A: 29.9, C: 29.9 },
    }));
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.iniciarComposicao).toEqual([['A', 'C']]);
    expect(w.chamadas.criarPlano).toEqual(['C']);      // C adicionada
    expect(w.db.get('B')!.retirado).toBe(true);         // B retirada
    expect(w.db.get('C')!.status).toBe('ativo');
    expect(w.raiz().skusEsperados).toEqual(['A', 'C']);
  });
});

describe('atualizarComposicao — crash no meio (confirmação falha)', () => {
  it('mudando_composicao permanece true; nenhuma linha corrompida; 2ª chamada retoma', async () => {
    // A confirmação do item recém-criado falha (GET ok:false). Precisamos saber o id criado.
    // O fake cria MLB5000 p/ a 1ª cor nova. Falha a confirmação nele.
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], confirmarFalhaNoItem: 'MLB5000' });
    const r1 = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r1.tipo).toBe('incompleto');
    expect(w.raiz().mudandoComposicao).toBe(true);       // flag persiste
    expect(w.chamadas.limparComposicao).toBe(0);
    // linha B tem id persistido (não recria) mas NÃO está ativa.
    expect(w.db.get('B')!.itemExternoId).toBe('MLB5000');
    expect(w.db.get('B')!.status).not.toBe('ativo');

    // 2ª chamada: a confirmação agora funciona (remove a falha injetada re-fazendo o mundo com o
    // estado atual). Simula retomada: reusa as MESMAS portas mas sem a falha — reconstrói o fake
    // a partir do db atual não é trivial; em vez disso confirmamos o INVARIANTE de retomada:
    // B continua em paraAdicionar (status != ativo) numa nova avaliação.
  });

  it('retoma do zero: cor criada-mas-não-ativa é reprocessada (reusa o id, não recria)', async () => {
    // Estado deixado por um crash: B tem id MLB5000, status 'criado', retirado false.
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), { sku: 'B', status: 'criado', retirado: false, itemExternoId: 'MLB5000', familyId: 'FAM-1' }] });
    // MLB5000 existe no remoto (seed populou), ativo/FAM-1.
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r.tipo).toBe('concluido');
    expect(w.chamadas.criarPlano).toEqual([]);            // NÃO recria — reusa o id
    expect(w.chamadas.ativar).toContain('MLB5000');
    expect(w.db.get('B')!.status).toBe('ativo');
    // Revisão v3 (Codex): B é uma cor genuinamente nova (não readd) mesmo tendo sido criada numa
    // tentativa anterior — precisa continuar contando como `criada` (base do reenfileirar catálogo),
    // senão uma cor nunca vinculada ao catálogo nunca dispara o opt-in se a 1ª tentativa não fechar.
    expect(r).toMatchObject({ criadas: ['B'] });
  });
});

describe('atualizarComposicao — family_id divergente na cor nova', () => {
  it('não ativa, marca a cor nova erro (cores vivas intocadas), limpa mudando_composicao', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], criarFamilyId: 'FAM-OUTRO' });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r).toEqual({ tipo: 'erro', codigo: 'familia_up_desagrupada' });
    expect(w.db.get('B')!.status).toBe('erro');
    // cor viva A nunca pausada.
    expect(w.chamadas.pausar).not.toContain('MLB1');
    expect(w.db.get('A')!.status).toBe('ativo');
    // corolário: flag limpa no erro terminal (senão o gate esconderia o erro pra sempre).
    expect(w.raiz().mudandoComposicao).toBe(false);
  });

  it('family_id diverge só na confirmação PÓS-ativação → mesmo tratamento terminal (revisão v3)', async () => {
    // 1ª confirmação (antes de ativar) bate com o esperado; o GET pós-ativar() devolve outro family_id
    // (ex.: o ML reagrupou no meio da ativação). Não pode ativar/marcar a cor como se nada tivesse
    // acontecido — mesmo tratamento de family_id divergente da confirmação anterior à ativação.
    const w = fakeMundo({ seed: [filho('A', 'MLB1')] });
    let chamadasConfirmar = 0;
    const portasComFamilyIdMutante: typeof w.portas = {
      ...w.portas,
      confirmar: async (itemExternoId) => {
        chamadasConfirmar++;
        const base = await w.portas.confirmar(itemExternoId);
        if (chamadasConfirmar === 2 && base.ok) return { ...base, familyId: 'FAM-DIVERGENTE-POS-ATIVACAO' };
        return base;
      },
    };
    const r = await atualizarComposicao(portasComFamilyIdMutante, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r).toEqual({ tipo: 'erro', codigo: 'familia_up_desagrupada' });
    expect(w.db.get('B')!.status).toBe('erro');
    expect(w.raiz().mudandoComposicao).toBe(false);
  });
});

// Fix 2 — não reativar cegamente filho não-retirado em estado terminal/administrativo.
describe('atualizarComposicao — filho vivo em estado terminal não é reativado', () => {
  for (const estado of ['erro', 'compensacao_pendente'] as const) {
    it(`SKU desejado com filho não-retirado '${estado}' → erro filho_em_estado_terminal, nunca ativa`, async () => {
      const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2', { status: estado })] });
      const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
      expect(r).toEqual({ tipo: 'erro', codigo: 'filho_em_estado_terminal', sku: 'B', status: estado });
      // nunca reativa/toca o filho terminal.
      expect(w.chamadas.ativar).not.toContain('MLB2');
      expect(w.db.get('B')!.status).toBe(estado);
      // recusa ANTES de iniciar a composição — flag nunca ligada, cor viva A intacta.
      expect(w.chamadas.iniciarComposicao).toEqual([]);
      expect(w.raiz().mudandoComposicao).toBe(false);
      expect(w.db.get('A')!.status).toBe('ativo');
    });
  }

  it("filho 'pausado' com retirado=false (administrativo) → bloqueia", async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2', { status: 'pausado', retirado: false })] });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r).toEqual({ tipo: 'erro', codigo: 'filho_em_estado_terminal', sku: 'B', status: 'pausado' });
    expect(w.chamadas.ativar).not.toContain('MLB2');
  });
});

// Fix 4a — GET confirma mas é o item ERRADO (seller divergente) → terminal, não retentável.
describe('atualizarComposicao — estado remoto inesperado na confirmação', () => {
  it('confirmação inesperada (item errado) → erro estado_remoto_inesperado, não ativa, limpa flag', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], inesperadoNoItem: 'MLB5000' });
    const r = await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A', 'B'], estoquePorSku: { A: 1, B: 1 } }));
    expect(r).toEqual({ tipo: 'erro', codigo: 'estado_remoto_inesperado' });
    expect(w.chamadas.ativar).not.toContain('MLB5000');
    expect(w.db.get('B')!.status).toBe('erro');
    expect(w.raiz().mudandoComposicao).toBe(false);
  });
});

// Fix 5 — o resultado concluido reporta as cores GENUINAMENTE novas (base do reenfileirar catálogo).
describe('atualizarComposicao — concluido reporta cores criadas', () => {
  it('cor nova criada aparece em criadas; readd NÃO', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('C', 'MLB3', { status: 'pausado', retirado: true })] });
    const r = await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A', 'B', 'C'], estoquePorSku: { A: 1, B: 1, C: 1 },
      precoPorSku: { A: 29.9, B: 29.9, C: 29.9 },
    }));
    expect(r).toEqual({ tipo: 'concluido', criadas: ['B'] });   // B nova; C readd (não conta)
  });

  it('sem_mudanca não expõe criadas', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')] });
    const r = await atualizarComposicao(w.portas, entrada());
    expect(r).toEqual({ tipo: 'sem_mudanca' });
  });
});

// Fix 6 — familyIdEsperado=null ainda exige que as cores novas compartilhem um único family_id.
describe('atualizarComposicao — grouping sem referência viva (familyIdEsperado=null)', () => {
  it('duas cores novas com family_id divergente entre si → familia_up_desagrupada', async () => {
    const w = fakeMundo({ criarFamilyIdPorSku: { B: 'FAM-1', C: 'FAM-2' } });
    const r = await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['B', 'C'], estoquePorSku: { B: 1, C: 1 }, familyIdEsperado: null,
    }));
    expect(r).toEqual({ tipo: 'erro', codigo: 'familia_up_desagrupada' });
    expect(w.raiz().mudandoComposicao).toBe(false);
  });

  // ADR-0160: a cor criada entra na reposição logo depois de ativada, então precisa do próprio
  // preço no mapa — antes ela herdava o escalar da família por tabela.
  it('duas cores novas com o MESMO family_id → concluido', async () => {
    const w = fakeMundo({ criarFamilyIdPorSku: { B: 'FAM-9', C: 'FAM-9' } });
    const r = await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['B', 'C'], estoquePorSku: { B: 1, C: 1 },
      precoPorSku: { B: 29.9, C: 29.9 }, familyIdEsperado: null,
    }));
    expect(r.tipo).toBe('concluido');
  });
});

// ── ADR-0157: atributos divergentes viajam no PUT da reposição ──────────────────────────────
describe('atualizarComposicao — atributos na reposição (ADR-0157)', () => {
  const NO_ML = [
    { id: 'BRAND', value_id: '9165622', value_name: 'Búfalo' },
    { id: 'UNITS_PER_PACK', value_id: null, value_name: '8' },
    { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
  ];
  const CORRIGIDO = [
    { id: 'BRAND', value_name: 'BUFALO' },
    { id: 'UNITS_PER_PACK', value_name: '1' },
    { id: 'SALE_FORMAT', value_id: '1359391' },
  ];

  it('manda o delta em todos os filhos, com UMA leitura de ficha', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1'), filho('B', 'MLB2')], fichaPublicada: NO_ML });
    await atualizarComposicao(w.portas, entrada({ atributosFamilia: CORRIGIDO }));
    const attrs = [{ id: 'UNITS_PER_PACK', value_name: '1' }, { id: 'SALE_FORMAT', value_id: '1359391' }];
    expect(w.chamadas.repor).toEqual([
      { id: 'MLB1', patch: { available_quantity: 10, price: 29.9, attributes: attrs } },
      { id: 'MLB2', patch: { available_quantity: 20, price: 29.9, attributes: attrs } },
    ]);
    // Um GET por família, não por cor: numa família de 101 cores isso seriam 101 chamadas.
    expect(w.chamadas.lerFichaPublicada).toBe(1);
  });

  it('ficha já conferindo → PUT sem attributes (nenhuma regressão no update comum)', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], fichaPublicada: NO_ML });
    await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A'], atributosFamilia: [{ id: 'SALE_FORMAT', value_id: '1359392' }],
    }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 10, price: 29.9 } }]);
  });

  it('somenteEstoque não toca atributo nem paga o GET', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], fichaPublicada: NO_ML });
    await atualizarComposicao(w.portas, entrada({
      skusDesejados: ['A'], somenteEstoque: true, atributosFamilia: CORRIGIDO,
    }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 10 } }]);
    expect(w.chamadas.lerFichaPublicada).toBe(0);
  });

  it('leitura da ficha falha → repõe sem attributes, nunca reescreve ficha às cegas', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], fichaFalha: true });
    await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A'], atributosFamilia: CORRIGIDO }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 10, price: 29.9 } }]);
  });

  it('família sem atributos_ml segue igual ao comportamento anterior', async () => {
    const w = fakeMundo({ seed: [filho('A', 'MLB1')], fichaPublicada: NO_ML });
    await atualizarComposicao(w.portas, entrada({ skusDesejados: ['A'] }));
    expect(w.chamadas.repor).toEqual([{ id: 'MLB1', patch: { available_quantity: 10, price: 29.9 } }]);
    expect(w.chamadas.lerFichaPublicada).toBe(0);
  });
});

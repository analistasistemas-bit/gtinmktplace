import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  depsBanco, executarReposicao, parceirosDe, planejarReposicao,
  type DepsReposicao, type FotoKit, type KitFoto, type SkuFoto,
} from '../reposicao.ts';

// Preto/Branco/Azul no M. Kit K1 = PB e PA; meta 3. Componente: 1 peça de cada cor por kit.
const sku = (codigo: string, saldo: number, estado: SkuFoto['estado'] = 'guardado', extra: Partial<SkuFoto> = {}): SkuFoto =>
  ({ codigo, saldo, estado, versao: 1, pendente: false, ...extra });
const combo = (codigo: string, saldo: number, cores: string[], extra: Partial<KitFoto['skus'][number]> = {}) =>
  ({ codigo, saldo, publicado: true, pendente: false, componentes: cores.map((c) => ({ codigo: c, quantidade: 1 })), ...extra });
const kit = (id: string, skus: KitFoto['skus'], extra: Partial<KitFoto> = {}): KitFoto =>
  ({ id, meta: 3, reposicaoAuto: true, soEmKit: true, skus, ...extra });
const foto = (kits: KitFoto[], skus: SkuFoto[], pausas: FotoKit['pausas'] = [], avisos: FotoKit['avisos'] = []): FotoKit =>
  ({ kits, skus, pausas, avisos });

describe('planejarReposicao', () => {
  it('meta 3 com saldo 2 move 1', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 2, ['P', 'B'])])], [sku('P', 5), sku('B', 5)]));
    expect(p).toEqual({ moves: [{ kitId: 'K1', codigo: 'KPB', quantidade: 1 }], sobras: [], voltarGuardado: [] });
  });

  it('move até a meta, limitado pela peça mais escassa', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 2), sku('B', 9)]));
    expect(p.moves).toEqual([{ kitId: 'K1', codigo: 'KPB', quantidade: 2 }]);
  });

  it('kit na meta ou acima não move', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 3, ['P', 'B']), combo('KPA', 4, ['P', 'A'])])],
      [sku('P', 5), sku('B', 5), sku('A', 5)]));
    expect(p.moves).toEqual([]);
  });

  it('disputa: maior falta primeiro, depois código; distribui um a um', () => {
    // P só tem 3: KPA (falta 3) e KPB (falta 2) disputam.
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 1, ['P', 'B']), combo('KPA', 0, ['P', 'A'])])],
      [sku('P', 3), sku('B', 5), sku('A', 5)]));
    // KPA 3→ falta 2 empata com KPB; empate por código: KPA antes de KPB. Depois KPB (falta 2) > KPA (1).
    expect(p.moves).toEqual([{ kitId: 'K1', codigo: 'KPA', quantidade: 2 }, { kitId: 'K1', codigo: 'KPB', quantidade: 1 }]);
  });

  it('determinística: a ordem da entrada não muda o plano', () => {
    const a = foto([kit('K1', [combo('KPB', 1, ['P', 'B']), combo('KPA', 0, ['P', 'A'])])], [sku('P', 3), sku('B', 5), sku('A', 5)]);
    const b = foto([kit('K1', [combo('KPA', 0, ['P', 'A']), combo('KPB', 1, ['P', 'B'])])], [sku('A', 5), sku('B', 5), sku('P', 3)]);
    expect(planejarReposicao(b)).toEqual(planejarReposicao(a));
  });

  it('só peça Guardada sem transferência pendente é usada; Sobra e Normal não', () => {
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 5), sku('B', 5, 'sobra')])).moves).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 5), sku('B', 5, 'normal')])).moves).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])],
      [sku('P', 5), sku('B', 5, 'guardado', { pendente: true })])).moves).toEqual([]);
  });

  it('não move para SKU de kit pendente, não publicado, nem kit sem reposição automática', () => {
    const skus = [sku('P', 5), sku('B', 5)];
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'], { pendente: true })])], skus)).moves).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'], { publicado: false })])], skus)).moves).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { reposicaoAuto: false })], skus)).moves).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { soEmKit: false })], skus)).moves).toEqual([]);
  });

  it('componente com 2 peças por kit consome em dobro', () => {
    const k = kit('K1', [{ codigo: 'KPP', saldo: 0, publicado: true, pendente: false, componentes: [{ codigo: 'P', quantidade: 2 }, { codigo: 'B', quantidade: 1 }] }]);
    expect(planejarReposicao(foto([k], [sku('P', 5), sku('B', 5)])).moves).toEqual([{ kitId: 'K1', codigo: 'KPP', quantidade: 2 }]);
  });

  it('falta de parceiro vira sobra (a peça que sobrou, não a zerada)', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2)]));
    expect(p).toEqual({ moves: [], sobras: ['B'], voltarGuardado: [] });
  });

  it('não vira sobra com transferência pendente, nem com parceiro pendente', () => {
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])],
      [sku('P', 0), sku('B', 2, 'guardado', { pendente: true })])).sobras).toEqual([]);
    expect(planejarReposicao(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])],
      [sku('P', 0, 'guardado', { pendente: true }), sku('B', 2)])).sobras).toEqual([]);
  });

  it('cor em Sobra conta como disponível: o parceiro guardado não vira sobra', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 2), sku('B', 2, 'sobra')]));
    expect(p.sobras).toEqual([]);
    expect(p.voltarGuardado).toEqual(['B']);
  });

  it('peça de kit na meta não é sobra: forma combinação, só não precisa', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 3, ['P', 'B'])])], [sku('P', 1), sku('B', 2)]));
    expect(p.sobras).toEqual([]);
  });

  it('combinação não publicada não conta para formar', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'], { publicado: false })])], [sku('P', 2), sku('B', 2)]));
    expect(p.sobras).toEqual(['B', 'P']);
  });

  it('entrada do parceiro: a Sobra volta a Guardado antes de montar (nada move nesta rodada)', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 2), sku('B', 2, 'sobra')]));
    expect(p.moves).toEqual([]);
    expect(p.voltarGuardado).toEqual(['B']);
    // Rodada seguinte, com a pausa confirmada (sem pendência): monta.
    const depois = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 2), sku('B', 2)]));
    expect(depois.moves).toEqual([{ kitId: 'K1', codigo: 'KPB', quantidade: 2 }]);
  });

  it('Sobra não volta enquanto o parceiro está pendente, sem peça ou consumido por um move desta rodada', () => {
    const k = kit('K1', [combo('KPB', 0, ['P', 'B'])]);
    expect(planejarReposicao(foto([k], [sku('P', 2, 'guardado', { pendente: true }), sku('B', 2, 'sobra')])).voltarGuardado).toEqual([]);
    expect(planejarReposicao(foto([k], [sku('P', 0), sku('B', 2, 'sobra')])).voltarGuardado).toEqual([]);
    // P vai para KPA (move), então B não volta agora.
    const k2 = kit('K1', [combo('KPB', 0, ['P', 'B']), combo('KPA', 0, ['P', 'A'])]);
    const p = planejarReposicao(foto([k2], [sku('P', 1), sku('A', 1), sku('B', 2, 'sobra')]));
    expect(p.moves).toEqual([{ kitId: 'K1', codigo: 'KPA', quantidade: 1 }]);
    expect(p.voltarGuardado).toEqual([]);
  });

  it('parceiro consumido no meio: o SKU devolvido a Guardado vira Sobra de novo, não fica preso', () => {
    // B voltou a Guardado, mas a conciliação da pausa baixou o último P.
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 0), sku('B', 2)]));
    expect(p.sobras).toEqual(['B']);
    expect(p.moves).toEqual([]);
  });

  it('duas Sobras que juntas formam combinação voltam juntas', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 1, 'sobra'), sku('B', 1, 'sobra')]));
    expect(p.voltarGuardado).toEqual(['B', 'P']);
  });

  it('dois kits: a peça que forma combinação no outro kit não vira sobra', () => {
    const p = planejarReposicao(foto(
      [kit('K1', [combo('KPB', 0, ['P', 'B'])]), kit('K2', [combo('KBA', 3, ['B', 'A'])])],
      [sku('P', 0), sku('B', 2), sku('A', 1)],
    ));
    expect(p.sobras).toEqual([]);
  });

  it('kit fora de "só em kit" não conta para formar', () => {
    const p = planejarReposicao(foto(
      [kit('K1', [combo('KPB', 0, ['P', 'B'])]), kit('K2', [combo('KBA', 0, ['B', 'A'])], { soEmKit: false })],
      [sku('P', 0), sku('B', 2), sku('A', 1, 'normal')],
    ));
    expect(p.sobras).toEqual(['B']);
  });

  it('SKU Normal nunca vira sobra nem volta', () => {
    const p = planejarReposicao(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 0, 'normal'), sku('B', 2, 'normal')]));
    expect(p).toEqual({ moves: [], sobras: [], voltarGuardado: [] });
  });

  it('parceirosDe: componentes das combinações formáveis, sem os próprios códigos', () => {
    const f = foto([kit('K1', [combo('KPB', 0, ['P', 'B']), combo('KBA', 0, ['B', 'A'])])], [sku('P', 2), sku('B', 2, 'sobra'), sku('A', 0)]);
    expect(parceirosDe(f, ['B'])).toEqual(['P']);
  });
});

// Executor: fotografia e RPCs falsas.
function cenario(f: FotoKit) {
  const s = {
    foto: f,
    chamadas: [] as string[],
    avisos: [] as string[],
    sagas: [] as string[],
    recusar: {} as Record<string, string>,
    reativar: {} as Record<string, 'reativado' | 'ja_ativo' | 'inexistente' | 'abandonar' | 'manter'>,
    falhaAvisar: false,
  };
  const deps: DepsReposicao = {
    foto: async () => structuredClone(s.foto),
    async sobra(codigos, versoes) {
      s.chamadas.push(`sobra ${codigos.join(',')} ${JSON.stringify(versoes)}`);
      return s.recusar.sobra ? { ok: false, motivo: s.recusar.sobra } : { ok: true };
    },
    async guardar(codigos, parceiros) {
      s.chamadas.push(`guardar ${codigos.join(',')} parceiros ${parceiros.join(',')}`);
      return s.recusar.guardar ? { ok: false, motivo: s.recusar.guardar } : { ok: true, transferenciaId: 'TG' };
    },
    async repor(kitId, itens) {
      s.chamadas.push(`repor ${kitId} ${itens.map((i) => `${i.codigo}:${i.quantidade}`).join(',')}`);
      return s.recusar.repor ? { ok: false, motivo: s.recusar.repor } : { ok: true, transferenciaId: 'TR' };
    },
    async enfileirarSaga(id) { s.sagas.push(id); },
    async reativar(codigo, itemId) {
      s.chamadas.push(`reativar ${codigo} ${itemId}`);
      return s.reativar[itemId] ?? 'reativado';
    },
    async esquecerPausa(codigo, itemId) { s.chamadas.push(`esquecer ${codigo} ${itemId}`); },
    async avisar(texto) {
      if (s.falhaAvisar) throw new Error('telegram fora');
      s.avisos.push(texto);
    },
    async registrarAviso(codigo, versao, resultado) { s.chamadas.push(`aviso ${codigo} ${versao} ${resultado}`); },
    async concluirAviso(codigo, versao) { s.chamadas.push(`concluir aviso ${codigo} ${versao}`); },
  };
  return { s, deps };
}

describe('executarReposicao', () => {
  it('move pela RPC de reposição e enfileira a saga', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 2, ['P', 'B'])])], [sku('P', 5), sku('B', 5)]));
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['repor K1 KPB:1']);
    expect(c.s.sagas).toEqual(['TR']);
    expect(r.retentar).toBe(false);
  });

  it('virar Sobra: transição versionada, avisa no Telegram e reativa só a pausa da automação', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual([
      'sobra B {"B":4,"P":1}', 'reativar B MLB-B', 'esquecer B MLB-B', 'aviso B 5 reativado', 'concluir aviso B 5',
    ]);
    expect(c.s.avisos).toHaveLength(1);
    expect(c.s.avisos[0]).toContain('B');
    expect(c.s.avisos[0]).toContain('foi reativado');
  });

  it('Fix 1 (P2): aviso de Sobra só depois da reativação confirmada; incerta não avisa e repete', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.reativar = { 'MLB-B': 'manter' };
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['sobra B {"B":4,"P":1}', 'reativar B MLB-B']);
    expect(c.s.avisos).toEqual([]);
    expect(r.retentar).toBe(true);
  });

  it('Fix 1 (P2): aviso pendente é retomado com o SKU já em Sobra, sem afirmar reativação que não houve', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'sobra', { versao: 5 })], [],
      [{ codigo: 'B', versao: 5, resultado: null }]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['aviso B 5 sem_pausa', 'concluir aviso B 5']);
    expect(c.s.avisos[0]).not.toContain('foi reativado');
  });

  it('Fix 1 (P2): resultado gravado antes do envio; falha no envio mantém a pendência com ele', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.falhaAvisar = true;
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['sobra B {"B":4,"P":1}', 'reativar B MLB-B', 'esquecer B MLB-B', 'aviso B 5 reativado']);
    expect(r.retentar).toBe(true);
    // Retomada: usa o resultado gravado, não o "sem pausa" de agora.
    const d = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'sobra', { versao: 5 })], [],
      [{ codigo: 'B', versao: 5, resultado: 'reativado' }]));
    await executarReposicao(d.deps, 'K1');
    expect(d.s.chamadas).toEqual(['concluir aviso B 5']);
    expect(d.s.avisos[0]).toContain('foi reativado');
  });

  it('Fix 1 (P2): pausa do operador ou moderação: o aviso diz que o individual segue pausado', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.reativar = { 'MLB-B': 'abandonar' };
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toContain('aviso B 5 pausado');
    expect(c.s.avisos[0]).toContain('segue pausado');
  });

  it('Fix 1b: item com pausa registrada que sumiu do ML encerra o registro e o aviso diz que o anúncio não existe mais', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.reativar = { 'MLB-B': 'inexistente' };
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual([
      'sobra B {"B":4,"P":1}', 'reativar B MLB-B', 'esquecer B MLB-B', 'aviso B 5 inexistente', 'concluir aviso B 5',
    ]);
    expect(c.s.avisos[0]).toContain('não existe mais');
    expect(r.retentar).toBe(false);
  });

  it('Fix 1b: item já ativo (reativado por alguém): registro sai sem PUT e o aviso não se atribui a reativação', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2, 'guardado', { versao: 4 })],
      [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.reativar = { 'MLB-B': 'ja_ativo' };
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toContain('esquecer B MLB-B');
    expect(c.s.chamadas).toContain('aviso B 5 ativo');
    expect(c.s.avisos[0]).not.toContain('foi reativado');
  });

  it('Fix 1b: operador reativou (registro apagado) e pausou fora do app: a rodada seguinte não reativa', async () => {
    // O registro saiu na reativação do operador (politica.test); sem registro, nada a desfazer.
    const c = cenario(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { soEmKit: false })],
      [sku('P', 2, 'normal'), sku('B', 2, 'normal')], []));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual([]);
  });

  it('Fix 1 (P2-2): ligar → pausa → desligar → saga abortada registra a pausa → a rodada reativa', async () => {
    // A saga abortada (saga.test) entrega MLB-P a kit_pausas_automaticas; com P de volta a Normal, a rodada desfaz.
    const c = cenario(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { soEmKit: false })],
      [sku('P', 2, 'normal'), sku('B', 2, 'normal')], [{ codigo: 'P', itemId: 'MLB-P' }]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['reativar P MLB-P', 'esquecer P MLB-P']);
  });

  it('decisão velha é rejeitada por versão: nada é reativado e a rodada repete', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 1, ['P', 'B'])])], [sku('P', 0), sku('B', 2)], [{ codigo: 'B', itemId: 'MLB-B' }]));
    c.s.recusar.sobra = 'versao';
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['sobra B {"B":1,"P":1}']);
    expect(c.s.avisos).toEqual([]);
    expect(r.retentar).toBe(true);
  });

  it('entrada do parceiro: reserva os parceiros e devolve a Guardado antes de montar', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])])], [sku('P', 2), sku('B', 2, 'sobra')]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['guardar B parceiros P']);
    expect(c.s.sagas).toEqual(['TG']);
  });

  it('desligar: SKU de volta a Normal tem só a pausa da automação desfeita; pausa manual anterior fica', async () => {
    // P e B voltaram a Normal. A pausa manual de B (antes de ligar) não está em `pausas`: nunca é tocada.
    const c = cenario(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { soEmKit: false })],
      [sku('P', 2, 'normal'), sku('B', 2, 'normal')], [{ codigo: 'P', itemId: 'MLB-P' }]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['reativar P MLB-P', 'esquecer P MLB-P']);
  });

  it('Guardado (outro kit ainda reivindica) não é reativado', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 3, ['P', 'B'])], { soEmKit: false }), kit('K2', [combo('KPA', 3, ['P', 'A'])])],
      [sku('P', 2), sku('B', 2, 'normal'), sku('A', 2)], [{ codigo: 'P', itemId: 'MLB-P' }, { codigo: 'B', itemId: 'MLB-B' }]));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['reativar B MLB-B', 'esquecer B MLB-B']);
  });

  it('reativação abandonada (pausa do operador, moderação) esquece; incerta mantém e repete', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 0, ['P', 'B'])], { soEmKit: false })],
      [sku('P', 2, 'normal'), sku('B', 2, 'normal')], [{ codigo: 'P', itemId: 'MLB-P' }, { codigo: 'B', itemId: 'MLB-B' }]));
    c.s.reativar = { 'MLB-P': 'abandonar', 'MLB-B': 'manter' };
    const r = await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual(['reativar B MLB-B', 'reativar P MLB-P', 'esquecer P MLB-P']);
    expect(r.retentar).toBe(true);
  });

  it('só age no kit do job: move e sobra de outro kit ficam para o job dele', async () => {
    const c = cenario(foto(
      [kit('K1', [combo('KPB', 3, ['P', 'B'])]), kit('K2', [combo('KAV', 0, ['A', 'V'])])],
      [sku('P', 1), sku('B', 1), sku('A', 5), sku('V', 5)],
    ));
    await executarReposicao(c.deps, 'K1');
    expect(c.s.chamadas).toEqual([]);
  });

  it('reposição recusada (SKU ocupado, versão) repete', async () => {
    const c = cenario(foto([kit('K1', [combo('KPB', 2, ['P', 'B'])])], [sku('P', 5), sku('B', 5)]));
    c.s.recusar.repor = 'up_ocupado';
    expect((await executarReposicao(c.deps, 'K1')).retentar).toBe(true);
    expect(c.s.sagas).toEqual([]);
  });
});

// Fix 1 (P1-1): adaptador real de `repor`, com banco falso.
function bancoFalso() {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const tabelas: Record<string, Array<Record<string, unknown>>> = {
    kit_variacao_skus: [
      { kit_id: 'K1', codigo: 'KPB', kit_variacao_componentes: [{ codigo: 'P' }, { codigo: 'B' }] },
      { kit_id: 'K1', codigo: 'KPA', kit_variacao_componentes: [{ codigo: 'P' }, { codigo: 'A' }] },
    ],
    anuncios_externos_itens: ['P', 'B', 'A', 'KPB', 'KPA'].map((c) => ({
      org_id: 'O', sku: c, item_externo_id: `MLB-${c}`, user_product_id: `UP-${c}`, catalog_listing_id: null,
    })),
  };
  const from = (t: string) => {
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      not: (c: string) => { filtros.push((r) => r[c] != null); return api; },
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: (tabelas[t] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(res),
    };
    return api;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    return { data: { ok: true, transferencia_id: 'TR' }, error: null };
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, rpcs };
}

describe('depsBanco.repor (Fix 1, P1-1)', () => {
  it('kit PB+PA repondo só PB: alvos só dos SKUs movimentados; a versão de A segue conferida à parte', async () => {
    const b = bancoFalso();
    const r = await depsBanco(b.admin, 'O', 'K1').repor('K1', [{ codigo: 'KPB', quantidade: 1 }], { A: 1, B: 1, P: 1 });
    expect(r).toEqual({ ok: true, transferenciaId: 'TR' });
    const args = b.rpcs[0].args as { p_alvos: Array<{ codigo: string }>; p_versoes: Record<string, number> };
    expect(args.p_alvos.map((a) => a.codigo).sort()).toEqual(['B', 'KPB', 'P']);
    expect(args.p_versoes).toEqual({ A: 1, B: 1, P: 1 });
  });
});

import { describe, it, expect } from 'vitest';
import {
  executarAcao, recuperarPendentes, ESTADOS_ATIVOS, MSG_RECONECTAR, MSG_TRAVA,
  type DepsAcao, type Entrada, type NovaTentativa, type Onde, type Tentativa,
} from '../posvenda-fluxo';
import type { DetalheReclamacao } from '../posvenda';

const ORG = 'org-1';
const OP1 = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';
const OP3 = '33333333-3333-4333-8333-333333333333';

const det = (over: Partial<DetalheReclamacao> = {}): DetalheReclamacao => ({
  claim_id: 10, return_id: 77, stage: 'claim', status: 'opened',
  estado: { titulo: null, descricao: null, problema: null, prazo: null, vez_de: 'vendedor' },
  comprador_quer: 'refund', resolucoes: [], resolucao_final: null, afeta_reputacao: null, custo_devolucao: null,
  historico: [], acoes: ['refund', 'open_dispute', 'return_review_ok', 'return_review_fail', 'send_message_to_complainant'],
  revisoes: [{ order_id: 500, seller_status: 'pending' }], pedidos_devolucao: [500], motivos_falha_revisao: [],
  reembolso_parcial: null, incompleto: [], ...over,
});

/** Espera a execução concorrente chegar a um ponto (macrotarefas, sem relógio real). */
const ate = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0)); };

const adiado = () => {
  let liberar!: () => void;
  const p = new Promise<void>((r) => { liberar = r; });
  return { p, liberar };
};

/** Banco em memória com as MESMAS garantias do Postgres: unique (org, operacao_id), unique parcial
 *  (org, recurso) nos estados ativos e update condicional (0 linhas = null). Devolve cópias. */
function cenario() {
  let relogio = Date.parse('2026-10-28T12:00:00.000Z');
  const linhas = new Map<string, Tentativa>();
  let seq = 0;
  const ml = { detalhe: det(), posts: [] as Array<{ path: string; corpo: unknown }>, leituras: 0, falharLeitura: false };
  const ctl = {
    resposta: { status: 200 as number | null, body: {} as unknown },
    /** Aplicado ao detalhe do ML quando o POST chega (o efeito real). */
    efeito: null as null | ((d: DetalheReclamacao) => DetalheReclamacao),
    gatePost: null as null | Promise<void>,
    gateLeitura: null as null | Promise<void>,
    aoChegarNoPost: null as null | (() => void),
    aoListarAbertas: null as null | (() => Promise<void>),
    falharSync: 0,
    syncs: 0,
    enfileirados: 0,
  };
  const ativa = (t: Tentativa) => ESTADOS_ATIVOS.includes(t.estado);
  const copia = <T>(v: T): T => structuredClone(v);

  const deps: DepsAcao = {
    agora: () => new Date(relogio).toISOString(),
    async porOperacao(op) {
      const t = [...linhas.values()].find((x) => x.operacao_id === op);
      return t ? copia(t) : null;
    },
    async inserir(n: NovaTentativa) {
      if ([...linhas.values()].some((x) => x.operacao_id === n.operacao_id)) return 'conflito_operacao';
      if ([...linhas.values()].some((x) => x.recurso === n.recurso && ativa(x))) return 'conflito_recurso';
      const t: Tentativa = {
        ...n, id: `t${++seq}`, estado: 'reservada', antes: null, post_em: null, http_status: null, resposta_ml: null,
        sync_pendente: false, erro: null, criado_em: new Date(relogio).toISOString(),
      };
      linhas.set(t.id, t);
      return copia(t);
    },
    async ativaDoRecurso(recurso) {
      const t = [...linhas.values()].find((x) => x.recurso === recurso && ativa(x));
      return t ? copia(t) : null;
    },
    async atualizar(id, onde: Onde, set) {
      const t = linhas.get(id);
      if (!t || t.estado !== onde.estado) return null;
      if (onde.postEmNulo && t.post_em != null) return null;
      if (onde.syncPendente && !t.sync_pendente) return null;
      if (onde.criadoAntesDe && !(Date.parse(t.criado_em) < Date.parse(onde.criadoAntesDe))) return null;
      const novo = { ...t, ...copia(set) };
      if (ativa(novo) && [...linhas.values()].some((x) => x.id !== id && x.recurso === novo.recurso && ativa(x))) {
        throw new Error('23505 ml_posvenda_acoes_trava_uniq');
      }
      linhas.set(id, novo);
      return copia(novo);
    },
    async abertas() {
      const r = [...linhas.values()].filter((x) => ativa(x) || x.sync_pendente).map(copia);
      if (ctl.aoListarAbertas) await ctl.aoListarAbertas();
      return r;
    },
    async lerDetalhe() {
      if (ctl.gateLeitura) { const g = ctl.gateLeitura; ctl.gateLeitura = null; await g; }
      ml.leituras++;
      if (ml.falharLeitura) throw new Error('Não foi possível ler a reclamação no Mercado Livre.');
      return copia(ml.detalhe);
    },
    async postML(path, corpo) {
      ml.posts.push({ path, corpo });
      ctl.aoChegarNoPost?.();
      if (ctl.gatePost) await ctl.gatePost;
      if (ctl.efeito && ctl.resposta.status !== 400 && ctl.resposta.status !== 403) ml.detalhe = ctl.efeito(ml.detalhe);
      return copia(ctl.resposta);
    },
    async sincronizar() {
      ctl.syncs++;
      if (ctl.falharSync > 0) { ctl.falharSync--; throw new Error('upsert falhou'); }
      ctl.enfileirados++;
      return { claim_id: 10 };
    },
  };
  const entrada = (operacao_id: string, body: Partial<Entrada['body']> = {}): Entrada => ({
    orgId: ORG, userId: 'clicou', claimId: 10, returnIdLocal: 77,
    body: { operacao_id, claim_id: '10', acao: 'reembolsar', ...body },
  });
  const avancar = (msMais: number) => { relogio += msMais; };
  const linha = (op: string) => [...linhas.values()].find((x) => x.operacao_id === op)!;
  return { deps, ml, ctl, entrada, avancar, linha, linhas };
}

// Reembolso confirmado = resolução refund aceita do vendedor criada depois do POST.
const reembolsou = (agora: string) => (d: DetalheReclamacao): DetalheReclamacao => ({
  ...d, acoes: d.acoes.filter((a) => a !== 'refund'),
  resolucoes: [...d.resolucoes, { papel: 'respondent', tipo: 'refund', status: 'accepted', detalhes: [], criada_em: agora, atualizada_em: agora }],
});

describe('executarAcao — caminho feliz e recusas', () => {
  it('reembolso: 1 POST, confirmada, sync feito, user_id = quem clicou', async () => {
    const c = cenario();
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'confirmada', pendenteConfirmacao: false, sincronizacaoPendente: false, devolucao: { claim_id: 10 } });
    expect(c.ml.posts).toEqual([{ path: '/post-purchase/v1/claims/10/expected-resolutions/refund', corpo: {} }]);
    expect(c.linha(OP1)).toMatchObject({ user_id: 'clicou', recurso: 'claim:10:resolucao', http_status: 200, sync_pendente: false });
    expect(c.linha(OP1).antes?.acoes).toContain('refund');
  });

  it('ação não liberada → cancelada, nenhum POST, trava liberada', async () => {
    const c = cenario();
    c.ml.detalhe = det({ acoes: ['open_dispute'] });
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: false, estado: 'cancelada', http: 409 });
    expect(c.ml.posts).toHaveLength(0);
    c.ml.detalhe = det();
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    expect((await executarAcao(c.deps, c.entrada(OP2))).estado).toBe('confirmada');
  });

  it('leitura falhou → cancelada (502), nenhum POST', async () => {
    const c = cenario();
    c.ml.falharLeitura = true;
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: false, estado: 'cancelada', http: 502 });
    expect(c.ml.posts).toHaveLength(0);
  });

  it('400 do ML → recusada (libera, mensagem do ML); 403 → reconectar', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 400, body: { message: 'Percentage not found 35.0' } };
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: false, estado: 'recusada' });
    expect(r.erro).toContain('Percentage not found 35.0');
    c.ctl.resposta = { status: 403, body: { message: 'forbidden' } };
    const r2 = await executarAcao(c.deps, c.entrada(OP2));
    expect(r2).toMatchObject({ ok: false, estado: 'recusada', erro: MSG_RECONECTAR, codigo: 'reconectar' });
    expect(c.ml.posts).toHaveLength(2);
  });

  it('mesmo operacao_id com payload diferente → 409; verificar de operação inexistente → 404 sem POST', async () => {
    const c = cenario();
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    await executarAcao(c.deps, c.entrada(OP1));
    const r = await executarAcao(c.deps, c.entrada(OP1, { acao: 'abrir_disputa' }));
    expect(r).toMatchObject({ ok: false, http: 409 });
    expect((await executarAcao(c.deps, c.entrada(OP2, { verificar: true }))).http).toBe(404);
    expect(c.ml.posts).toHaveLength(1);
  });

  it('repetir o mesmo operacao_id depois de confirmada devolve o gravado, sem POST', async () => {
    const c = cenario();
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    await executarAcao(c.deps, c.entrada(OP1));
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'confirmada' });
    expect(c.ml.posts).toHaveLength(1);
    expect(c.ctl.syncs).toBe(1);
  });
});

describe('executarAcao — concorrência e incerteza', () => {
  it('duas execuções simultâneas no mesmo recurso → 1 POST; a outra recebe 409 com a pendente', async () => {
    const c = cenario();
    const g = adiado();
    c.ctl.gatePost = g.p;
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    const a = executarAcao(c.deps, c.entrada(OP1));
    const b = executarAcao(c.deps, c.entrada(OP2, { acao: 'abrir_disputa' }));
    const rb = await b;
    g.liberar();
    const ra = await a;
    expect(ra.estado).toBe('confirmada');
    expect(rb).toMatchObject({ ok: false, http: 409, erro: MSG_TRAVA, pendente: { acao: 'reembolsar', operacao_id: OP1 } });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('mesmo operacao_id em duas abas ao mesmo tempo → 1 POST', async () => {
    const c = cenario();
    const g = adiado();
    c.ctl.gatePost = g.p;
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    const a = executarAcao(c.deps, c.entrada(OP1));
    const b = executarAcao(c.deps, c.entrada(OP1));
    const rb = await b;
    g.liberar();
    await a;
    expect(rb.ok).toBe(true);
    expect(c.ml.posts).toHaveLength(1);
  });

  it('timeout após o POST e duas "Conferir" → 0 POSTs novos; confirma quando o ML mostra o efeito', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'desconhecido', pendenteConfirmacao: true });
    expect(c.ml.posts).toHaveLength(1);
    // Efeito ainda não visível: as duas conferências só releem.
    const [v1, v2] = await Promise.all([
      executarAcao(c.deps, c.entrada(OP1, { verificar: true, acao: undefined })),
      executarAcao(c.deps, c.entrada(OP1, { verificar: true, acao: undefined })),
    ]);
    expect([v1.estado, v2.estado]).toEqual(['desconhecido', 'desconhecido']);
    c.ml.detalhe = reembolsou('2026-10-28T12:00:02.000Z')(c.ml.detalhe);
    const [v3, v4] = await Promise.all([
      executarAcao(c.deps, c.entrada(OP1, { verificar: true, acao: undefined })),
      executarAcao(c.deps, c.entrada(OP1, { verificar: true, acao: undefined })),
    ]);
    expect([v3.estado, v4.estado]).toEqual(['confirmada', 'confirmada']);
    expect(c.ml.posts).toHaveLength(1);
    expect(c.linha(OP1).sync_pendente).toBe(false);
  });

  it('trava mantida enquanto desconhecido: nova ação no mesmo recurso → 409 sem POST', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 503, body: null };
    await executarAcao(c.deps, c.entrada(OP1));
    const r = await executarAcao(c.deps, c.entrada(OP2));
    expect(r).toMatchObject({ ok: false, http: 409 });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('interrupção após confirmada (sync falhou) → repetir refaz só o sync, nunca o POST', async () => {
    const c = cenario();
    c.ctl.efeito = reembolsou('2026-10-28T12:00:01.000Z');
    c.ctl.falharSync = 1;
    const r = await executarAcao(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'confirmada', sincronizacaoPendente: true });
    const r2 = await executarAcao(c.deps, c.entrada(OP1));
    expect(r2).toMatchObject({ estado: 'confirmada', sincronizacaoPendente: false, devolucao: { claim_id: 10 } });
    expect(c.ml.posts).toHaveLength(1);
    expect(c.ctl.syncs).toBe(2);
    expect(c.ctl.enfileirados).toBe(1);
  });

  it('revisar sem return_id local → 409 antes de reservar; return_id divergente no ML → cancelada', async () => {
    const c = cenario();
    const sem = { ...c.entrada(OP1, { acao: 'revisar_ok' }), returnIdLocal: null };
    expect((await executarAcao(c.deps, sem)).http).toBe(409);
    expect(c.linhas.size).toBe(0);
    c.ml.detalhe = det({ return_id: 99 });
    const r = await executarAcao(c.deps, c.entrada(OP2, { acao: 'revisar_ok' }));
    expect(r).toMatchObject({ estado: 'cancelada' });
    expect(c.ml.posts).toHaveLength(0);
  });

  it('revisar_ok: pending → success com 2xx → confirmada; recurso return:77', async () => {
    const c = cenario();
    c.ctl.efeito = (d) => ({ ...d, acoes: [], revisoes: [{ order_id: 500, seller_status: 'success' }] });
    const r = await executarAcao(c.deps, c.entrada(OP1, { acao: 'revisar_ok' }));
    expect(r.estado).toBe('confirmada');
    expect(c.ml.posts[0].path).toBe('/post-purchase/v1/returns/77/return-review');
    expect(c.linha(OP1).recurso).toBe('return:77');
  });
});

describe('recuperarPendentes (reconciliar horário)', () => {
  it('claim closed com revisão pending após timeout → continua travado', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    await executarAcao(c.deps, c.entrada(OP1, { acao: 'revisar_ok' }));
    c.ml.detalhe = det({ status: 'closed', acoes: [], revisoes: [{ order_id: 500, seller_status: 'pending' }] });
    c.avancar(10 * 60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('desconhecido');
    expect((await executarAcao(c.deps, c.entrada(OP2, { acao: 'revisar_ok' }))).http).toBe(409);
    expect(c.ml.posts).toHaveLength(1);
  });

  it('revisão pending → success após timeout: inconclusivo; libera como inconclusiva só quando o ML não aceita mais', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    await executarAcao(c.deps, c.entrada(OP1, { acao: 'revisar_ok' }));
    c.ml.detalhe = det({ acoes: [], revisoes: [{ order_id: 500, seller_status: 'success' }] });
    c.avancar(10 * 60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('inconclusiva');
  });

  it('inconclusivo com a ação ainda liberada → continua travado; sai quando a ação some', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    await executarAcao(c.deps, c.entrada(OP1));
    c.avancar(10 * 60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('desconhecido');
    c.ml.detalhe = det({ acoes: ['open_dispute'], stage: 'dispute' });
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('inconclusiva');
    expect(c.ml.posts).toHaveLength(1);
  });

  it('confirma pelo reconciliar e refaz o sync pendente', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    await executarAcao(c.deps, c.entrada(OP1));
    c.ml.detalhe = reembolsou('2026-10-28T12:00:02.000Z')(c.ml.detalhe);
    c.ctl.falharSync = 1;
    c.avancar(10 * 60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1)).toMatchObject({ estado: 'confirmada', sync_pendente: true });
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).sync_pendente).toBe(false);
    expect(c.ml.posts).toHaveLength(1);
  });

  it('reserva antiga sem post_em → cancelada; reserva nova fica', async () => {
    const c = cenario();
    const g = adiado();
    c.ctl.gateLeitura = g.p;
    const a = executarAcao(c.deps, c.entrada(OP1));
    await ate(() => c.linhas.size > 0);
    c.avancar(60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('reservada');
    c.avancar(2 * 60_000);
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1).estado).toBe('cancelada');
    g.liberar();
    const r = await a;
    expect(r.estado).toBe('cancelada');
    expect(c.ml.posts).toHaveLength(0);
  });

  it('intercalação: reconciliador seleciona reserva antiga → passo 4 marca post_em → cancelamento não acontece; 1 POST', async () => {
    const c = cenario();
    const leitura = adiado();
    const noPost = adiado();
    const segura = adiado();
    c.ctl.gateLeitura = leitura.p;
    c.ctl.aoChegarNoPost = noPost.liberar;
    c.ctl.gatePost = segura.p; // o POST fica em voo enquanto o reconciliador tenta cancelar
    c.ctl.efeito = reembolsou('2026-10-28T12:03:01.000Z');
    const a = executarAcao(c.deps, c.entrada(OP1));
    await ate(() => c.linhas.size > 0);
    c.avancar(3 * 60_000);
    // O reconciliador já tirou o snapshot (reserva antiga, post_em null); antes de cancelar, o passo 4 roda.
    c.ctl.aoListarAbertas = async () => { c.ctl.aoListarAbertas = null; leitura.liberar(); await noPost.p; };
    await recuperarPendentes(c.deps);
    expect(c.linha(OP1)).toMatchObject({ estado: 'reservada' });
    expect(c.linha(OP1).post_em).not.toBeNull();
    segura.liberar();
    const r = await a;
    expect(r.estado).toBe('confirmada');
    expect(c.ml.posts).toHaveLength(1);
    expect(c.linha(OP1).estado).toBe('confirmada');
  });
});

describe('responder', () => {
  it('moderação rejeitada → mantém a trava e avisa', async () => {
    const c = cenario();
    c.ml.detalhe = det({ acoes: ['send_message_to_complainant'] });
    c.ctl.efeito = (d) => ({ ...d, historico: [{ data: '2026-10-28T12:00:01.000Z', autor: 'vendedor', destinatario: 'comprador', texto: 'Olá', anexos: [], status: 'available', moderacao: 'rejected' }] });
    const r = await executarAcao(c.deps, c.entrada(OP1, { acao: 'responder', texto: 'Olá' }));
    expect(r).toMatchObject({ ok: false, estado: 'enviada', pendenteConfirmacao: true });
    expect(r.erro).toBe('O ML bloqueou a mensagem na moderação');
    expect(c.ml.posts[0].corpo).toEqual({ receiver_role: 'complainant', message: 'Olá', attachments: [] });
  });
});

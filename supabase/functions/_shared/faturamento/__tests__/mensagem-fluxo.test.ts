import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  efeitoMensagem, enviarMensagem, liberarEnvio, verificarEnvio,
  type DepsMensagem, type MsgConversa, type PayloadMensagem, type TentativaMensagem,
} from '../mensagem-fluxo';
import { ESTADOS_ATIVOS } from '../posvenda-fluxo';

const ORG = 'org-1';
const PACK = 'pack-1';
const RECURSO = `mensagem:${PACK}`;
const OP1 = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';
const COM_ANEXO: PayloadMensagem = { texto: 'Segue a foto', anexo: 'a.png' };
const SO_TEXTO: PayloadMensagem = { texto: 'Olá', anexo: null };

const msg = (over: Partial<MsgConversa> = {}): MsgConversa => ({
  id: 'm1', deVendedor: true, texto: 'Segue a foto', anexos: ['a.png'], moderacao: 'clean', ...over,
});

/** Espera a execução concorrente chegar a um ponto (macrotarefas, sem relógio real). */
const ate = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0)); };

/** Banco em memória com as MESMAS garantias do Postgres: unique (org, operacao_id), unique parcial
 *  (org, recurso) nos estados ativos e update condicional (0 linhas = null). Devolve cópias. */
function cenario() {
  let relogio = Date.parse('2026-11-07T12:00:00.000Z');
  const linhas = new Map<string, TentativaMensagem>();
  let seq = 0;
  const ml = { conversa: [] as MsgConversa[], posts: [] as PayloadMensagem[], leituras: 0, falharLeitura: false };
  const ctl = {
    resposta: { status: 200 as number | null, body: { id: 'm1', message_moderation: { status: 'clean' } } as unknown },
    gatePost: null as null | Promise<void>,
    /** O que aparece na conversa quando o POST chega (o efeito real). */
    efeito: null as null | MsgConversa,
  };
  const ativa = (t: TentativaMensagem) => ESTADOS_ATIVOS.includes(t.estado);
  const copia = <T>(v: T): T => structuredClone(v);

  const deps: DepsMensagem = {
    agora: () => new Date(relogio).toISOString(),
    async porOperacao(op) {
      const t = [...linhas.values()].find((x) => x.operacao_id === op);
      return t ? copia(t) : null;
    },
    async inserir(n) {
      if ([...linhas.values()].some((x) => x.operacao_id === n.operacao_id)) return 'conflito_operacao';
      if ([...linhas.values()].some((x) => x.recurso === n.recurso && ativa(x))) return 'conflito_recurso';
      const t: TentativaMensagem = {
        ...n, id: `t${++seq}`, estado: 'reservada', antes: null, post_em: null, http_status: null, resposta_ml: null,
        erro: null, criado_em: new Date(relogio).toISOString(),
      };
      linhas.set(t.id, t);
      return copia(t);
    },
    async ativaDoRecurso(recurso) {
      const t = [...linhas.values()].find((x) => x.recurso === recurso && ativa(x));
      return t ? copia(t) : null;
    },
    async atualizar(id, onde, set) {
      const t = linhas.get(id);
      if (!t || t.estado !== onde.estado) return null;
      if (onde.postEmNulo && t.post_em != null) return null;
      const novo = { ...t, ...copia(set) };
      linhas.set(id, novo);
      return copia(novo);
    },
    async lerConversa() {
      ml.leituras++;
      if (ml.falharLeitura) throw new Error('Não foi possível ler a conversa no Mercado Livre.');
      return copia(ml.conversa);
    },
    async postML(p) {
      ml.posts.push(p);
      if (ctl.gatePost) await ctl.gatePost;
      if (ctl.efeito) ml.conversa = [...ml.conversa, ctl.efeito];
      return copia(ctl.resposta);
    },
    erroRecusa: (status) => `recusado ${status}`,
  };
  const entrada = (operacaoId: string, payload: PayloadMensagem = COM_ANEXO, packId = PACK) => ({ orgId: ORG, userId: 'clicou', packId, operacaoId, payload });
  const avancar = (ms: number) => { relogio += ms; };
  const linha = (op: string) => [...linhas.values()].find((x) => x.operacao_id === op)!;
  /** Tentativa de uma edge que caiu: fica `reservada`, com ou sem `post_em`. */
  const reservaOrfa = async (op: string, comPost: boolean) => {
    const t = await deps.inserir({
      org_id: ORG, user_id: 'u', operacao_id: op, pack_id: PACK, recurso: RECURSO, acao: 'responder_mensagem', payload: COM_ANEXO, payload_hash: 'h',
    });
    if (typeof t === 'string') throw new Error(t);
    if (comPost) await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { post_em: deps.agora(), antes: { ids: [] } });
  };
  return { deps, ml, ctl, entrada, avancar, linha, reservaOrfa };
}

/** POST sem resposta: não se sabe se o ML recebeu. */
const emTimeout = async (c: ReturnType<typeof cenario>) => {
  c.ctl.resposta = { status: null, body: null };
  return await enviarMensagem(c.deps, c.entrada(OP1));
};

describe('cliente sem operacao_id (legado)', () => {
  const legado = (c: ReturnType<typeof cenario>, op = OP1) => enviarMensagem(c.deps, { ...c.entrada(op), legado: true });
  const INCERTO = 'Não foi possível confirmar o envio. Confira no Mercado Livre antes de enviar de novo.';

  it('legado_timeout_vira_inconclusiva_e_502_e_nao_trava', async () => {
    const c = cenario();
    c.ctl.resposta = { status: null, body: null };
    expect(await legado(c)).toMatchObject({ http: 502, ok: false, estado: 'inconclusiva', pendenteConfirmacao: false, erro: INCERTO });
    expect(c.linha(OP1).estado).toBe('inconclusiva');
    expect(c.ml.posts).toHaveLength(1);
    c.ctl.resposta = { status: 200, body: { id: 'm2', message_moderation: { status: 'clean' } } };
    expect(await legado(c, OP2)).toMatchObject({ ok: true, estado: 'confirmada' });
  });

  it.each([500, 408])('legado_%i_tambem_responde_502', async (status) => {
    const c = cenario();
    c.ctl.resposta = { status, body: null };
    expect(await legado(c)).toMatchObject({ http: 502, ok: false, estado: 'inconclusiva', erro: INCERTO });
  });

  it('legado_2xx_sem_clean_responde_ok_e_nao_trava', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 200, body: { id: 'm1', message_moderation: { status: 'pending' } } };
    expect(await legado(c)).toMatchObject({ http: 200, ok: true, estado: 'inconclusiva', pendenteConfirmacao: false });
    expect(c.linha(OP1).estado).toBe('inconclusiva');
    expect(c.ml.posts).toHaveLength(1);
    c.ctl.resposta = { status: 200, body: { id: 'm2', message_moderation: { status: 'clean' } } };
    expect(await legado(c, OP2)).toMatchObject({ ok: true, estado: 'confirmada' });
  });

  it('legado_clean_confirma_normal', async () => {
    const c = cenario();
    expect(await legado(c)).toEqual({ http: 200, ok: true, estado: 'confirmada', operacao_id: OP1, pendenteConfirmacao: false });
  });

  it('legado_recusa_4xx_segue_recusada', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 400, body: { message: 'x' } };
    expect(await legado(c)).toMatchObject({ http: 422, ok: false, estado: 'recusada', erro: 'recusado 400' });
  });

  it('legado_com_envio_em_aberto_no_pack_segue_409', async () => {
    const c = cenario();
    await emTimeout(c);
    expect(await legado(c, OP2)).toMatchObject({ http: 409, codigo: 'em_andamento', pendente: { operacao_id: OP1, estado: 'desconhecido' } });
    expect(c.linha(OP1).estado).toBe('desconhecido');
    expect(c.ml.posts).toHaveLength(1);
  });

  it('sem_legado_timeout_mantem_desconhecido', async () => {
    const c = cenario();
    expect(await emTimeout(c)).toMatchObject({ http: 200, ok: true, estado: 'desconhecido', pendenteConfirmacao: true });
    expect(c.linha(OP1).estado).toBe('desconhecido');
  });
});

describe('enviarMensagem', () => {
  it('envia_e_confirma_com_clean_sem_reler', async () => {
    const c = cenario();
    c.ml.conversa = [msg({ id: 'velha', texto: 'antes' })];
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toEqual({ http: 200, ok: true, estado: 'confirmada', operacao_id: OP1, pendenteConfirmacao: false });
    expect(c.ml.posts).toEqual([COM_ANEXO]);
    expect(c.ml.leituras).toBe(1); // só o snapshot, antes do POST
    expect(c.linha(OP1)).toMatchObject({
      org_id: ORG, user_id: 'clicou', pack_id: PACK, recurso: RECURSO, acao: 'responder_mensagem', antes: { ids: ['velha'] },
      http_status: 200, resposta_ml: c.ctl.resposta.body, erro: null,
      payload_hash: createHash('sha256').update(JSON.stringify({ packId: PACK, payload: COM_ANEXO })).digest('hex'),
    });
    expect(c.linha(OP1).post_em).not.toBeNull();
  });

  it('operacao_repetida_nao_posta_de_novo', async () => {
    const c = cenario();
    await enviarMensagem(c.deps, c.entrada(OP1));
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'confirmada', operacao_id: OP1 });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('operacao_com_outro_conteudo_409', async () => {
    const c = cenario();
    await enviarMensagem(c.deps, c.entrada(OP1));
    const r = await enviarMensagem(c.deps, c.entrada(OP1, SO_TEXTO));
    expect(r).toMatchObject({ http: 409, ok: false, estado: null });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('operacao_de_outro_pack_409', async () => {
    const c = cenario();
    await emTimeout(c);
    const outro = 'pack-2';
    expect(await enviarMensagem(c.deps, c.entrada(OP1, COM_ANEXO, outro))).toMatchObject({ http: 409, ok: false });
    expect(await verificarEnvio(c.deps, outro, OP1)).toMatchObject({ http: 409, ok: false });
    expect(await liberarEnvio(c.deps, outro, OP1)).toMatchObject({ http: 409, ok: false });
    expect(c.ml.posts).toHaveLength(1);
    expect(c.linha(OP1).estado).toBe('desconhecido');
  });

  it('segundo_operador_recebe_em_andamento_com_pendente', async () => {
    const c = cenario();
    let liberar!: () => void;
    c.ctl.gatePost = new Promise((r) => { liberar = r; });
    const a = enviarMensagem(c.deps, c.entrada(OP1));
    await ate(() => c.ml.posts.length > 0);
    const b = await enviarMensagem(c.deps, c.entrada(OP2));
    expect(b).toMatchObject({ http: 409, ok: false, codigo: 'em_andamento', pendente: { operacao_id: OP1, estado: 'reservada' } });
    liberar();
    expect((await a).estado).toBe('confirmada');
    expect(c.ml.posts).toHaveLength(1);
  });

  it('leitura_falha_cancela_sem_post', async () => {
    const c = cenario();
    c.ml.falharLeitura = true;
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ http: 502, ok: false, estado: 'cancelada' });
    expect(c.ml.posts).toHaveLength(0);
    expect(c.linha(OP1).post_em).toBeNull();
  });

  it('timeout_vira_desconhecido_e_nao_repete', async () => {
    const c = cenario();
    const r = await emTimeout(c);
    expect(r).toMatchObject({ http: 200, ok: true, estado: 'desconhecido', pendenteConfirmacao: true });
    expect(await enviarMensagem(c.deps, c.entrada(OP1))).toMatchObject({ estado: 'desconhecido' });
    expect(await enviarMensagem(c.deps, c.entrada(OP2))).toMatchObject({ http: 409, codigo: 'em_andamento' });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('4xx_vira_recusada_e_libera_nova_operacao', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 400, body: { message: 'x' } };
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ http: 422, ok: false, estado: 'recusada', erro: 'recusado 400', codigo: 'recusada', pendenteConfirmacao: false });
    expect(c.ml.leituras).toBe(1); // recusa do ML dispensa conferência
    c.ctl.resposta = { status: 200, body: { id: 'm2', message_moderation: { status: 'clean' } } };
    expect((await enviarMensagem(c.deps, c.entrada(OP2))).estado).toBe('confirmada');
    expect(c.ml.posts).toHaveLength(2);
  });

  it('403_pede_reconexao', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 403, body: null };
    expect(await enviarMensagem(c.deps, c.entrada(OP1))).toMatchObject({ estado: 'recusada', codigo: 'reconectar' });
  });

  it('rejected_vira_recusada', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 200, body: { id: 'm1', message_moderation: { status: 'rejected' } } };
    c.ctl.efeito = msg({ moderacao: 'rejected' });
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: false, estado: 'recusada', codigo: 'moderacao', pendenteConfirmacao: false });
    expect(c.linha(OP1).estado).toBe('recusada');
    c.ctl.efeito = null;
    c.ctl.resposta = { status: 200, body: { id: 'm2', message_moderation: { status: 'clean' } } };
    expect((await enviarMensagem(c.deps, c.entrada(OP2))).estado).toBe('confirmada');
  });

  it('pendente_de_moderacao_mantem_trava', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 200, body: { id: 'm1', message_moderation: { status: 'pending' } } };
    c.ctl.efeito = msg({ moderacao: 'pending' });
    const r = await enviarMensagem(c.deps, c.entrada(OP1));
    expect(r).toMatchObject({ ok: true, estado: 'enviada', pendenteConfirmacao: true });
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'enviada', pendenteConfirmacao: true });
    expect(await enviarMensagem(c.deps, c.entrada(OP2))).toMatchObject({ http: 409, codigo: 'em_andamento' });
    expect(c.ml.posts).toHaveLength(1);
  });
});

describe('verificarEnvio', () => {
  it('operacao_desconhecida_404', async () => {
    expect(await verificarEnvio(cenario().deps, PACK, OP1)).toMatchObject({ http: 404, ok: false });
  });

  it('verificar_confirma_por_mensagem_nova_com_mesmo_anexo', async () => {
    const c = cenario();
    await emTimeout(c);
    c.ml.conversa = [msg({ texto: '  Segue a foto\n' })];
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ ok: true, estado: 'confirmada', pendenteConfirmacao: false });
    expect(c.ml.posts).toHaveLength(1);
  });

  it('verificar_nao_confirma_com_anexo_diferente', async () => {
    const c = cenario();
    await emTimeout(c);
    c.ml.conversa = [msg({ anexos: ['b.png'] })];
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'desconhecido', pendenteConfirmacao: true });
  });

  it('verificar_nao_confirma_mensagem_do_snapshot', async () => {
    const c = cenario();
    c.ml.conversa = [msg()];
    await emTimeout(c);
    expect(c.linha(OP1).antes).toEqual({ ids: ['m1'] });
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'desconhecido' });
  });

  it('duas_candidatas_iguais_inconclusivo', async () => {
    const c = cenario();
    await emTimeout(c);
    c.ml.conversa = [msg({ id: 'm1' }), msg({ id: 'm2' })];
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'desconhecido' });
  });

  it('verificar_usa_o_id_devolvido_pelo_post', async () => {
    const c = cenario();
    c.ctl.resposta = { status: 200, body: { id: 'm1', message_moderation: { status: 'pending' } } };
    await enviarMensagem(c.deps, c.entrada(OP1));
    c.ml.conversa = [msg({ id: 'm2' })];
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'enviada' });
    c.ml.conversa = [msg({ id: 'm2' }), msg({ id: 'm1' })];
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'confirmada' });
  });

  it('erro_de_leitura_mantem_o_estado', async () => {
    const c = cenario();
    await emTimeout(c);
    c.ml.falharLeitura = true;
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'desconhecido', pendenteConfirmacao: true });
  });

  it('reserva_velha_vira_cancelada', async () => {
    const c = cenario();
    await c.reservaOrfa(OP1, false);
    c.avancar(2 * 60_000);
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'reservada', pendenteConfirmacao: true });
    c.avancar(1);
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ ok: false, estado: 'cancelada' });
    expect(c.ml.posts).toHaveLength(0);
    expect(c.ml.leituras).toBe(0);
  });

  it('reserva_com_post_em_velha_vira_desconhecido_e_pode_liberar', async () => {
    const c = cenario();
    await c.reservaOrfa(OP1, true);
    c.avancar(2 * 60_000 + 1);
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'desconhecido', pendenteConfirmacao: true });
    expect(await liberarEnvio(c.deps, PACK, OP1)).toMatchObject({ ok: true, estado: 'inconclusiva' });
    expect(c.ml.posts).toHaveLength(0);
  });

  it('reserva_com_post_em_velha_confirma_se_a_mensagem_apareceu', async () => {
    const c = cenario();
    await c.reservaOrfa(OP1, true);
    c.ml.conversa = [msg()];
    c.avancar(2 * 60_000 + 1);
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ ok: true, estado: 'confirmada' });
    expect(c.ml.posts).toHaveLength(0);
  });

  it('reserva_com_post_em_recente_nao_muda', async () => {
    const c = cenario();
    await c.reservaOrfa(OP1, true);
    c.ml.conversa = [msg()]; // nem com a mensagem à vista: o POST pode estar em voo
    c.avancar(2 * 60_000);
    expect(await verificarEnvio(c.deps, PACK, OP1)).toMatchObject({ estado: 'reservada', pendenteConfirmacao: true });
    expect(c.ml.leituras).toBe(0);
  });
});

describe('liberarEnvio', () => {
  it('liberar_grava_inconclusiva_e_permite_nova_operacao', async () => {
    const c = cenario();
    await emTimeout(c);
    const r = await liberarEnvio(c.deps, PACK, OP1);
    expect(r).toMatchObject({ http: 200, ok: true, estado: 'inconclusiva', pendenteConfirmacao: false });
    expect(c.linha(OP1)).toMatchObject({ estado: 'inconclusiva', erro: 'Liberado pelo operador após conferir no Mercado Livre.' });
    c.ctl.resposta = { status: 200, body: { id: 'm2', message_moderation: { status: 'clean' } } };
    expect((await enviarMensagem(c.deps, c.entrada(OP2))).estado).toBe('confirmada');
    expect(c.ml.posts).toHaveLength(2);
  });

  it('liberar_recusa_confirmada', async () => {
    const c = cenario();
    await enviarMensagem(c.deps, c.entrada(OP1));
    expect(await liberarEnvio(c.deps, PACK, OP1)).toMatchObject({ http: 409, ok: false });
    expect(c.linha(OP1).estado).toBe('confirmada');
  });

  it('liberar_recusa_reservada', async () => {
    const c = cenario();
    await c.reservaOrfa(OP1, true);
    expect(await liberarEnvio(c.deps, PACK, OP1)).toMatchObject({ http: 409, ok: false });
    expect(c.linha(OP1).estado).toBe('reservada');
  });

  it('liberar_operacao_desconhecida_404', async () => {
    expect(await liberarEnvio(cenario().deps, PACK, OP1)).toMatchObject({ http: 404, ok: false });
  });
});

describe('efeitoMensagem', () => {
  it('só_texto_não_casa_com_mensagem_que_tem_anexo', () => {
    expect(efeitoMensagem([], [msg({ texto: 'Olá' })], SO_TEXTO, null)).toBe('inconclusivo');
    expect(efeitoMensagem([], [msg({ texto: 'Olá', anexos: [] })], SO_TEXTO, null)).toBe('confirmado');
  });

  it('mensagem_do_comprador_nao_conta', () => {
    expect(efeitoMensagem([], [msg({ deVendedor: false })], COM_ANEXO, null)).toBe('inconclusivo');
  });

  it('moderacao_decide_o_desfecho', () => {
    expect(efeitoMensagem([], [msg({ moderacao: 'rejected' })], COM_ANEXO, null)).toBe('nao');
    expect(efeitoMensagem([], [msg({ moderacao: 'pending' })], COM_ANEXO, null)).toBe('inconclusivo');
    expect(efeitoMensagem([], [msg({ moderacao: null })], COM_ANEXO, null)).toBe('inconclusivo');
  });
});

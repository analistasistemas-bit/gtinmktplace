// Ações POST da Reposição (ADR-0207 §13, §15, §16). Escrita só por aqui, com service role (as tabelas
// têm só SELECT para `authenticated`). `db` injetado para teste sem Deno.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { familiaMaisRecente, normalizarNome, somarDias } from '../_shared/reposicao/dados.ts';
import type { StatusPedido } from '../_shared/reposicao/tipos.ts';

export interface CtxAcao {
  orgId: string; userId: string; isAdmin: boolean; support: null | { scope: 'read' | 'full' };
  /** YYYY-MM-DD em BRT. */
  hoje: string;
  /** ISO do instante da ação. */
  agora: string;
}
export interface DepsAcao { db: SupabaseClient; moduloHabilitado(): Promise<boolean> }
export interface RespostaAcao { status: number; body: Record<string, unknown> }

interface Item { codigo: string; codigo_pai: string; quantidade: number; sugerida: number | null; recebida: number; encerrado: boolean }
interface Pedido { id: string; status: StatusPedido; previsto_para: string | null; enviado_em: string | null; ref_aprovacao: string | null }

const ok = (body: Record<string, unknown> = {}): RespostaAcao => ({ status: 200, body: { ok: true, ...body } });
const erro = (status: number, mensagem: string): RespostaAcao => ({ status, body: { error: mensagem } });

const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const inteiro = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const ehDia = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && somarDias(v, 0) === v;
const ehUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const listaCodigos = (v: unknown): v is string[] | undefined => v === undefined || (Array.isArray(v) && v.every(texto));

function falhou(onde: string, error: { message: string } | null): void {
  if (error) throw new Error(`reposicao/${onde}: ${error.message}`);
}
function falhar(onde: string, error: { message: string }): never {
  throw new Error(`reposicao/${onde}: ${error.message}`);
}

/** Erro de RPC da reposição → resposta (mensagens em pt-BR vêm da própria RPC); outro erro → null (lança). */
function erroRpc(error: { code?: string; message: string }): RespostaAcao | null {
  const msg = error.message.replace(/^reposicao_\w+: /, '');
  if (error.code === 'P0002') return erro(404, msg);
  if (error.code === '23514') return erro(409, msg);
  if (error.code === '22023') return erro(400, msg);
  if (error.code === '42501') return erro(403, msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
  return null;
}

export async function processarAcao(deps: DepsAcao, ctx: CtxAcao, corpo: unknown): Promise<RespostaAcao> {
  if (!(await deps.moduloHabilitado())) return erro(403, 'Módulo de reposição não habilitado para esta organização.');
  if (!corpo || typeof corpo !== 'object') return erro(400, 'JSON inválido.');
  const c = corpo as Record<string, unknown>;
  const { db } = deps;
  const o = ctx.orgId;
  // Quem aprova pedido também muda o que vale para a org inteira (config, múltiplo) e o pedido já aprovado.
  const admin = ctx.isAdmin || ctx.support?.scope === 'full';

  const lerPedido = async (id: unknown): Promise<Pedido | null> => {
    if (!ehUuid(id)) return null;
    const { data, error } = await db.from('pedidos_compra').select('id, status, previsto_para, enviado_em, ref_aprovacao')
      .eq('id', id).eq('org_id', o).maybeSingle();
    falhou('ler pedido', error);
    return data as Pedido | null;
  };
  const lerItens = async (pedidoId: string): Promise<Item[]> => {
    const { data, error } = await db.from('pedidos_compra_itens')
      .select('codigo, codigo_pai, quantidade, sugerida, recebida, encerrado').eq('pedido_id', pedidoId).eq('org_id', o);
    falhou('ler itens', error);
    return (data ?? []) as Item[];
  };

  switch (c.action) {
    case 'salvar_config': {
      if (!admin) return erro(403, 'Só administrador altera o prazo e a cobertura da reposição.');
      if (!inteiro(c.prazo, 1, 180) || !inteiro(c.cobertura, 1, 365)) {
        return erro(400, 'Prazo de reposição entre 1 e 180 dias e cobertura desejada entre 1 e 365 dias.');
      }
      const { error } = await db.from('reposicao_config').upsert({
        org_id: o, prazo_dias: c.prazo, cobertura_dias: c.cobertura, atualizado_por: ctx.userId, atualizado_em: ctx.agora,
      }, { onConflict: 'org_id' });
      falhou('salvar config', error);
      return ok();
    }

    case 'salvar_rascunho': {
      const nome = texto(c.fornecedorNome) ? c.fornecedorNome.trim().replace(/\s+/g, ' ') : '';
      const itens = c.itens as { codigo: unknown; codigoPai: unknown; quantidade: unknown; sugerida?: unknown }[];
      if (!nome) return erro(400, 'Informe o fornecedor.');
      if (!Array.isArray(itens) || !itens.length || !itens.every((i) => i && texto(i.codigo) && texto(i.codigoPai)
        && inteiro(i.quantidade, 0, 1_000_000) && (i.sugerida == null || inteiro(i.sugerida, 0, 1_000_000)))) {
        return erro(400, 'Itens inválidos.');
      }
      if (new Set(itens.map((i) => i.codigo)).size !== itens.length) return erro(400, 'SKU repetido na lista.');
      if (c.previstoPara !== undefined && c.previstoPara !== null && !ehDia(c.previstoPara)) return erro(400, 'Data prevista inválida.');
      if (c.pedidoId != null && !ehUuid(c.pedidoId)) return erro(404, 'Pedido não encontrado.');

      // Fornecedor por nome normalizado (cadastro da org, ADR-0207 §19): cria se não existir.
      const norm = normalizarNome(nome);
      const { error: fErr } = await db.from('fornecedores')
        .upsert({ org_id: o, nome, nome_normalizado: norm }, { onConflict: 'org_id,nome_normalizado', ignoreDuplicates: true });
      falhou('fornecedor', fErr);
      const { data: forn, error: lErr } = await db.from('fornecedores').select('id')
        .eq('org_id', o).eq('nome_normalizado', norm).maybeSingle();
      falhou('ler fornecedor', lErr);
      if (!forn) throw new Error('reposicao/fornecedor: não encontrado após upsert');

      // Atômico sob o lock do rascunho (RPC): aprovado no meio → 409 e nada muda.
      const { data: pedidoId, error: rErr } = await db.rpc('reposicao_salvar_rascunho', {
        p_org: o, p_fornecedor: forn.id, p_pedido: c.pedidoId ?? null, p_usuario: ctx.userId,
        p_previsto: c.previstoPara ?? null, p_mudar_previsto: c.previstoPara !== undefined,
        p_itens: itens.map((i) => ({ codigo: i.codigo, codigo_pai: i.codigoPai, quantidade: i.quantidade, sugerida: i.sugerida ?? null })),
      });
      if (rErr) return erroRpc(rErr) ?? falhar('salvar rascunho', rErr);
      if (!pedidoId) return ok({ pedidoId: null }); // rascunho ficou sem item e foi apagado
      await avisarAdmins(db, o, `Rascunho de pedido de compra para ${nome} esperando aprovação.`, `rascunho:${pedidoId}:${ctx.hoje}`);
      return ok({ pedidoId });
    }

    case 'aprovar': {
      if (!admin) return erro(403, 'Só administrador aprova o pedido.');
      if (!texto(c.ref)) return erro(400, 'Referência de idempotência ausente.');
      const ref = c.ref;
      const p = await lerPedido(c.pedidoId);
      if (!p) return erro(404, 'Pedido não encontrado.');
      const repetida = (x: Pedido) => (x.ref_aprovacao === ref ? ok({ jaAprovado: true }) : erro(409, 'Este pedido já foi aprovado.'));
      if (p.status !== 'rascunho') return repetida(p);
      if (!(await lerItens(p.id)).length) return erro(400, 'Pedido sem itens.');
      let previsto = p.previsto_para;
      if (!previsto) {
        const { data: cfg, error } = await db.from('reposicao_config').select('prazo_dias').eq('org_id', o).maybeSingle();
        falhou('ler config', error);
        previsto = cfg ? somarDias(ctx.hoje, (cfg as { prazo_dias: number }).prazo_dias) : null;
      }
      const { data, error } = await db.from('pedidos_compra').update({
        status: 'aprovado', aprovado_por: ctx.userId, aprovado_em: ctx.agora, ref_aprovacao: ref, previsto_para: previsto,
      }).eq('id', p.id).eq('org_id', o).eq('status', 'rascunho').select('id');
      if (error?.code === '23505') return erro(409, 'Referência de aprovação já usada em outro pedido.');
      falhou('aprovar', error);
      if ((data as unknown[] | null)?.length) return ok();
      // Perdeu a corrida (duplo clique): vale o que ficou gravado.
      const agora = await lerPedido(p.id);
      return agora ? repetida(agora) : erro(404, 'Pedido não encontrado.');
    }

    case 'marcar_enviado': {
      const p = await lerPedido(c.pedidoId);
      if (!p) return erro(404, 'Pedido não encontrado.');
      if (p.status === 'rascunho') return erro(409, 'Aprove o pedido antes de marcar como enviado.');
      if (p.status !== 'aprovado') return ok({ jaEnviado: true });
      const { error } = await db.from('pedidos_compra').update({ status: 'enviado', enviado_em: ctx.agora })
        .eq('id', p.id).eq('org_id', o).eq('status', 'aprovado');
      falhou('marcar enviado', error);
      return ok();
    }

    case 'editar_pedido': {
      const itens = c.itens as { codigo: unknown; quantidade: unknown }[];
      if (!ehDia(c.previstoPara)) return erro(400, 'Data prevista inválida.');
      if (!Array.isArray(itens) || !itens.length || !itens.every((i) => i && texto(i.codigo) && inteiro(i.quantidade, 0, 1_000_000))) {
        return erro(400, 'Itens inválidos.');
      }
      if (!ehUuid(c.pedidoId)) return erro(404, 'Pedido não encontrado.');
      if (new Set(itens.map((i) => i.codigo)).size !== itens.length) return erro(400, 'SKU repetido na lista.');
      // Atômico sob o lock do pedido (RPC): qualquer recebimento, mesmo desfeito, trava a edição (409); pedido
      // já aprovado só com `p_pode_aprovado` (admin), senão 403 — inclusive rascunho aprovado no meio da edição.
      const { error } = await db.rpc('reposicao_editar_pedido', {
        p_org: o, p_pedido: c.pedidoId, p_usuario: ctx.userId, p_previsto: c.previstoPara,
        p_itens: itens.map((i) => ({ codigo: i.codigo, quantidade: i.quantidade })), p_pode_aprovado: admin,
      });
      if (error) return erroRpc(error) ?? falhar('editar pedido', error);
      return ok();
    }

    case 'definir_multiplo': {
      if (!admin) return erro(403, 'Só administrador altera o múltiplo de compra.');
      if (!texto(c.codigoPai)) return erro(400, 'Informe o produto.');
      if (!inteiro(c.multiplo, 1, 1000)) return erro(400, 'Múltiplo de compra entre 1 e 1000.');
      // Mesma família canônica do cálculo (dados.ts): a mais recente do codigo_pai que tem variação.
      const { data, error } = await db.from('familias').select('id, criado_em, variacoes!inner(id)')
        .eq('org_id', o).eq('codigo_pai', c.codigoPai);
      falhou('ler família', error);
      const fams = (data ?? []) as { id: string; criado_em: string }[];
      const alvo = fams.reduce<typeof fams[number] | null>((m, f) => (!m || familiaMaisRecente(f, m) ? f : m), null);
      if (!alvo) return erro(404, 'Produto não encontrado.');
      const { error: uErr } = await db.from('familias').update({ multiplo_compra: c.multiplo }).eq('id', alvo.id).eq('org_id', o);
      falhou('múltiplo', uErr);
      return ok();
    }

    case 'encerrar_saldo':
    case 'reabrir_saldo': {
      const encerrar = c.action === 'encerrar_saldo';
      if (!listaCodigos(c.codigos)) return erro(400, 'Lista de SKUs inválida.');
      if (!ehUuid(c.pedidoId)) return erro(404, 'Pedido não encontrado.');
      // Atômico sob o lock do pedido (RPC): status recalculado pelas quantidades atuais.
      const { data, error } = await db.rpc(encerrar ? 'reposicao_encerrar_saldo' : 'reposicao_reabrir_saldo',
        { p_org: o, p_pedido: c.pedidoId, p_codigos: c.codigos ?? null });
      if (error) return erroRpc(error) ?? falhar('saldo', error);
      return ok(data as { status: string; codigos: string[] });
    }

    case 'nao_repor': {
      const escopo = c.escopo;
      if (escopo !== 'sku' && escopo !== 'cor' && escopo !== 'familia') return erro(400, 'Escopo inválido.');
      if (!texto(c.codigoPai) || (escopo === 'sku' && !texto(c.codigo)) || (escopo === 'cor' && !texto(c.cor))) {
        return erro(400, 'Informe o produto e, conforme o escopo, o SKU ou a cor.');
      }
      const linha = {
        org_id: o, escopo, codigo_pai: c.codigoPai, codigo: escopo === 'sku' ? c.codigo : null, cor: escopo === 'cor' ? c.cor : null,
      };
      const { data, error } = await db.from('reposicao_nao_repor').insert({ ...linha, criado_por: ctx.userId }).select('id').single();
      if (!error) return ok({ id: (data as { id: string }).id });
      if (error.code !== '23505') falhou('não repor', error);
      // Já marcado: devolve o id existente (idempotente).
      let q = db.from('reposicao_nao_repor').select('id').eq('org_id', o).eq('escopo', escopo).eq('codigo_pai', linha.codigo_pai);
      q = linha.codigo === null ? q.is('codigo', null) : q.eq('codigo', linha.codigo);
      q = linha.cor === null ? q.is('cor', null) : q.eq('cor', linha.cor);
      const { data: ex, error: eErr } = await q.maybeSingle();
      falhou('ler não repor', eErr);
      return ok({ id: (ex as { id: string } | null)?.id ?? null });
    }

    case 'remover_nao_repor': {
      if (!ehUuid(c.id)) return erro(400, 'Informe o id.');
      const { error } = await db.from('reposicao_nao_repor').delete().eq('id', c.id).eq('org_id', o);
      falhou('remover não repor', error);
      return ok();
    }

    default:
      return erro(400, 'Ação desconhecida.');
  }
}

/** Aviso in-app a todo admin ativo da org (ADR-0207 §15), uma vez por chave. Melhor esforço: o
 * rascunho já está salvo, e a falha do aviso não pode desfazê-lo. */
async function avisarAdmins(db: SupabaseClient, orgId: string, texto: string, chave: string): Promise<void> {
  try {
    const { data, error } = await db.from('profiles').select('id').eq('org_id', orgId).eq('is_active', true).eq('is_admin', true);
    if (error) throw error;
    const admins = (data ?? []) as { id: string }[];
    if (!admins.length) return;
    const { error: nErr } = await db.from('notificacoes').upsert(
      admins.map((a) => ({ user_id: a.id, org_id: orgId, categoria: 'reposicao', texto, chave })),
      { onConflict: 'user_id,chave', ignoreDuplicates: true },
    );
    if (nErr) throw nErr;
  } catch (e) {
    console.warn('reposicao: aviso de rascunho falhou', (e as Error).message);
  }
}

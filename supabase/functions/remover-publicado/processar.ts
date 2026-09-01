import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { pathsDaFamilia, filtrarPathsDeDonos } from '../_shared/lote/exclusao.ts';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';
import { limparMovimentosOrfaos } from '../_shared/estoque/limpeza.ts';
import type { ContextoCanal } from '../_shared/canais/contrato.ts';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { atualizarStatusML, buscarItemML } from '../_shared/ml/atualizar-item.ts';
import { buscarItemUP, type FetchLike } from '../_shared/ml/buscar-item.ts';
import {
  removerComposicaoUP, type PortasRemocao, type FilhoComp, type ResultadoRemocaoUP,
} from '../_shared/user-products/remover-composicao.ts';

export interface RemoverPublicadoInput {
  familiaId: string;
  orgId: string;
  canal: string;
  preservarFamilia?: boolean;
}

export interface RemoverPublicadoDeps {
  admin: SupabaseClient;
  /** Necessário quando a família tem filhos User Products ativos e, no modo republicar
   *  (`preservarFamilia`), também para Legacy/UP-esvaziada — o anúncio raiz é pausado no ML
   *  antes de cortar o vínculo. Só a REMOÇÃO de Legacy/UP-esvaziada segue sem token vivo. */
  ctx?: ContextoCanal;
  conexao?: ConexaoCanal;
  /** Injetável em teste; produção usa a saga real (`removerComposicaoUP`). */
  removerComposicao?: (portas: PortasRemocao, filhos: FilhoComp[]) => Promise<ResultadoRemocaoUP>;
  fetchLike?: FetchLike;
}

export type ResultadoRemocao =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'nao_publicada' }
  | { tipo: 'em_voo' }
  /** ADR-0088: 1+ filhos não confirmaram pausado no ML nesta tentativa. Nada foi deletado
   *  (raiz e filhas preservadas) — o operador pode clicar "Remover" de novo (idempotente). */
  | { tipo: 'remocao_pendente'; pendentes: string[] }
  | { tipo: 'preservada'; familiaId: string; loteId: string }
  | { tipo: 'ok'; familiasRemovidas: number; lotesRemovidos: number };

export async function removerPublicado(deps: RemoverPublicadoDeps, input: RemoverPublicadoInput): Promise<ResultadoRemocao> {
  const { admin } = deps;
  const { familiaId, orgId, canal } = input;

  const { data: alvo, error: alvoErr } = await admin.from('familias')
    .select('id, lote_id, codigo_pai, ml_item_id, org_id')
    .eq('id', familiaId).eq('org_id', orgId).maybeSingle();
  if (alvoErr) throw new Error(`remover-publicado: consultar família falhou: ${alvoErr.message}`);
  if (!alvo) return { tipo: 'nao_encontrada' };
  // Invariante ADR-0019: este escape hatch só remove famílias PUBLICADAS.
  if (!alvo.ml_item_id) return { tipo: 'nao_publicada' };

  // Guarda: bloqueia se há família do mesmo codigo_pai em 'publicando' (UPDATE em voo depende do ml_item_id).
  const { data: emVoo, error: emVooErr } = await admin.from('familias')
    .select('id').eq('codigo_pai', alvo.codigo_pai).eq('org_id', alvo.org_id).eq('status', 'publicando').limit(1);
  if (emVooErr) throw new Error(`remover-publicado: consultar em_voo falhou: ${emVooErr.message}`);
  if (emVoo && emVoo.length > 0) return { tipo: 'em_voo' };

  // Mini-saga de remoção User Products (ADR-0088, "Remoção de família UP — pausar todos os
  // filhos no ML, depois deletar local em cascata"): comportamento NOVO, escopado só a UP — o
  // Legacy nunca toca o ML na remoção (ADR-0019), intocado. Detecta UP pela presença de linhas
  // em anuncios_externos_itens (mesmo sinal que update-familia-ml usa pro roteamento).
  const { data: externos, error: externosErr } = await admin.from('anuncios_externos')
    .select('id, mudando_composicao').eq('org_id', alvo.org_id).eq('codigo_pai', alvo.codigo_pai).eq('canal', canal);
  if (externosErr) throw new Error(`remover-publicado: consultar anuncios_externos falhou: ${externosErr.message}`);
  const idsExternos = (externos ?? []).map((e: { id: string }) => e.id);
  // true ⇔ a mini-saga UP abaixo rodou sobre 1+ filhos (e só chegamos adiante se TODOS
  // confirmaram pausado). false ⇔ Legacy ou UP já esvaziada — ninguém pausou nada no ML.
  let filhosUPPausadosPelaSaga = false;
  // Guarda (revisão Codex): uma mudança de composição em andamento/travada deixa uma janela real
  // onde um filho `retirado=true` pode já estar ATIVO no ML (crash entre ativar-remoto e
  // marcarAtivo, que só então limpa retirado), ou um filho `criacao_incerta` pode ter um POST real
  // já feito no ML sem o id salvo ainda. `mudando_composicao=true` é ligado ANTES de qualquer
  // mutação remota e só limpo DEPOIS de tudo confirmado (atualizar-composicao.ts) — cobre as DUAS
  // janelas por completo. Bloquear aqui evita que a remoção confie em `retirado`/`itemExternoId`
  // ambíguos durante essa janela, em vez de re-verificar por GET cada linha "tombstone" (mais caro
  // e desnecessário fora dessa janela).
  if ((externos ?? []).some((e: { mudando_composicao?: boolean }) => e.mudando_composicao)) {
    return { tipo: 'em_voo' };
  }
  if (idsExternos.length > 0) {
    const { data: filhosRaw, error: filhosErr } = await admin.from('anuncios_externos_itens')
      .select('sku, item_externo_id, retirado, status').in('anuncio_externo_id', idsExternos);
    // Fail-closed (mesmo padrão do roteamento em update-familia-ml/processar.ts): erro de query
    // NUNCA pode virar "não tem filhos UP" em silêncio — arriscaria deletar uma família UP real
    // sem pausar nada primeiro.
    if (filhosErr) throw new Error(`remover-publicado: consultar filhos UP falhou: ${filhosErr.message}`);
    filhosUPPausadosPelaSaga = (filhosRaw ?? []).length > 0;
    const filhos: FilhoComp[] = ((filhosRaw ?? []) as Array<Record<string, unknown>>).map((f) => ({
      sku: f.sku as string,
      status: f.status as FilhoComp['status'],
      retirado: !!f.retirado,
      itemExternoId: (f.item_externo_id as string | null) ?? null,
      familyId: null,
    }));
    if (filhos.length > 0) {
      // Gate ATRÁS de "tem filhos": família Legacy ou UP já esvaziada (só linhas retirado=true,
      // filtradas antes de chegar aqui — na verdade filhos.length>0 já inclui essas, a saga que
      // as ignora) não deveria exigir token vivo pra simplesmente deletar localmente.
      if (!deps.ctx || !deps.conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      const { ctx, conexao } = deps;
      const fetchLike = deps.fetchLike ?? fetch;
      const portas: PortasRemocao = {
        pausar: (itemExternoId) => ctx.getToken().then((token) => atualizarStatusML(token, itemExternoId, 'paused')),
        async confirmar(itemExternoId) {
          const item = await buscarItemUP(fetchLike, { accessToken: await ctx.getToken() }, itemExternoId);
          const sellerEsperado = conexao.contaExternaId ?? '';
          if (!item) return { ok: false, status: null }; // GET falhou → transiente.
          // Operação destrutiva (revisão Codex): fail-closed na identidade. `seller_id` ausente no
          // corpo do GET não prova posse — não assume ok só porque não achou divergência explícita.
          if (item.sellerId == null || item.sellerId !== sellerEsperado) {
            return { ok: false, status: item.status, inesperado: true }; // identidade não confirmada → terminal.
          }
          return { ok: true, status: item.status };
        },
        salvarStatus: async (sku, status) => {
          const { error } = await admin.from('anuncios_externos_itens')
            .update({ status }).eq('sku', sku).in('anuncio_externo_id', idsExternos);
          // Propaga — o chamador (a mini-saga, via seu próprio wrapper best-effort) já loga e
          // segue sem derrubar o TRY-ALL; aqui não podemos silenciar (perderia o único registro
          // de que este filho ficou pendente).
          if (error) throw new Error(`salvarStatus (${sku}): ${error.message}`);
        },
      };
      const removerComposicao = deps.removerComposicao ?? removerComposicaoUP;
      const resultado = await removerComposicao(portas, filhos);
      if (resultado.tipo === 'incompleto') {
        return { tipo: 'remocao_pendente', pendentes: resultado.pendentes };
      }
      // pronto_para_deletar → segue o fluxo comum de delete abaixo, idêntico ao Legacy.
    }
  }

  if (input.preservarFamilia) {
    if (idsExternos.length > 0) {
      const { data: recheck, error: recheckErr } = await admin.from('anuncios_externos')
        .select('mudando_composicao').in('id', idsExternos);
      if (recheckErr) throw new Error(`remover-publicado: re-checar mudando_composicao falhou: ${recheckErr.message}`);
      if ((recheck ?? []).some((e: { mudando_composicao?: boolean }) => e.mudando_composicao)) {
        return { tipo: 'em_voo' };
      }
    }
    // Família Legacy (ou UP já esvaziada): a saga acima não pausou nada — pausa o PRÓPRIO anúncio
    // antes de cortar o vínculo local, senão ele fica ATIVO e órfão no ML e a republicação
    // (CREATE) gera um duplicado. GET primeiro decide: `active` → PUT pausar (o PUT também enforça
    // posse — item de outro seller responde 403 e aborta); já pausado/closed/moderado → nada a
    // pausar (PUT em closed daria 400 e travaria justamente a recuperação de anúncio moderado);
    // 404/410 → item já sumiu, seguro seguir. Erro transiente (GET ou PUT) aborta ANTES de
    // qualquer mutação local — fail-closed, o operador clica de novo (idempotente).
    if (!filhosUPPausadosPelaSaga) {
      if (!deps.ctx) throw new Error('Organização sem conexão com o Mercado Livre');
      const token = await deps.ctx.getToken();
      let statusItem: string | null = null;
      let itemSumiu = false;
      try {
        statusItem = (await buscarItemML(token, alvo.ml_item_id)).status;
      } catch (e) {
        const st = (e as { status?: number } | null)?.status;
        if (st === 404 || st === 410) itemSumiu = true;
        else throw new Error(`remover-publicado: consultar anúncio no ML falhou: ${(e as Error).message}`);
      }
      if (!itemSumiu && statusItem === 'active') {
        await atualizarStatusML(token, alvo.ml_item_id, 'paused');
      }
    }
    const { error: famErr } = await admin.from('familias').update({
      ml_item_id: null,
      ml_permalink: null,
      publicado_em: null,
      status: 'pronto',
      erro_mensagem: null,
      operacao: 'CREATE',
      capa_ml_picture_id: null,
      capa2_ml_picture_id: null,
      capa3_ml_picture_id: null,
    }).eq('id', alvo.id).eq('org_id', orgId);
    if (famErr) throw new Error(`remover-publicado: preparar família para republicação falhou: ${famErr.message}`);
    const { error: varErr } = await admin.from('variacoes').update({
      ml_variation_id: null,
      preco_publicado_ml: null,
      ml_picture_id: null,
    }).eq('familia_id', alvo.id);
    if (varErr) throw new Error(`remover-publicado: limpar vínculos das variações falhou: ${varErr.message}`);
    const { error: extErr } = await admin.from('anuncios_externos')
      .delete().eq('org_id', alvo.org_id).eq('canal', canal).eq('codigo_pai', alvo.codigo_pai);
    if (extErr) throw new Error(`remover-publicado: limpar anúncios externos falhou: ${extErr.message}`);
    await admin.from('lotes').update({ status: 'revisao' }).eq('id', alvo.lote_id);
    return { tipo: 'preservada', familiaId: alvo.id, loteId: alvo.lote_id };
  }

  // Codex P2: o vínculo de UPDATE é GLOBAL por (user_id, codigo_pai, ml_item_id not null) —
  // o ingest-lote casa por codigo_pai. Após ciclos de UPDATE existem várias linhas publicadas
  // do mesmo codigo_pai (uma por lote). Remover só a selecionada deixaria outra satisfazendo a
  // busca → a próxima planilha ainda viraria UPDATE no anúncio morto. Removemos TODAS as linhas
  // publicadas do mesmo codigo_pai para realmente cortar o vínculo.
  const { data: familias, error: familiasErr } = await admin.from('familias')
    .select('id, lote_id, user_id, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path)')
    .eq('codigo_pai', alvo.codigo_pai).eq('org_id', orgId).not('ml_item_id', 'is', null);
  // Fail-closed (revisão Codex): erro aqui virando `alvos=[]` reportaria `ok` sem remover nada.
  if (familiasErr) throw new Error(`remover-publicado: listar famílias pra excluir falhou: ${familiasErr.message}`);
  const alvos = familias ?? [];

  // Re-checagem TOCTOU (revisão Codex): entre o gate de mudando_composicao lá em cima e aqui, o
  // loop de pausar-todos os filhos levou tempo real (N chamadas HTTP) — uma NOVA composição pode
  // ter começado nesse meio-tempo (iniciarComposicao roda ANTES de qualquer mutação remota, então
  // pega qualquer composição que já começou). ANTES de QUALQUER ação destrutiva — inclusive a
  // remoção de fotos do Storage logo abaixo, que não é reversível por um simples "não deletar do
  // banco" (achado round 3: re-checar só antes do delete do banco ainda apagaria fotos de uma
  // família cuja composição começou no meio-tempo, mesmo abortando o delete local depois). Não
  // elimina o TOCTOU por completo (residual: composição pode começar entre esta re-checagem e as
  // ações abaixo, uma janela de milissegundos) — mesma classe de risco "sem lock contra
  // concorrência" já aceita no resto do ADR-0088 (mini-saga de composição, ponytail comment em
  // atualizar-familia-up.ts). Reduz a janela de "toda a duração da remoção" pra "um instante".
  if (idsExternos.length > 0) {
    const { data: recheck, error: recheckErr } = await admin.from('anuncios_externos')
      .select('mudando_composicao').in('id', idsExternos);
    if (recheckErr) throw new Error(`remover-publicado: re-checar mudando_composicao falhou: ${recheckErr.message}`);
    if ((recheck ?? []).some((e: { mudando_composicao?: boolean }) => e.mudando_composicao)) {
      return { tipo: 'em_voo' };
    }
  }

  // Guard de posse: `capa*_storage_path` é editável por QUALQUER membro da org (RLS
  // "familias: update org"), e este remove roda com service_role — a RLS de storage, que só
  // deixa apagar sob o próprio prefixo ("imagens: delete own"), não se aplica aqui. Cada
  // família só pode apagar arquivo sob o prefixo do SEU dono: travar na org seria mais frouxo
  // que a RLS que esta função substitui, e deixaria um membro apagar arquivo de um colega.
  const paths = [...new Set(alvos.flatMap((f) => filtrarPathsDeDonos(
    pathsDaFamilia({
      capa_storage_path: f.capa_storage_path,
      capa2_storage_path: f.capa2_storage_path,
      capa3_storage_path: f.capa3_storage_path,
      variacoes: f.variacoes ?? [],
    }),
    new Set([f.user_id as string]),
  )))];
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('remover-publicado storage falhou (segue):', error.message);
  }

  const lotesAfetados = [...new Set(alvos.map((f) => f.lote_id))];
  const { error: delFamiliasErr } = await admin.from('familias').delete().in('id', alvos.map((f) => f.id));
  if (delFamiliasErr) throw new Error(`remover-publicado: deletar familias falhou: ${delFamiliasErr.message}`);
  const { error: delExternosErr } = await admin.from('anuncios_externos')
    .delete()
    .eq('org_id', alvo.org_id)          // E7: escopo por org — não apagar anúncio de outra org com mesmo codigo_pai
    .eq('canal', canal)
    .eq('codigo_pai', alvo.codigo_pai);
  // `familias` já foi apagada quando este erro acontece — não é atômico (revisão Codex, limitação
  // aceita: sem transação/RPC cross-table nesta camada). Propagar pelo menos torna o erro visível
  // em vez de reportar `ok` com o espelho `anuncios_externos` órfão.
  if (delExternosErr) throw new Error(`remover-publicado: deletar anuncios_externos falhou: ${delExternosErr.message}`);

  // ADR-0097: o ledger não tem FK para variacoes, então o cascade das famílias não o
  // alcança. Depois do delete — antes dele o conjunto órfão sairia vazio. Aqui a varredura
  // pode levar HISTÓRICO DE VENDA junto (decisão registrada no ADR): esta é a única porta
  // que remove família publicada, e o operador pediu exclusão sem resíduo.
  await limparMovimentosOrfaos(admin, alvo.org_id as string);

  // Reconta (ou remove se vazio) cada lote afetado. Remover não "conclui" o lote → setConcluido=false.
  let lotesRemovidos = 0;
  for (const loteId of lotesAfetados) {
    if (await recontarOuRemoverLote(admin, loteId, false)) lotesRemovidos++;
  }

  return { tipo: 'ok', familiasRemovidas: alvos.length, lotesRemovidos };
}

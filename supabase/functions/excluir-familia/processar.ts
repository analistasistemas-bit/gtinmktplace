// ADR-0199 — tira UMA família não publicada da Revisão. O Mercado Livre nunca é chamado.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decidirExclusaoFamilia, type MotivoRecusa } from './decidir.ts';
import { pathsDaFamilia, filtrarPathsDeDonos } from '../_shared/lote/exclusao.ts';
import { contarFamilias, decidirStatusLote } from '../_shared/lote/finalizar.ts';
import { limparMovimentosOrfaos } from '../_shared/estoque/limpeza.ts';
import { podeExcluirLote } from '../_shared/support-state.ts';
import { motivoMigracaoPxvEmCurso } from '../_shared/user-products/guard-migracao-pxv.ts';

export type ResultadoExcluirFamilia =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'recusada'; motivo: MotivoRecusa | 'pxv'; mensagem?: string }
  | { tipo: 'ok'; loteRemovido: boolean };

const LOTE_EM_VOO = ['processando', 'publicando'];
const CAPAS = ['capa_storage_path', 'capa2_storage_path', 'capa3_storage_path'] as const;

export async function excluirFamilia(
  admin: SupabaseClient, input: { familiaId: string; orgId: string; userId: string; suporteFull: boolean },
): Promise<ResultadoExcluirFamilia> {
  const { familiaId, orgId } = input;

  const { data: alvo, error: alvoErr } = await admin.from('familias')
    .select('id, lote_id, user_id, codigo_pai, status, ml_item_id, publicado_em, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path, ml_variation_id)')
    .eq('id', familiaId).eq('org_id', orgId).maybeSingle();
  if (alvoErr) throw new Error(`excluir-familia: ler família falhou: ${alvoErr.message}`);
  if (!alvo) return { tipo: 'nao_encontrada' };

  const { data: lote, error: loteErr } = await admin.from('lotes')
    .select('user_id, status, planilha_path, imagens_paths')
    .eq('id', alvo.lote_id).eq('org_id', orgId).maybeSingle();
  if (loteErr) throw new Error(`excluir-familia: ler lote falhou: ${loteErr.message}`);
  if (!lote || !podeExcluirLote(lote.user_id, input.userId, input.suporteFull)) return { tipo: 'nao_encontrada' };
  if (LOTE_EM_VOO.includes(lote.status)) return { tipo: 'recusada', motivo: 'em_voo' };

  // ADR-0161: durante a migração o vínculo local está em trânsito.
  const pxv = await motivoMigracaoPxvEmCurso(admin, orgId, alvo.codigo_pai);
  if (pxv) return { tipo: 'recusada', motivo: 'pxv', mensagem: pxv };

  // Aspas: o valor vai cru dentro do filtro `or` do PostgREST — vírgula/parêntese quebrariam a sintaxe.
  const filtroIrmas = [`codigo_pai.eq."${alvo.codigo_pai}"`, ...(alvo.ml_item_id ? [`ml_item_id.eq."${alvo.ml_item_id}"`] : [])].join(',');
  // Leitura que falha vira `undefined` → `nao_conferido` (trava fechada).
  const [irmas, externos, kits] = await Promise.all([
    admin.from('familias').select('ml_item_id, variacoes(codigo, ml_variation_id)')
      .eq('org_id', orgId).neq('id', alvo.id).or(filtroIrmas),
    admin.from('anuncios_externos')
      .select('status, item_externo_id, anuncios_externos_itens(status, item_externo_id, sku)')
      .eq('org_id', orgId).eq('codigo_pai', alvo.codigo_pai),
    admin.from('familias').select('id')
      .eq('org_id', orgId).eq('kit_base_codigo_pai', alvo.codigo_pai).not('kit_multiplicador', 'is', null),
  ]);
  const decisao = decidirExclusaoFamilia({
    alvo: { ...alvo, variacoes: alvo.variacoes ?? [] },
    irmas: irmas.error ? undefined : (irmas.data ?? []).map((i) => ({ ...i, variacoes: i.variacoes ?? [] })),
    externos: externos.error ? undefined : externos.data ?? [],
    kitsDependentes: kits.error ? undefined : (kits.data ?? []).length,
  });
  if (!decisao.ok) return { tipo: 'recusada', motivo: decisao.motivo };

  // Condicional: se o worker pegou a família entre a leitura e aqui, nada é apagado.
  const { data: apagadas, error: delErr } = await admin.from('familias').delete()
    .eq('id', alvo.id).eq('org_id', orgId).in('status', ['pronto', 'erro']).is('publicado_em', null).select('id');
  // Trigger de kit vinculado / Kit Virtual (ADR-0151): a mensagem do banco diz qual.
  if (delErr?.code === '23514') return { tipo: 'recusada', motivo: 'kit', mensagem: delErr.message };
  if (delErr) throw new Error(`excluir-familia: deletar família falhou: ${delErr.message}`);
  if (!apagadas || apagadas.length === 0) return { tipo: 'recusada', motivo: 'em_voo' };

  // ADR-0097 D-2: só depois do delete — antes dele o anti-join sai vazio.
  await limparMovimentosOrfaos(admin, orgId);

  // `recontarOuRemoverLote` ignora erro de escrita; aqui a escrita é conferida.
  const { data: restantes, error: restErr } = await admin.from('familias').select('status').eq('lote_id', alvo.lote_id);
  if (restErr) throw new Error(`excluir-familia: ler famílias do lote falhou: ${restErr.message}`);
  const loteRemovido = (restantes ?? []).length === 0;
  if (loteRemovido) {
    const { error } = await admin.from('lotes').delete().eq('id', alvo.lote_id);
    if (error) throw new Error(`excluir-familia: apagar lote falhou: ${error.message}`);
  } else {
    const c = contarFamilias(restantes!);
    const status = decidirStatusLote(c);
    const { error } = await admin.from('lotes').update({
      total_familias: restantes!.length, total_publicadas: c.publicado, total_erros: c.erro,
      ...(status ? { status } : {}),
    }).eq('id', alvo.lote_id);
    if (error) throw new Error(`excluir-familia: atualizar lote falhou: ${error.message}`);
  }

  await removerArquivos(admin, orgId, alvo, lote, loteRemovido);
  return { tipo: 'ok', loteRemovido };
}

// Best-effort: a exclusão já commitou. Na dúvida (leitura falhou), não apaga nada.
async function removerArquivos(
  admin: SupabaseClient, orgId: string,
  alvo: Parameters<typeof pathsDaFamilia>[0] & { user_id: string },
  lote: { user_id: string; planilha_path: string | null; imagens_paths: string[] | null },
  loteRemovido: boolean,
): Promise<void> {
  const imagensLote = lote.imagens_paths ?? [];
  let paths = filtrarPathsDeDonos(pathsDaFamilia({ ...alvo, variacoes: alvo.variacoes ?? [] }), new Set([alvo.user_id]));
  if (loteRemovido) {
    const doLote = [lote.planilha_path, ...imagensLote].filter((p): p is string => !!p);
    paths.push(...filtrarPathsDeDonos(doLote, new Set([lote.user_id])));
  } else {
    // O lote sobreviveu: os uploads dele ficam para o `excluir-lote`.
    paths = paths.filter((p) => !imagensLote.includes(p));
  }
  paths = [...new Set(paths)];
  if (paths.length === 0) return;

  // Foto compartilhada (capa de kit = foto da base) fica enquanto alguém da org a usa.
  const leituras = await Promise.all([
    ...CAPAS.map((col) => admin.from('familias').select(col).eq('org_id', orgId).in(col, paths)),
    admin.from('variacoes').select('imagem_path, familias!inner(org_id)').eq('familias.org_id', orgId).in('imagem_path', paths),
  ]);
  const falha = leituras.find((r) => r.error);
  if (falha) {
    console.warn('excluir-familia: referências de storage indisponíveis (não apaga):', falha.error!.message);
    return;
  }
  const usados = new Set(leituras.flatMap((r) => (r.data ?? []) as Record<string, unknown>[])
    .flatMap((linha) => [...CAPAS, 'imagem_path'].map((col) => linha[col])));
  const remover = paths.filter((p) => !usados.has(p));
  if (remover.length === 0) return;
  const { error } = await admin.storage.from('imagens').remove(remover);
  if (error) console.warn('excluir-familia: storage falhou (segue):', error.message);
}

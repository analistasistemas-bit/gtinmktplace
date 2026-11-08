// ADR-0200 (adendo de 08/11): aviso ao terminar montagem, desmontagem ou reposição de kit com variação, no app e no
// Telegram, com o link do anúncio do kit. Mesmo padrão do aviso de kit zerado (`venda.ts`): envio com chave por
// transferência (in-app por chave, Telegram reservado por chat) e `aviso_fim_enviado_em` gravado só DEPOIS do envio.
// Falha fica sem marca; a varredura diária (`reconciliar-estoque`) tenta de novo. Nunca mexe na saga.
// Transferência que mandou alerta escalonado (`alerta_enviado`) e concluiu ganha o "resolvido": no próprio aviso de
// fim ou, nos tipos sem aviso de fim (entrada, cancelamento, guardar peças), num aviso curto com a mesma chave.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CategoriaNotificacao } from '../notificacoes/categorias.ts';
import { AVISO_SELETOR_ML } from './combinacoes.ts';

export type NotificarComChave = (
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string, opcoes: { chave: string },
) => Promise<unknown>;

const TIPOS = ['montar', 'desmontar', 'repor'];

function exigir<T>(r: { data: T; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  return r.data;
}

/** Link do Gerenciar kit no PubliAI (Publicados abre o diálogo por `?kit=`). Sem `APP_URL` ou sem kit: null. */
export function linkGerenciarKit(appUrl: string | undefined, kitId: string | null | undefined): string | null {
  const base = (appUrl ?? '').trim().replace(/\/$/, '');
  return base && kitId ? `${base}/#/publicados?kit=${encodeURIComponent(kitId)}` : null;
}

/** Alerta da saga (travada, bloqueada, abortada) com o código do kit e o link do Gerenciar kit, quando houver. */
export function comLinkDoKit(texto: string, appUrl: string | undefined, kit: { id: string | null; codigoPai?: string | null }): string {
  const link = linkGerenciarKit(appUrl, kit.id);
  const sufixo = [kit.codigoPai ? `Kit ${kit.codigoPai}.` : '', link ? `Abrir o Gerenciar kit: ${link}` : ''].filter(Boolean);
  return sufixo.length ? `${texto}\n\n${sufixo.join(' ')}` : texto;
}

const kits = (n: number) => `${n} ${n === 1 ? 'kit' : 'kits'}`;
const RESOLVIDO = 'O alerta anterior desta transferência foi resolvido.';
const TIPO_ROTULO: Record<string, string> = { entrada: 'entrada de peças', cancelamento: 'cancelamento', sair_sobra: 'guardar peças' };

/**
 * Avisa o fim de UMA transferência concluída (`montar`, `desmontar`, `repor`; outro tipo só se alertou). Devolve true
 * se enviou agora; false se não é caso de aviso ou já foi avisada. Erro de leitura ou de envio lança, sem marcar.
 */
export async function avisarFimTransferencia(
  admin: SupabaseClient, notificar: NotificarComChave, orgId: string, transferenciaId: string,
): Promise<boolean> {
  const t = exigir(await admin.from('kit_transferencias')
    .select('id, kit_id, tipo, estado, itens, aviso_fim_enviado_em, alerta_enviado')
    .eq('id', transferenciaId).eq('org_id', orgId).maybeSingle(), 'ler transferência') as {
      kit_id: string | null; tipo: string; estado: string; itens: Array<{ codigo: string; quantidade: number }>;
      aviso_fim_enviado_em: string | null; alerta_enviado: string | null;
    } | null;
  if (!t || t.estado !== 'concluida' || t.aviso_fim_enviado_em) return false;
  // Encerrar kit avisa a conclusão por `avisarKitsEncerrados` (`kit_encerrado:<kit>`): sem aviso duplicado.
  if (t.tipo === 'encerrar') return false;
  const enviar = async (texto: string) => {
    await notificar(admin, orgId, 'estoque', texto, { chave: `kit_fim:${transferenciaId}` });
    // Sem a marca, a varredura reenvia com a mesma chave: não duplica.
    const { error } = await admin.from('kit_transferencias').update({ aviso_fim_enviado_em: new Date().toISOString() })
      .eq('id', transferenciaId).is('aviso_fim_enviado_em', null);
    if (error) console.error('kit_aviso_fim_marcar_falhou', transferenciaId, error.message);
    return true;
  };
  if (!TIPOS.includes(t.tipo) || !t.kit_id) {
    if (!t.alerta_enviado) return false;
    return await enviar(`✅ Resolvido: a transferência de kit (${TIPO_ROTULO[t.tipo] ?? t.tipo}) que tinha alertado `
      + 'terminou. Nada a fazer.');
  }

  const kit = exigir(await admin.from('kits_variacao').select('codigo_pai_kit, pecas_por_kit')
    .eq('id', t.kit_id).eq('org_id', orgId).maybeSingle(), 'ler kit') as { codigo_pai_kit: string; pecas_por_kit: number } | null;
  if (!kit) throw new Error(`kit ${t.kit_id} não encontrado`);
  const codigos = t.itens.map((i) => i.codigo);
  const skus = exigir(await admin.from('kit_variacao_skus').select('codigo, rotulo_cor, tamanho')
    .eq('kit_id', t.kit_id).eq('org_id', orgId).in('codigo', codigos), 'ler SKUs do kit') as
    Array<{ codigo: string; rotulo_cor: string; tamanho: string }>;
  const familia = exigir(await admin.from('familias').select('nome_pai, ml_permalink')
    .eq('org_id', orgId).eq('codigo_pai', kit.codigo_pai_kit)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle(), 'ler família do kit') as
    { nome_pai: string | null; ml_permalink: string | null } | null;
  let permalink = familia?.ml_permalink ?? null;
  if (!permalink) {
    const itens = exigir(await admin.from('anuncios_externos_itens').select('permalink')
      .eq('org_id', orgId).in('sku', codigos).not('permalink', 'is', null).limit(1), 'ler item do kit') as
      Array<{ permalink: string }>;
    permalink = itens[0]?.permalink ?? null;
  }
  const criacao = (exigir(await admin.from('kit_transferencia_alvos').select('codigo')
    .eq('transferencia_id', transferenciaId).eq('org_id', orgId).eq('criar', true).limit(1), 'ler alvos') as unknown[]).length > 0;

  const titulo = t.tipo === 'desmontar' ? 'Kit desmontado' : t.tipo === 'repor' ? 'Kit reposto' : criacao ? 'Kit criado' : 'Kit montado';
  const total = t.itens.reduce((s, i) => s + i.quantidade, 0);
  const linhas = t.itens.map((i) => {
    const s = skus.find((x) => x.codigo === i.codigo);
    return `• ${s ? `${s.rotulo_cor} · ${s.tamanho}` : i.codigo}: ${kits(i.quantidade)}`;
  });
  const texto = [
    `✅ ${titulo}: ${familia?.nome_pai ?? 'kit com variação'} (${kit.codigo_pai_kit})`,
    ...(t.alerta_enviado ? [RESOLVIDO] : []),
    '',
    ...linhas,
    '',
    t.tipo === 'desmontar'
      ? `${kits(total)} de ${kit.pecas_por_kit} peças voltaram para os anúncios individuais.`
      : `${kits(total)} de ${kit.pecas_por_kit} peças no anúncio do kit.`,
    permalink ? `Anúncio: ${permalink}` : 'Link do anúncio ainda não lido do Mercado Livre: veja em Publicados.',
    ...(t.tipo === 'desmontar' ? [] : ['', AVISO_SELETOR_ML]),
  ].join('\n');

  return await enviar(texto);
}

/** Varredura (reconciliação diária): concluídas sem marca, de todas as orgs. Erro por transferência só loga. */
export async function avisarFinsPendentes(admin: SupabaseClient, notificar: NotificarComChave): Promise<number> {
  // Duas leituras (tipos com aviso de fim; qualquer tipo que alertou) em vez de um `or` de PostgREST.
  const ler = async (filtro: 'tipo' | 'alerta') => {
    let q = admin.from('kit_transferencias').select('id, org_id').eq('estado', 'concluida').is('aviso_fim_enviado_em', null);
    q = filtro === 'tipo' ? q.in('tipo', TIPOS) : q.not('alerta_enviado', 'is', null).neq('tipo', 'encerrar');
    return exigir(await q.order('criado_em', { ascending: true }).limit(200), 'ler pendentes') as Array<{ id: string; org_id: string }>;
  };
  const pendentes = [...new Map([...await ler('tipo'), ...await ler('alerta')].map((p) => [p.id, p])).values()];
  let n = 0;
  for (const p of pendentes) {
    try {
      if (await avisarFimTransferencia(admin, notificar, p.org_id, p.id)) n++;
    } catch (e) {
      console.error('kit_aviso_fim_falhou', p.id, String(e));
    }
  }
  return n;
}

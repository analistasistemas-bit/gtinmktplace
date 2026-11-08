// ADR-0200 (Task 14): "Vender só em kit". Estados por SKU individual (Normal, Guardado, Sobra) e reposição
// automática até a meta, sempre por transferência da saga. Spec: "Vender só em kit", "Reposição" e o contrato
// de segurança, itens 12 a 14.
//
// - `planejarReposicao` é pura, sobre a fotografia consistente (`kit_reposicao_foto`, uma consulta só).
// - Toda decisão vai por RPC versionada: a política dos SKUs envolvidos tem de estar na versão da fotografia,
//   senão a decisão é velha e a rodada repete (`kit_reposicao_sobra`, `_guardar`, `_repor`).
// - A automação só desfaz a pausa que fez (`kit_pausas_automaticas`, gravada pela saga ao finalizar).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import {
  type Conclusao, lerPoliticas, MSG_KIT_MODERADO, podeReativar, prepararStatusOperador, type ResultadoPutStatus,
} from './politica.ts';

export type EstadoSku = 'normal' | 'guardado' | 'sobra';

export interface SkuFoto {
  codigo: string;
  /** Saldo local da variação canônica (peças). */
  saldo: number;
  estado: EstadoSku;
  /** `sku_politica_kit.versao` (0 sem linha). */
  versao: number;
  /** Listado em transferência aberta (`kit_sku_em_transferencia`): nada decide sobre ele agora. */
  pendente: boolean;
}

export interface SkuKitFoto {
  codigo: string;
  /** Saldo local do SKU de kit (kits). */
  saldo: number;
  /** Tem item no ML (user product): só combinação publicada conta. */
  publicado: boolean;
  pendente: boolean;
  componentes: Array<{ codigo: string; quantidade: number }>;
}

export interface KitFoto {
  id: string;
  meta: number;
  reposicaoAuto: boolean;
  soEmKit: boolean;
  skus: SkuKitFoto[];
}

export interface FotoKit {
  kits: KitFoto[];
  skus: SkuFoto[];
  /** Pausas que a automação fez e ainda não desfez. */
  pausas: Array<{ codigo: string; itemId: string }>;
  /** Avisos de Sobra pendentes, gravados na transição (`kit_avisos_sobra`). `resultado` gravado antes do envio. */
  avisos: Array<{ codigo: string; versao: number; resultado: ResultadoAviso | null }>;
}

export type ResultadoAviso = 'reativado' | 'ativo' | 'pausado' | 'inexistente' | 'sem_pausa';
export type ResultadoReativar = 'reativado' | 'ja_ativo' | 'inexistente' | 'abandonar' | 'manter';

export interface Move { kitId: string; codigo: string; quantidade: number }

const porCodigo = (a: { codigo: string }, b: { codigo: string }) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0);

/** Combinações que valem para as regras: publicadas, de kit com "Vender só em kit". */
function combinacoes(p: FotoKit): Array<{ kit: KitFoto; s: SkuKitFoto }> {
  return p.kits.filter((k) => k.soEmKit).flatMap((k) => k.skus.filter((s) => s.publicado).map((s) => ({ kit: k, s })));
}

/**
 * Plano da rodada.
 * - `moves`: kits a montar em cada SKU de kit, só com peça Guardada e sem transferência pendente, até a meta. Ordem
 *   determinística: um kit por vez para a combinação de maior falta, empate pelo código.
 * - `sobras`: Guardado com peça que não forma nenhuma combinação publicada (falta parceiro). Cor em Sobra conta como
 *   disponível; parceiro pendente também (na dúvida não vira Sobra). Avaliado antes dos moves: a rodada seguinte, depois
 *   da transferência, decide com o saldo novo.
 * - `voltarGuardado`: Sobra com peça que agora forma combinação com parceiros livres (sem pendência e fora dos moves
 *   desta rodada). Só depois de voltar a Guardado, com a pausa confirmada, a peça é usada.
 */
export function planejarReposicao(p: FotoKit): { moves: Move[]; sobras: string[]; voltarGuardado: string[] } {
  const sku = new Map(p.skus.map((s) => [s.codigo, s]));
  const combos = combinacoes(p);
  const resto = new Map(p.skus.map((s) => [s.codigo, s.saldo]));

  const usavel = (c: string) => sku.get(c)?.estado === 'guardado' && !sku.get(c)!.pendente;
  const candidatos = combos
    .filter(({ kit, s }) => kit.reposicaoAuto && !s.pendente && s.saldo < kit.meta && s.componentes.every((x) => usavel(x.codigo)))
    .map(({ kit, s }) => ({ kit, s, falta: kit.meta - s.saldo, n: 0 }));
  const cabe = (c: (typeof candidatos)[number]) => c.falta > 0 && c.s.componentes.every((x) => (resto.get(x.codigo) ?? 0) >= x.quantidade);
  for (;;) {
    const proximo = candidatos.filter(cabe).sort((a, b) => b.falta - a.falta || porCodigo(a.s, b.s))[0];
    if (!proximo) break;
    for (const x of proximo.s.componentes) resto.set(x.codigo, resto.get(x.codigo)! - x.quantidade);
    proximo.falta--;
    proximo.n++;
  }
  const moves = candidatos.filter((c) => c.n > 0)
    .map((c) => ({ kitId: c.kit.id, codigo: c.s.codigo, quantidade: c.n }))
    .sort((a, b) => (a.kitId < b.kitId ? -1 : a.kitId > b.kitId ? 1 : porCodigo(a, b)));
  const emMove = new Set(candidatos.filter((c) => c.n > 0).flatMap((c) => c.s.componentes.map((x) => x.codigo)));

  const reservavel = (c: string) => sku.get(c)?.estado === 'guardado' || sku.get(c)?.estado === 'sobra';
  const formaParaSobra = (s: SkuKitFoto) => s.componentes.every((x) => {
    const y = sku.get(x.codigo);
    return !!y && reservavel(x.codigo) && (y.pendente || y.saldo >= x.quantidade);
  });
  const formaParaVoltar = (s: SkuKitFoto) => s.componentes.every((x) => {
    const y = sku.get(x.codigo);
    return !!y && reservavel(x.codigo) && !y.pendente && !emMove.has(x.codigo) && y.saldo >= x.quantidade;
  });
  const contendo = (c: string) => combos.filter(({ s }) => s.componentes.some((x) => x.codigo === c)).map(({ s }) => s);

  const sobras = p.skus
    .filter((s) => s.estado === 'guardado' && s.saldo > 0 && !s.pendente && !emMove.has(s.codigo)
      && !contendo(s.codigo).some(formaParaSobra))
    .map((s) => s.codigo).sort();
  const voltarGuardado = p.skus
    .filter((s) => s.estado === 'sobra' && s.saldo > 0 && !s.pendente && contendo(s.codigo).some(formaParaVoltar))
    .map((s) => s.codigo).sort();
  return { moves, sobras, voltarGuardado };
}

/** Parceiros reservados junto da volta a Guardado: os componentes das combinações formáveis, sem os próprios. */
export function parceirosDe(p: FotoKit, codigos: string[]): string[] {
  const sku = new Map(p.skus.map((s) => [s.codigo, s]));
  const proprios = new Set(codigos);
  const out = new Set<string>();
  for (const { s } of combinacoes(p)) {
    if (!s.componentes.some((x) => proprios.has(x.codigo))) continue;
    const forma = s.componentes.every((x) => {
      const y = sku.get(x.codigo);
      return !!y && (y.estado === 'guardado' || y.estado === 'sobra') && !y.pendente && y.saldo >= x.quantidade;
    });
    if (forma) for (const x of s.componentes) if (!proprios.has(x.codigo)) out.add(x.codigo);
  }
  return [...out].sort();
}

export type ResultadoDecisao = { ok: true; transferenciaId?: string } | { ok: false; motivo: string };

export interface DepsReposicao {
  foto(): Promise<FotoKit>;
  /** `kit_reposicao_sobra`: Guardado → Sobra, só com as versões da fotografia e sem transferência pendente. */
  sobra(codigos: string[], versoes: Record<string, number>): Promise<ResultadoDecisao>;
  /** `kit_reposicao_guardar`: Sobra → Guardado e transferência `sair_sobra` com os parceiros, numa transação. */
  guardar(codigos: string[], parceiros: string[], versoes: Record<string, number>): Promise<ResultadoDecisao>;
  /** `kit_reposicao_repor`: transferência `repor` com origens Guardadas na versão da fotografia. */
  repor(kitId: string, itens: Array<{ codigo: string; quantidade: number }>, versoes: Record<string, number>): Promise<ResultadoDecisao>;
  enfileirarSaga(transferenciaId: string): Promise<void>;
  /**
   * Desfaz uma pausa da automação. `abandonar`: a pausa deixou de ser da automação (operador, moderação, retirada) e
   * o registro sai sem PUT. `manter`: incerto ou ocupado; o registro fica e a rodada repete.
   */
  reativar(codigo: string, itemId: string): Promise<ResultadoReativar>;
  esquecerPausa(codigo: string, itemId: string): Promise<void>;
  /** Telegram (estoque), idempotente pela chave. */
  avisar(texto: string, chave: string): Promise<void>;
  /** Grava o resultado da reativação na pendência do aviso, antes do envio (só se ainda não houver). */
  registrarAviso(codigo: string, versao: number, resultado: ResultadoAviso): Promise<void>;
  /** Aviso enviado: a pendência sai. */
  concluirAviso(codigo: string, versao: number): Promise<void>;
}

const TEXTO_SOBRA: Record<ResultadoAviso, string> = {
  reativado: 'O anúncio individual foi reativado e vende sozinho até a peça que falta entrar; aí volta a ficar guardado para o kit.',
  ativo: 'O anúncio individual já estava ativo (reativado fora da reposição).',
  pausado: 'O anúncio individual segue pausado (pausa do operador, moderação ou recusa do Mercado Livre). Confira em Publicados.',
  inexistente: 'O anúncio individual não existe mais no Mercado Livre (excluído ou encerrado). Confira em Publicados.',
  sem_pausa: 'O anúncio individual não estava pausado pelo kit e segue como está.',
};

/**
 * Uma rodada para o kit do job. A fotografia é da org (a peça pode servir a vários kits), mas a rodada só age no kit:
 * desfaz pausas da automação dos SKUs dele fora de Guardado, aplica Sobras e voltas dos componentes dele e monta os
 * SKUs dele. `retentar`: algo ficou para depois (decisão velha, SKU ocupado, reativação incerta); o QStash repete.
 */
export async function executarReposicao(deps: DepsReposicao, kitId: string): Promise<{ retentar: boolean }> {
  const f = await deps.foto();
  const kit = f.kits.find((k) => k.id === kitId);
  if (!kit) return { retentar: false };
  const estado = new Map(f.skus.map((s) => [s.codigo, s]));
  const componentes = new Set(kit.skus.flatMap((s) => s.componentes.map((x) => x.codigo)));
  const doKit = new Set([...componentes, ...kit.skus.map((s) => s.codigo)]);
  let retentar = false;
  /** Resultado de cada pausa desfeita nesta rodada, por código: decide o texto do aviso de Sobra. */
  const resultados = new Map<string, string[]>();
  const resolvidas = new Set<string>();

  const desfazer = async (pausas: FotoKit['pausas']) => {
    for (const p of [...pausas].sort((a, b) => porCodigo(a, b) || (a.itemId < b.itemId ? -1 : 1))) {
      const r = await deps.reativar(p.codigo, p.itemId);
      resultados.set(p.codigo, [...(resultados.get(p.codigo) ?? []), r]);
      if (r === 'manter') {
        retentar = true;
        continue;
      }
      await deps.esquecerPausa(p.codigo, p.itemId);
      resolvidas.add(p.itemId);
    }
  };
  /** Versões de que a decisão depende: os códigos e todo componente das combinações que os contêm. */
  const versoesDe = (codigos: string[]) => {
    const envolvidos = new Set(codigos);
    for (const { s } of combinacoes(f)) {
      if (s.componentes.some((x) => envolvidos.has(x.codigo))) for (const x of s.componentes) envolvidos.add(x.codigo);
    }
    return Object.fromEntries([...envolvidos].sort().map((c) => [c, estado.get(c)?.versao ?? 0]));
  };

  // 1. Pausa da automação em SKU que saiu de Guardado (desligar, Sobra de rodada anterior): volta a vender.
  await desfazer(f.pausas.filter((p) => doKit.has(p.codigo) && estado.get(p.codigo)?.estado !== 'guardado'));

  const plano = planejarReposicao(f);
  // 2. Guardado → Sobra: reativa o individual e avisa.
  const sobras = plano.sobras.filter((c) => componentes.has(c));
  const avisos = f.avisos.filter((a) => componentes.has(a.codigo));
  if (sobras.length > 0) {
    // A RPC grava a pendência do aviso na mesma transação da transição.
    const r = await deps.sobra(sobras, versoesDe(sobras));
    if (!r.ok) return { retentar: true };   // decisão velha: nada mudou; a próxima rodada fotografa de novo
    for (const c of sobras) {
      await desfazer(f.pausas.filter((p) => p.codigo === c));
      avisos.push({ codigo: c, versao: (estado.get(c)?.versao ?? 0) + 1, resultado: null });
    }
  }

  // 2b. Aviso de Sobra só com o resultado da reativação conhecido; retomado em qualquer rodada, qualquer que seja o
  // estado atual. Resultado gravado antes do envio: a retomada não troca "reativado" por "sem pausa".
  for (const a of avisos.sort((x, y) => porCodigo(x, y) || x.versao - y.versao)) {
    let resultado = a.resultado;
    if (!resultado) {
      if (estado.get(a.codigo)?.estado === 'guardado' && !sobras.includes(a.codigo)) {
        await deps.concluirAviso(a.codigo, a.versao);   // já voltou a Guardado: o aviso perdeu o sentido
        continue;
      }
      const rs = resultados.get(a.codigo) ?? [];
      const restantes = f.pausas.some((p) => p.codigo === a.codigo && !resolvidas.has(p.itemId));
      if (restantes) continue;   // reativação incerta ou ainda não tentada: avisa depois
      resultado = rs.includes('reativado') ? 'reativado' : rs.includes('ja_ativo') ? 'ativo'
        : rs.includes('abandonar') ? 'pausado' : rs.includes('inexistente') ? 'inexistente' : 'sem_pausa';
      await deps.registrarAviso(a.codigo, a.versao, resultado);
    }
    try {
      await deps.avisar(
        `🧩 Sobra de kit: ${a.codigo}\n\nNão há peça das outras cores no mesmo tamanho para montar kit. ${TEXTO_SOBRA[resultado]}`,
        `kit_sobra:${a.codigo}:${a.versao}`,
      );
      await deps.concluirAviso(a.codigo, a.versao);
    } catch (e) {
      console.error('kit_sobra_aviso_falhou', a.codigo, String(e));
      retentar = true;
    }
  }

  // 3. Sobra → Guardado: parceiros reservados na mesma transação, antes da pausa; monta só na rodada seguinte.
  const voltar = plano.voltarGuardado.filter((c) => componentes.has(c));
  if (voltar.length > 0) {
    const parceiros = parceirosDe(f, voltar);
    const r = await deps.guardar(voltar, parceiros, versoesDe([...voltar, ...parceiros]));
    if (r.ok && r.transferenciaId) await deps.enfileirarSaga(r.transferenciaId);
    else retentar = true;
  }

  // 4. Reposição do kit, numa transferência só (agrupada).
  const moves = plano.moves.filter((m) => m.kitId === kitId);
  if (moves.length > 0) {
    const origens = [...new Set(moves.flatMap((m) => kit.skus.find((s) => s.codigo === m.codigo)!.componentes.map((x) => x.codigo)))];
    const r = await deps.repor(kitId, moves.map((m) => ({ codigo: m.codigo, quantidade: m.quantidade })), versoesDe(origens));
    if (r.ok && r.transferenciaId) await deps.enfileirarSaga(r.transferenciaId);
    else retentar = true;
  }
  return { retentar };
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptadores do banco. Ligar e desligar são do operador (admin, ADR-0060): a tela Gerenciar kit (Task 13) chama.

/** Alvos da saga (UP + item e cópia de catálogo), como `transferirParaSaga`. Código sem user product fica de fora. */
export async function alvosDe(
  admin: SupabaseClient, orgId: string, codigos: string[],
): Promise<Array<{ codigo: string; up_id: string; item_ids: string[] }>> {
  if (codigos.length === 0) return [];
  const { data, error } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id, user_product_id, catalog_listing_id')
    .eq('org_id', orgId).in('sku', codigos).not('user_product_id', 'is', null);
  if (error) throw new Error(`anuncios_externos_itens: ${error.message}`);
  const out = new Map<string, { codigo: string; up_id: string; item_ids: string[] }>();
  for (const i of data ?? []) {
    if (out.has(i.sku as string)) continue;
    out.set(i.sku as string, {
      codigo: i.sku as string, up_id: i.user_product_id as string,
      item_ids: [i.item_externo_id as string, ...(i.catalog_listing_id ? [i.catalog_listing_id as string] : [])],
    });
  }
  return [...out.values()];
}

async function rpc<T>(admin: SupabaseClient, nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data as T;
}

const decisao = (d: { ok?: boolean; transferencia_id?: string | null; motivo?: string; codigo?: string }): ResultadoDecisao =>
  d?.ok ? { ok: true, transferenciaId: d.transferencia_id ?? undefined }
    : { ok: false, motivo: `${d?.motivo ?? 'desconhecido'}${d?.codigo ? `:${d.codigo}` : ''}` };

/** Fotografia e decisões no banco. `reativar` e `avisar` vêm do worker (ML e Telegram). */
export function depsBanco(
  admin: SupabaseClient, orgId: string, kitId: string,
): Pick<DepsReposicao, 'foto' | 'sobra' | 'guardar' | 'repor' | 'esquecerPausa' | 'registrarAviso' | 'concluirAviso'> {
  return {
    foto: () => rpc<FotoKit>(admin, 'kit_reposicao_foto', { p_org: orgId, p_kit: kitId }),
    async sobra(codigos, versoes) {
      return decisao(await rpc(admin, 'kit_reposicao_sobra', { p_org: orgId, p_codigos: codigos, p_versoes: versoes }));
    },
    async guardar(codigos, parceiros, versoes) {
      return decisao(await rpc(admin, 'kit_reposicao_guardar', {
        p_org: orgId, p_codigos: codigos, p_parceiros: parceiros, p_versoes: versoes,
        p_alvos: await alvosDe(admin, orgId, [...codigos, ...parceiros]),
      }));
    },
    async repor(kit, itens, versoes) {
      // Alvos = exatamente o que a transferência movimenta (SKUs de kit pedidos e seus componentes). As versões
      // conferidas podem incluir mais SKUs (as combinações vizinhas da decisão) e vão separadas.
      const { data, error } = await admin.from('kit_variacao_skus').select('codigo, kit_variacao_componentes(codigo)')
        .eq('kit_id', kit).in('codigo', itens.map((i) => i.codigo));
      if (error) throw new Error(`kit_variacao_skus: ${error.message}`);
      const codigos = [...new Set((data ?? []).flatMap((x) => [x.codigo as string,
        ...((x as { kit_variacao_componentes?: Array<{ codigo: string }> }).kit_variacao_componentes ?? []).map((c) => c.codigo)]))];
      return decisao(await rpc(admin, 'kit_reposicao_repor', {
        p_org: orgId, p_kit: kit, p_itens: itens, p_versoes: versoes, p_alvos: await alvosDe(admin, orgId, codigos),
      }));
    },
    async esquecerPausa(_codigo, itemId) {
      const { error } = await admin.from('kit_pausas_automaticas').delete().eq('org_id', orgId).eq('item_id', itemId);
      if (error) throw new Error(`kit_pausas_automaticas: ${error.message}`);
    },
    async registrarAviso(codigo, versao, resultado) {
      const { error } = await admin.from('kit_avisos_sobra').update({ resultado })
        .eq('org_id', orgId).eq('codigo', codigo).eq('versao', versao).is('resultado', null);
      if (error) throw new Error(`kit_avisos_sobra: ${error.message}`);
    },
    async concluirAviso(codigo, versao) {
      const { error } = await admin.from('kit_avisos_sobra').delete()
        .eq('org_id', orgId).eq('codigo', codigo).eq('versao', versao);
      if (error) throw new Error(`kit_avisos_sobra: ${error.message}`);
    },
  };
}

/**
 * Desfaz UMA pausa da automação (Task 14). Mesmo caminho da reativação do operador (exclusão `ativacao`, CAS da versão,
 * confirmação por leitura de todos os alvos), como automação: pausa do operador, moderação e retirada nunca são
 * desfeitas. O PUT vai só no item registrado: o ML não propaga status entre item e cópia de catálogo, e a cópia pausada
 * à mão (fora de `kit_pausas_automaticas`) fica pausada.
 */
export async function reativarPausaAutomatica(admin: SupabaseClient, o: {
  orgId: string; codigo: string; itemId: string;
  lerStatus: (itemId: string) => Promise<StatusAnuncioCanal | null>;
  /** PUT `status=active` só neste item. `erro.status` ausente = sem resposta HTTP. */
  putAtivo: (itemId: string) => Promise<ResultadoPutStatus>;
  alertar: (texto: string) => Promise<unknown>;
}): Promise<ResultadoReativar> {
  const politica = (await lerPoliticas(admin, o.orgId, [o.codigo])).get(o.codigo) ?? null;
  if (!podeReativar({ politica, origem: 'automatico' }).pode) return politica?.estado === 'guardado' ? 'manter' : 'abandonar';
  // O registro só vale para item pausado. Visto ativo (alguém reativou) ou inexistente (404, encerrado): sai sem PUT,
  // e uma pausa posterior fora do app nunca é desfeita pela automação.
  let vivo: StatusAnuncioCanal | null;
  try {
    vivo = await o.lerStatus(o.itemId);
  } catch {
    return 'manter';
  }
  if (vivo === null || vivo === 'encerrado') return 'inexistente';
  if (vivo === 'ativo') return 'ja_ativo';
  if (vivo !== 'pausado') return 'abandonar';   // moderado/inativo: nunca desfeito
  const prep = await prepararStatusOperador(admin, {
    orgId: o.orgId, mlItemId: o.itemId, alvo: 'ativo', ligado: true, automatico: true, lerStatus: o.lerStatus, alertar: o.alertar,
  });
  if ('recusa' in prep) return prep.recusa === MSG_KIT_MODERADO ? 'abandonar' : 'manter';
  let r: ResultadoPutStatus = { ok: false };   // exceção = ambíguo
  let c: Conclusao = { liberado: false, status: {} };
  try {
    r = await o.putAtivo(o.itemId);
  } finally {
    c = await prep.concluir(r);
  }
  // Reativado só com o item LIDO ativo depois do PUT; resposta ok com leitura pausada repete.
  if (r.ok) return c.liberado && c.status[o.itemId] === 'ativo' ? 'reativado' : 'manter';
  const st = r.erro?.status;
  if (st !== undefined && st >= 400 && st < 500 && st !== 408 && st !== 429) {
    // Recusa definitiva do ML: repetir não muda nada; o operador decide.
    await o.alertar(`Kit com variação: o Mercado Livre recusou reativar ${o.itemId} (${o.codigo}), pausado pela reposição. `
      + 'Confira o anúncio e reative em Publicados.').catch((e) => console.error('kit_reposicao_alerta_falhou', String(e)));
    return 'abandonar';
  }
  return 'manter';
}

/**
 * Liga "Vender só em kit" num kit existente: reivindica os componentes, Normal → Guardado e transferência
 * `sair_sobra` que pausa os individuais e confere os pedidos antes de qualquer peça ser usada. Tudo numa transação;
 * SKU ocupado recusa (`up_ocupado`) e o operador repete.
 */
export async function ligarSoEmKit(
  admin: SupabaseClient, orgId: string, kitId: string,
  enfileirarSaga: (id: string) => Promise<void>,
): Promise<ResultadoDecisao> {
  const { data, error } = await admin.from('kit_variacao_skus').select('kit_variacao_componentes(codigo)').eq('kit_id', kitId);
  if (error) throw new Error(`kit_variacao_skus: ${error.message}`);
  const codigos = [...new Set((data ?? []).flatMap((s) =>
    ((s as { kit_variacao_componentes?: Array<{ codigo: string }> }).kit_variacao_componentes ?? []).map((c) => c.codigo)))];
  const r = decisao(await rpc(admin, 'kit_reposicao_ligar', {
    p_org: orgId, p_kit: kitId, p_alvos: await alvosDe(admin, orgId, codigos),
  }));
  if (r.ok && r.transferenciaId) await enfileirarSaga(r.transferenciaId);
  return r;
}

/**
 * Desliga: remove só a reivindicação deste kit; SKU sem nenhuma volta a Normal (versão incrementada). A rodada do kit
 * desfaz as pausas da automação desses SKUs.
 */
export async function desligarSoEmKit(
  admin: SupabaseClient, orgId: string, kitId: string,
  enfileirarReposicao: (kitId: string) => Promise<void>,
): Promise<string[]> {
  const normais = await rpc<string[] | null>(admin, 'kit_reposicao_desligar', { p_org: orgId, p_kit: kitId });
  await enfileirarReposicao(kitId);
  return normais ?? [];
}

/**
 * Gatilho em lote (venda, entrada, cancelamento, ajuste e fim de transferência): um job por kit que usa algum dos
 * códigos, agrupado pela fila (dedupe por kit). `soAutomaticos`: só kits com "Vender só em kit" e reposição ligadas
 * (venda); o fim de transferência dispara todos, para desfazer pausas de kit desligado. Só para org com o módulo:
 * quem chama já sabe (embed ou transferência existente).
 */
export async function dispararReposicao(
  admin: SupabaseClient, orgId: string, codigos: string[], enfileirar: (kitId: string) => Promise<void>,
  opcoes: { soAutomaticos: boolean },
): Promise<number> {
  if (codigos.length === 0) return 0;
  const { data: comps, error: e1 } = await admin.from('kit_variacao_componentes').select('kit_sku_id')
    .eq('org_id', orgId).in('codigo', codigos);
  if (e1) throw new Error(`kit_variacao_componentes: ${e1.message}`);
  const ids = [...new Set((comps ?? []).map((c) => c.kit_sku_id as string))];
  const filtro = [`codigo.in.(${codigos.map((c) => `"${c}"`).join(',')})`, ...(ids.length ? [`id.in.(${ids.join(',')})`] : [])];
  const { data: skus, error: e2 } = await admin.from('kit_variacao_skus')
    .select('kit_id, kits_variacao(so_em_kit, reposicao_auto)').eq('org_id', orgId).or(filtro.join(','));
  if (e2) throw new Error(`kit_variacao_skus: ${e2.message}`);
  const kits = new Set<string>();
  for (const s of skus ?? []) {
    const k = (s as { kits_variacao?: unknown }).kits_variacao;
    const kit = (Array.isArray(k) ? k[0] : k) as { so_em_kit?: boolean; reposicao_auto?: boolean } | null;
    if (opcoes.soAutomaticos && !(kit?.so_em_kit && kit.reposicao_auto)) continue;
    kits.add(s.kit_id as string);
  }
  for (const k of [...kits].sort()) await enfileirar(k);
  return kits.size;
}

/**
 * Rede diária (reconciliar-estoque): gatilho perdido (fila fora, worker morto) não deixa kit sem reposição nem pausa
 * da automação sem desfazer. Kits com "Vender só em kit" e kits dos SKUs com pausa pendente, um job por kit.
 */
export async function dispararReposicaoDiaria(
  admin: SupabaseClient, enfileirar: (orgId: string, kitId: string) => Promise<void>,
): Promise<number> {
  const { data: kits, error } = await admin.from('kits_variacao').select('id, org_id').eq('so_em_kit', true);
  if (error) throw new Error(`kits_variacao: ${error.message}`);
  const { data: pausas, error: e2 } = await admin.from('kit_pausas_automaticas').select('org_id, codigo');
  if (e2) throw new Error(`kit_pausas_automaticas: ${e2.message}`);
  let n = 0;
  for (const k of kits ?? []) {
    await enfileirar(k.org_id as string, k.id as string);
    n++;
  }
  const porOrg = new Map<string, string[]>();
  for (const p of pausas ?? []) porOrg.set(p.org_id as string, [...(porOrg.get(p.org_id as string) ?? []), p.codigo as string]);
  for (const [org, codigos] of porOrg) {
    n += await dispararReposicao(admin, org, [...new Set(codigos)], (kitId) => enfileirar(org, kitId), { soAutomaticos: false });
  }
  return n;
}

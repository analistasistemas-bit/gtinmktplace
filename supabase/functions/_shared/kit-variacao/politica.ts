// ADR-0199: quem pode escrever quantidade e reativar anúncio de SKU que participa de kit com variação.
// Participa o SKU de kit (`kit_variacao_skus`) e o individual usado em kit (`kit_variacao_componentes`).
// Org sem o módulo `kit_variacao` não faz consulta nova: o estado do módulo vem embutido na leitura de
// família que o caminho já faz (`EMBED_MODULOS`), e `skusParticipantes` sai antes de tocar o banco.
// Falha de leitura lança: quem chama não escreve, e o retry da fila repete.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { StatusAnuncioCanal } from '../canais/contrato.ts';
import { SemAcessoStatusML } from '../operacoes/ml-status.ts';
import { MSG_RECONECTAR } from '../operacoes/falhas.ts';

/** Acrescentar ao `select` de `familias` que o caminho já faz (FK única `familias_org_id_fkey`). */
export const EMBED_MODULOS = 'organizations(modulos_habilitados)';

/** Lê o módulo de uma linha de `familias` lida com `EMBED_MODULOS`. Sem o embed, desligado. */
export function kitLigado(familia: unknown): boolean {
  // PostgREST devolve objeto num to-one; o supabase-js sem tipos gerados o declara como lista. Aceita os dois.
  const org = (familia as { organizations?: unknown } | null)?.organizations;
  const m = ((Array.isArray(org) ? org[0] : org) as { modulos_habilitados?: unknown } | null | undefined)
    ?.modulos_habilitados;
  return Array.isArray(m) && m.includes('kit_variacao');
}

export async function skusParticipantes(
  admin: SupabaseClient, orgId: string, skus: string[], ligado: boolean,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ligado || skus.length === 0) return out;
  // ponytail: qualquer kit conta, inclusive rascunho; errar para o lado da saga só custa uma pausa de T.
  for (const tabela of ['kit_variacao_skus', 'kit_variacao_componentes']) {
    const { data, error } = await admin.from(tabela).select('codigo').eq('org_id', orgId).in('codigo', skus);
    if (error) throw new Error(`skusParticipantes: ${tabela}: ${error.message}`);
    for (const r of data ?? []) out.add(r.codigo as string);
  }
  return out;
}

export function podeEscreverQuantidade(p: { participa: boolean; origem: 'saga' | 'outro' }): boolean {
  return !p.participa || p.origem === 'saga';
}

export interface PoliticaSku {
  estado: 'normal' | 'guardado' | 'sobra';
  versao: number;
  bloqueio_operador: boolean;
  bloqueio_moderacao: boolean;
  bloqueio_retirada: boolean;
}

/** Política vigente por SKU. SKU sem linha não aparece no mapa (equivale a `null`, versão 0). */
export async function lerPoliticas(
  admin: SupabaseClient, orgId: string, skus: string[],
): Promise<Map<string, PoliticaSku>> {
  const { data, error } = await admin.from('sku_politica_kit')
    .select('codigo, estado, versao, bloqueio_operador, bloqueio_moderacao, bloqueio_retirada')
    .eq('org_id', orgId).in('codigo', skus);
  if (error) throw new Error(`sku_politica_kit: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.codigo as string, r as unknown as PoliticaSku]));
}

/**
 * Versão da política de cada SKU de kit entre `codigos`, capturada ao enfileirar a publicação (0 = sem
 * linha). A publicação compara sob a exclusão: mudou desde o enfileiramento, recusa.
 */
export async function versoesKit(
  admin: SupabaseClient, orgId: string, codigos: string[], ligado: boolean,
): Promise<Record<string, number>> {
  const participantes = [...await skusParticipantes(admin, orgId, codigos, ligado)];
  if (participantes.length === 0) return {};
  const politicas = await lerPoliticas(admin, orgId, participantes);
  return Object.fromEntries(participantes.map((c) => [c, politicas.get(c)?.versao ?? 0]));
}

export type DecisaoReativar = { pode: true } | { pode: false; motivo: string };

/** Moderação e retirada nunca são desfeitas; guardado não reativa; pausa do operador só ele desfaz. */
export function podeReativar(
  p: { politica: PoliticaSku | null; origem: 'saga' | 'operador' | 'automatico' },
): DecisaoReativar {
  const pol = p.politica;
  if (!pol) return { pode: true };
  if (pol.bloqueio_moderacao) return { pode: false, motivo: 'Anúncio moderado pelo Mercado Livre.' };
  if (pol.bloqueio_retirada) return { pode: false, motivo: 'SKU retirado.' };
  if (pol.estado === 'guardado') {
    return { pode: false, motivo: 'SKU guardado para kit. Desligue "Vender só em kit" para reativar o individual.' };
  }
  if (pol.bloqueio_operador && p.origem !== 'operador') return { pode: false, motivo: 'Pausado pelo operador.' };
  return { pode: true };
}

/** `kit_adquirir_exclusao`: o mesmo dono pode adquirir de novo, então o retry da publicação é idempotente. */
export async function adquirirExclusao(
  admin: SupabaseClient, orgId: string, codigos: string[], donoTipo: 'publicacao' | 'ativacao', donoId: string,
): Promise<{ ok: boolean; codigo?: string; motivo?: string }> {
  const { data, error } = await admin.rpc('kit_adquirir_exclusao', {
    p_org: orgId, p_codigos: codigos, p_dono_tipo: donoTipo, p_dono_id: donoId,
  });
  if (error) throw new Error(`kit_adquirir_exclusao: ${error.message}`);
  return data as { ok: boolean; codigo?: string; motivo?: string };
}

export async function soltarExclusao(admin: SupabaseClient, orgId: string, donoId: string): Promise<void> {
  const { error } = await admin.rpc('kit_soltar_exclusao', { p_org: orgId, p_dono_id: donoId });
  if (error) throw new Error(`kit_soltar_exclusao: ${error.message}`);
}

export const MSG_KIT_EM_TRANSFERENCIA =
  'SKU em transferência de kit com variação ou com ativação pendente. Tente de novo quando terminar.';
export const MSG_KIT_POLITICA_MUDOU = 'A política do kit deste SKU mudou agora. Tente de novo.';
export const MSG_KIT_MODERADO = 'Anúncio moderado ou encerrado no Mercado Livre: não é reativado.';
export const MSG_KIT_SEM_LEITURA = 'Não foi possível consultar o anúncio no Mercado Livre. Tente de novo.';
export const MSG_KIT_ATIVACAO_EM_CURSO = 'Reativação deste anúncio já em andamento. Tente de novo em alguns minutos.';
/** Prazo da geração: maior que o tempo de parede de uma edge, para a geração vencida estar de fato morta. */
const PRAZO_ATIVACAO_S = 600;

/** Resultado do PUT de status (`ResultadoCanal`): `erro.status` ausente = sem resposta HTTP. */
export interface ResultadoPutStatus { ok: boolean; erro?: { status?: number } }

/**
 * `concluir(resultado do PUT)`: `liberado` = exclusão solta (resultado definitivo e todos os alvos lidos); `status` = o
 * que cada alvo leu agora. Liberar não prova ativação: um 400 também libera. Ativo só pelo `status`.
 */
export interface Conclusao { liberado: boolean; status: Record<string, StatusAnuncioCanal | null> }
export type PreparoStatus =
  /** `retentar`: espera (outra geração da ativação no prazo), não bloqueio definitivo. */
  | { recusa: string; retentar?: boolean }
  | { criouBloqueio: boolean; concluir: (r: ResultadoPutStatus) => Promise<Conclusao> };
const NADA: PreparoStatus = { criouBloqueio: false, concluir: () => Promise.resolve({ liberado: true, status: {} }) };

export interface OpcoesStatusOperador {
  orgId: string;
  mlItemId: string;
  alvo: 'ativo' | 'pausado';
  /** Módulo `kit_variacao`, do embed `EMBED_MODULOS` de uma leitura que o caminho já faz. */
  ligado: boolean;
  /** Operação em massa que pausa: `criouBloqueio` diz se o bloqueio é dela (Reverter). */
  origem?: string;
  /** Status vivo estrito (`lerStatusMLEstrito`): null só em 404; 401/403 lança `SemAcessoStatusML`; o resto lança. */
  lerStatus: (itemId: string) => Promise<StatusAnuncioCanal | null>;
  /** Alerta durável ao operador (Telegram) quando a ativação fica sem confirmação. */
  alertar: (texto: string) => Promise<unknown>;
  /** Task 14: reativação pela automação (desfazer a pausa que ela fez). Pausa do operador recusa. */
  automatico?: boolean;
}

async function politicaOperador(
  admin: SupabaseClient, orgId: string, codigos: string[], bloquear: boolean,
  extra: { versoes?: Record<string, number>; origem?: string } = {},
): Promise<{ ok: boolean; criou: boolean }> {
  const { data, error } = await admin.rpc('kit_politica_operador', {
    p_org: orgId, p_codigos: codigos, p_bloquear: bloquear,
    ...(extra.versoes ? { p_versoes: extra.versoes } : {}), ...(extra.origem ? { p_origem: extra.origem } : {}),
  });
  if (error) throw new Error(`kit_politica_operador: ${error.message}`);
  const d = data as { ok?: boolean; criou?: boolean } | null;
  return { ok: d?.ok === true, criou: d?.criou === true };
}

/** Dono da exclusão `ativacao`, estável por (org, item): o retry e o novo clique retomam a mesma ativação. */
export async function donoAtivacao(orgId: string, mlItemId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ativacao:${orgId}:${mlItemId}`)));
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Sem resposta HTTP, 408, 429 ou 5xx: o ML pode ter aplicado (ou ainda aplicar) a escrita. */
const ambiguo = (r: ResultadoPutStatus) => !r.ok
  && (r.erro?.status === undefined || r.erro.status === 408 || r.erro.status === 429 || r.erro.status >= 500);

/**
 * Pausar/reativar pelo operador (individual, massa e Reverter), só para SKU participante.
 * - Pausar grava `bloqueio_operador` e incrementa a versão ANTES do PUT: a saga em curso perde a reativação.
 * - Reativar passa por `podeReativar` (origem operador), pela leitura viva estrita (moderado nunca; falha de
 *   leitura recusa com a causa), reivindica a execução (`kit_ativacao_reivindicar`: dono estável, geração própria),
 *   pega a exclusão `ativacao` e limpa o bloqueio só se a versão não mudou. Depois do PUT, `concluir` libera
 *   (só a geração dona) com resposta do ML não ambígua e leitura de todos os alvos; senão mantém e alerta.
 * Falha de leitura do banco lança: nada é ativado. Participante é sempre user product (Task 10).
 */
export async function prepararStatusOperador(admin: SupabaseClient, o: OpcoesStatusOperador): Promise<PreparoStatus> {
  const { orgId, mlItemId } = o;
  if (!o.ligado) return NADA;
  const { data, error } = await admin.from('anuncios_externos_itens').select('sku, item_externo_id, catalog_listing_id')
    .eq('org_id', orgId).or(`item_externo_id.eq.${mlItemId},catalog_listing_id.eq.${mlItemId}`);
  if (error) throw new Error(`anuncios_externos_itens: ${error.message}`);
  const linhas = (data ?? []) as Array<{ sku: string; item_externo_id: string | null; catalog_listing_id: string | null }>;
  const codigos = [...await skusParticipantes(admin, orgId, linhas.map((r) => r.sku), true)];
  if (codigos.length === 0) return NADA;

  if (o.alvo === 'pausado') {
    const r = await politicaOperador(admin, orgId, codigos, true, { origem: o.origem });
    return { criouBloqueio: r.criou, concluir: () => Promise.resolve({ liberado: true, status: {} }) };
  }

  const politicas = await lerPoliticas(admin, orgId, codigos);
  for (const c of codigos) {
    const d = podeReativar({ politica: politicas.get(c) ?? null, origem: o.automatico ? 'automatico' : 'operador' });
    if (!d.pode) return { recusa: d.motivo };
  }
  let vivo: StatusAnuncioCanal | null;
  try {
    vivo = await o.lerStatus(mlItemId);
  } catch (e) {
    return { recusa: e instanceof SemAcessoStatusML ? MSG_RECONECTAR : MSG_KIT_SEM_LEITURA };
  }
  if (vivo === null || vivo === 'indisponivel') return { recusa: MSG_KIT_SEM_LEITURA };
  if (vivo !== 'pausado' && vivo !== 'ativo') return { recusa: MSG_KIT_MODERADO };

  const dono = await donoAtivacao(orgId, mlItemId);
  const alvos = [...new Set([mlItemId, ...linhas.flatMap((r) => [r.item_externo_id, r.catalog_listing_id])
    .filter((x): x is string => !!x)])];
  // Reivindica a execução: o dono é estável (recuperação), a geração é desta tentativa. Outra execução viva do
  // mesmo dono recusa, então dois PUTs nunca correm juntos. A intenção nasce aqui, antes da exclusão: invocação
  // morta deixa rastro para a conferência diária, que só assume depois do prazo.
  const geracao = crypto.randomUUID();
  const { data: reiv, error: e1 } = await admin.rpc('kit_ativacao_reivindicar', {
    p_org: orgId, p_dono: dono, p_item: mlItemId, p_alvos: alvos, p_codigos: codigos, p_geracao: geracao,
    p_prazo_s: PRAZO_ATIVACAO_S,
  });
  if (e1) throw new Error(`kit_ativacao_reivindicar: ${e1.message}`);
  const claim = reiv as { ok?: boolean; anterior?: boolean } | null;
  if (claim?.ok !== true) return { recusa: MSG_KIT_ATIVACAO_EM_CURSO, retentar: true };
  /** Só a geração dona age: `apagar` solta exclusão e intenção juntas; senão só encerra o prazo. */
  const liberar = async (apagar: boolean): Promise<boolean> => {
    const { data: ok, error: e } = await admin.rpc('kit_ativacao_liberar', {
      p_org: orgId, p_dono: dono, p_geracao: geracao, p_apagar: apagar,
    });
    if (e) throw new Error(`kit_ativacao_liberar: ${e.message}`);
    return ok === true;
  };
  // Nada foi ao ML nesta tentativa; uma ativação anterior ainda incerta (mesmo dono) continua retida.
  const desistir = () => liberar(!claim.anterior);

  try {
    if (!(await adquirirExclusao(admin, orgId, codigos, 'ativacao', dono)).ok) {
      await desistir();
      return { recusa: MSG_KIT_EM_TRANSFERENCIA };
    }
    const versoes = Object.fromEntries(codigos.map((c) => [c, politicas.get(c)?.versao ?? 0]));
    if (!(await politicaOperador(admin, orgId, codigos, false, { versoes })).ok) {
      await desistir();
      return { recusa: MSG_KIT_POLITICA_MUDOU };
    }
  } catch (e) {
    await desistir().catch((x) => console.error('kit_ativacao_desistir_falhou', orgId, mlItemId, String(x)));
    throw e;
  }

  return {
    criouBloqueio: false,
    async concluir(r) {
      if (!ambiguo(r)) {
        try {
          const status: Record<string, StatusAnuncioCanal | null> = {};
          for (const id of alvos) status[id] = await o.lerStatus(id);   // lança = resultado não confirmado
          if (await liberar(true)) {
            // Task 14: item LIDO ativo depois da reativação do operador perde o registro de pausa da automação; uma
            // pausa posterior (inclusive fora do app) nunca é desfeita pela reposição. Recusa (400) ou leitura
            // pausada mantém o registro: a reposição ainda recupera. Falha aqui só loga: a rodada que vir o item
            // ativo também apaga.
            const ativos = alvos.filter((id) => status[id] === 'ativo');
            if (!o.automatico && ativos.length > 0) {
              const { error: ep } = await admin.from('kit_pausas_automaticas').delete().eq('org_id', orgId).in('item_id', ativos);
              if (ep) console.error('kit_pausa_registro_nao_apagado', orgId, mlItemId, ep.message);
            }
            return { liberado: true, status };
          }
          // Outra geração assumiu (prazo vencido): ela confirma e libera.
          console.error('kit_ativacao_geracao_perdida', orgId, mlItemId, geracao);
          return { liberado: false, status };
        } catch (e) {
          console.error('kit_ativacao_sem_confirmacao', orgId, mlItemId, String(e));
        }
      }
      await o.alertar(`Kit com variação: a reativação de ${mlItemId} (${codigos.join(', ')}) não foi confirmada no `
        + 'Mercado Livre. O SKU segue reservado: confira o anúncio e clique em Reativar de novo.')
        .catch((e) => console.error('kit_ativacao_alerta_falhou', orgId, mlItemId, String(e)));
      return { liberado: false, status: {} };
    },
  };
}

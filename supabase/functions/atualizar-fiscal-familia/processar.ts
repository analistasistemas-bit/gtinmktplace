// ADR-0135 D-9 — edição fiscal de família existente (o "modo edição" que faltava).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { camposFiscaisFaltantes, UNIDADES_FISCAIS } from '../_shared/fiscal/validar.ts';
import { lerRegimeFiscalOrg } from '../_shared/fiscal/regime.ts';
import { mensagemNcm, ncmsInvalidos } from '../_shared/fiscal/ncm-oficial.ts';

export interface EntradaFiscal {
  familiaId: string;
  fiscal: {
    ncm: string; cest?: string | null; origemNfe: number;
    fci?: string | null; exTipi?: string | null; tributacaoIcms: string;
    // Ruling do controller (Task 13): o payload fiscal nunca editava `unidade`, então família
    // legada com unidade fora de UNIDADES_FISCAIS travava a fila sem saída (camposFiscaisFaltantes
    // reprova para sempre a mesma unidade inválida gravada). Opcional: ausente = comportamento
    // intacto (usa `familia.unidade`); presente = valida contra a whitelist e grava.
    unidade?: string;
    /** ADR-0181 D-5: ausente = não altera; null/'' = limpa (title volta ao nome_pai). */
    descricaoFiscal?: string | null;
  };
}
export interface DepsAtualizarFiscal {
  admin: SupabaseClient;
  orgId: string;
  enfileirarPush: (familiaId: string) => Promise<string>;
}
export type ResultadoFiscal =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'invalido'; erros: string[] }
  | { tipo: 'falha'; mensagem: string }
  /** `versoesPublicadas`: null = leitura das versões publicadas falhou (M3). */
  | { tipo: 'ok'; pushEnfileirado: boolean; versoesPublicadas: number | null };

// Fronteira de confiança (index.ts): shape mínimo antes de tocar `entrada.fiscal.*` — sem isto
// um body sem `fiscal` explode em TypeError cru (sem CORS/JSON) e um body sem `familiaId` vira
// `.eq('id', undefined)` (500 em vez de 400).
export function validarShapeEntrada(body: unknown): string | null {
  const b = body as Partial<EntradaFiscal> | null;
  const valido = !!b && typeof b.familiaId === 'string' && b.familiaId.length > 0
    && typeof b.fiscal === 'object' && b.fiscal !== null;
  if (!valido) return 'familiaId (string) e fiscal (objeto) são obrigatórios';
  // Fix round 1 (I3): `fiscal.unidade` é opcional, mas se vier tem que ser string — sem isto
  // `unidade: 5` chegava intacto até `.toUpperCase()` em processarAtualizacaoFiscal e estourava
  // TypeError cru (500) em vez de um 400 de validação.
  const unidade = (b.fiscal as { unidade?: unknown }).unidade;
  if (unidade !== undefined && typeof unidade !== 'string') return 'fiscal.unidade deve ser string';
  const descricao = (b.fiscal as { descricaoFiscal?: unknown }).descricaoFiscal;
  if (descricao != null && typeof descricao !== 'string') return 'fiscal.descricaoFiscal deve ser string ou null';
  return null;
}

export async function processarAtualizacaoFiscal(
  deps: DepsAtualizarFiscal, entrada: EntradaFiscal,
): Promise<ResultadoFiscal> {
  const { admin, orgId } = deps;
  const { data: familia, error: familiaErro } = await admin.from('familias')
    .select('id, org_id, codigo_pai, nome_pai, unidade, origem, ml_item_id, status')
    .eq('id', entrada.familiaId).eq('org_id', orgId).maybeSingle();
  // Erro de leitura NUNCA vira decisão: sem isto, uma falha transitória do select cairia no
  // `!familia` abaixo e devolveria 404 "não encontrada" para uma família que existe.
  if (familiaErro) return { tipo: 'falha', mensagem: familiaErro.message };
  if (!familia) return { tipo: 'nao_encontrada' };

  // A3 (auditoria fiscal 19/10): regime nunca presumido (decide CSOSN vs CST e entra gravado em
  // `tributacao_icms_regime`, incidente ORIGEM/ADR-0055). Erro de leitura = falha; ausência/normal = inválido.
  let regime: 'simples';
  try { regime = await lerRegimeFiscalOrg(admin, orgId); }
  catch (e) {
    if ((e as { status?: number }).status === 400) return { tipo: 'invalido', erros: [(e as Error).message] };
    return { tipo: 'falha', mensagem: (e as Error).message };
  }

  const f = entrada.fiscal;

  let unidadeEfetiva: string | null = familia.unidade;
  if (f.unidade !== undefined) {
    const normalizada = f.unidade.toUpperCase().trim();
    if (!(UNIDADES_FISCAIS as readonly string[]).includes(normalizada)) {
      return { tipo: 'invalido', erros: [`unidade fiscal (use uma de: ${UNIDADES_FISCAIS.join(', ')})`] };
    }
    unidadeEfetiva = normalizada;
  }

  const erros = camposFiscaisFaltantes({
    ncm: f.ncm ?? null, cest: f.cest ?? null, origem_nfe: f.origemNfe ?? null,
    fci: f.fci ?? null, ex_tipi: f.exTipi ?? null,
    tributacao_icms: f.tributacaoIcms ?? null, tributacao_icms_regime: regime,
    unidade: unidadeEfetiva, origem: familia.origem,
  }, regime);
  if (erros.length) return { tipo: 'invalido', erros };

  // ADR-0187: NCM precisa existir e estar vigente na tabela oficial. Falha de leitura é
  // 'falha' (fail-closed), nunca "válido".
  try {
    const invalidos = await ncmsInvalidos(admin, [f.ncm]);
    if (invalidos.length) return { tipo: 'invalido', erros: invalidos.map(mensagemNcm) };
  } catch (e) {
    return { tipo: 'falha', mensagem: (e as Error).message };
  }

  // ADR-0181 D-5: chave ausente (cliente antigo) não mexe na coluna.
  const temDescricao = 'descricaoFiscal' in f;
  const descricaoFiscal = (f.descricaoFiscal ?? '').trim() || null;
  if (descricaoFiscal && descricaoFiscal.length > 120) {
    return { tipo: 'invalido', erros: ['descrição fiscal: até 120 caracteres'] };
  }

  // Todas as versões do produto (org_id + codigo_pai): o Estoque edita a família mais nova, mas
  // cópia (adicionar-variacoes-familia) e publicação leem a última PUBLICADA — gravar só a editada
  // deixava a publicada com NCM inválido. Kits têm outro codigo_pai e não entram.
  const { error } = await admin.from('familias').update({
    ncm: f.ncm, cest: f.cest?.trim() || null, origem_nfe: f.origemNfe,
    fci: f.fci?.trim() || null, ex_tipi: f.exTipi?.trim() || null,
    tributacao_icms: f.tributacaoIcms, tributacao_icms_regime: regime,
    ...(f.unidade !== undefined ? { unidade: unidadeEfetiva } : {}),
    ...(temDescricao ? { descricao_fiscal: descricaoFiscal } : {}),
    // C4 (auditoria fiscal 19/10): edição invalida o push anterior; o worker conclui de novo.
    fiscal_sincronizado_em: null,
    atualizado_em: new Date().toISOString(),
  }).eq('org_id', orgId).eq('codigo_pai', familia.codigo_pai);
  if (error) return { tipo: 'falha', mensagem: error.message };

  // C3 (auditoria fiscal 19/10): o UPDATE acima grava TODAS as versões do produto, então o push
  // vale pra TODAS as publicadas — a editada (a mais nova) pode estar `pronto` enquanto a antiga,
  // no ar, ficava sem push. Enfileira por `status === 'publicado'`, não por `ml_item_id`: serve
  // Legacy e UP (o worker resolve a rota; UP marca `publicado` sem preencher `ml_item_id`).
  // Falha de leitura/enqueue nunca desfaz a gravação: loga e devolve pushEnfileirado=false.
  let pushEnfileirado = false;
  let versoesPublicadas: number | null = null;
  const { data: publicadas, error: publicadasErro } = await admin.from('familias').select('id')
    .eq('org_id', orgId).eq('codigo_pai', familia.codigo_pai).eq('status', 'publicado');
  if (publicadasErro) {
    console.error('versões publicadas não listadas (push fiscal não enfileirado):', publicadasErro.message);
  } else {
    versoesPublicadas = (publicadas ?? []).length;
  }
  if (versoesPublicadas) {
    let todas = true;
    for (const p of publicadas as Array<{ id: string }>) {
      try { await deps.enfileirarPush(p.id); }
      catch (e) { todas = false; console.error('push fiscal não enfileirado:', (e as Error).message); }
    }
    pushEnfileirado = todas;
  }
  return { tipo: 'ok', pushEnfileirado, versoesPublicadas };
}

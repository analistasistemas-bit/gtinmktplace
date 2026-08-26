// ADR-0135 D-9 — edição fiscal de família existente (o "modo edição" que faltava).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { camposFiscaisFaltantes, UNIDADES_FISCAIS } from '../_shared/fiscal/validar.ts';

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
  | { tipo: 'ok'; pushEnfileirado: boolean };

// Fronteira de confiança (index.ts): shape mínimo antes de tocar `entrada.fiscal.*` — sem isto
// um body sem `fiscal` explode em TypeError cru (sem CORS/JSON) e um body sem `familiaId` vira
// `.eq('id', undefined)` (500 em vez de 400).
export function validarShapeEntrada(body: unknown): string | null {
  const b = body as Partial<EntradaFiscal> | null;
  const valido = !!b && typeof b.familiaId === 'string' && b.familiaId.length > 0
    && typeof b.fiscal === 'object' && b.fiscal !== null;
  return valido ? null : 'familiaId (string) e fiscal (objeto) são obrigatórios';
}

export async function processarAtualizacaoFiscal(
  deps: DepsAtualizarFiscal, entrada: EntradaFiscal,
): Promise<ResultadoFiscal> {
  const { admin, orgId } = deps;
  const { data: familia, error: familiaErro } = await admin.from('familias')
    .select('id, org_id, nome_pai, unidade, origem, ml_item_id, status')
    .eq('id', entrada.familiaId).eq('org_id', orgId).maybeSingle();
  // Erro de leitura NUNCA vira decisão: sem isto, uma falha transitória do select cairia no
  // `!familia` abaixo e devolveria 404 "não encontrada" para uma família que existe.
  if (familiaErro) return { tipo: 'falha', mensagem: familiaErro.message };
  if (!familia) return { tipo: 'nao_encontrada' };

  const { data: emp, error: empErro } = await admin.from('empresa_fiscal')
    .select('regime_tributario').eq('org_id', orgId).maybeSingle();
  // Mesma regra: um erro aqui NÃO pode virar "regime simples" por default — é o campo que
  // decide CSOSN vs CST e entra gravado em `tributacao_icms_regime` (incidente ORIGEM/ADR-0055).
  if (empErro) return { tipo: 'falha', mensagem: empErro.message };
  const regime = (emp?.regime_tributario ?? 'simples') as 'simples' | 'normal';

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

  const { error } = await admin.from('familias').update({
    ncm: f.ncm, cest: f.cest?.trim() || null, origem_nfe: f.origemNfe,
    fci: f.fci?.trim() || null, ex_tipi: f.exTipi?.trim() || null,
    tributacao_icms: f.tributacaoIcms, tributacao_icms_regime: regime,
    ...(f.unidade !== undefined ? { unidade: unidadeEfetiva } : {}),
    atualizado_em: new Date().toISOString(),
  }).eq('id', familia.id);
  if (error) return { tipo: 'falha', mensagem: error.message };

  // Enfileira por `status === 'publicado'`, não por `ml_item_id`: o enqueue serve tanto Legacy
  // quanto UP (Task 7) e o worker resolve a rota sozinho. Famílias publicadas via UP marcam
  // `status='publicado'` (publicar-familia-up.ts / atualizar-familia-up.ts) sem necessariamente
  // preencher `familias.ml_item_id` — checar só esse campo perderia o push fiscal nesse caminho.
  let pushEnfileirado = false;
  if (familia.status === 'publicado') {
    try { await deps.enfileirarPush(familia.id); pushEnfileirado = true; }
    catch (e) { console.error('push fiscal não enfileirado:', (e as Error).message); }
  }
  return { tipo: 'ok', pushEnfileirado };
}

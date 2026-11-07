// ADR-0197: quem pode escrever quantidade e reativar anúncio de SKU que participa de kit com variação.
// Participa o SKU de kit (`kit_variacao_skus`) e o individual usado em kit (`kit_variacao_componentes`).
// Org sem o módulo `kit_variacao` não faz consulta nova: o estado do módulo vem embutido na leitura de
// família que o caminho já faz (`EMBED_MODULOS`), e `skusParticipantes` sai antes de tocar o banco.
// Falha de leitura lança: quem chama não escreve, e o retry da fila repete.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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

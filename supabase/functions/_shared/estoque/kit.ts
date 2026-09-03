// ADR-0151: resolvedor ÚNICO de origem de estoque. Todo site que lê ou escreve
// `variacoes.estoque` por `codigo` passa por aqui antes.
//
// O kit NÃO tem saldo próprio: `variacoes.estoque` dele fica em 0 para sempre e o saldo
// real é `floor(estoque_base / N)`, recalculado ao vivo. Sem esta resolução, `baixar_estoque`
// acharia a linha do próprio kit (saldo 0) e aplicaria delta 0 em silêncio — a base nunca
// seria debitada.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface OrigemEstoque {
  /** SKU cujo saldo é a verdade. Para kit, é o `codigo_pai` da base. */
  codigoCanonico: string;
  /** Quantas unidades da base uma unidade de venda deste SKU consome. 1 para SKU comum. */
  multiplicador: number;
  /** `codigo_pai` da família de kit, quando o SKU é de kit. `null` para SKU comum. */
  kitCodigoPai: string | null;
}

/** Saldo virtual do kit. Nunca negativo — o resto do sistema não aguenta negativo (D-8). */
export function saldoDoKit(estoqueBase: number, multiplicador: number): number {
  if (multiplicador <= 0) return 0;
  return Math.max(0, Math.floor(estoqueBase / multiplicador));
}

/**
 * ATENÇÃO — a âncora é a MESMA das RPCs de estoque (`order by f.criado_em desc limit 1`,
 * migration 20260729084329). Usar outra ordenação faria o resolvedor e o ledger discordarem
 * sobre qual família é canônica, e o saldo divergiria sem nenhum erro visível.
 *
 * Falha de leitura degrada para "SKU comum": pior é abortar a baixa de uma venda (a venda é
 * sagrada). O efeito de degradar é a baixa cair no próprio SKU do kit, que tem saldo 0 —
 * visível no ledger como `quantidade = 0`, não como saldo errado na base.
 */
export async function resolverOrigemEstoque(
  admin: SupabaseClient, orgId: string, codigo: string,
): Promise<OrigemEstoque> {
  const neutro: OrigemEstoque = { codigoCanonico: codigo, multiplicador: 1, kitCodigoPai: null };
  const { data, error } = await admin
    .from('variacoes')
    .select('familias!inner(codigo_pai, kit_base_codigo_pai, kit_multiplicador, criado_em)')
    .eq('org_id', orgId).eq('codigo', codigo)
    .order('criado_em', { referencedTable: 'familias', ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('resolver_origem_estoque_falhou', { orgId, codigo, erro: error.message });
    return neutro;
  }
  // deno-lint-ignore no-explicit-any
  const f = (data as any)?.familias;
  const fam = Array.isArray(f) ? f[0] : f;
  if (!fam || fam.kit_multiplicador == null || !fam.kit_base_codigo_pai) return neutro;
  return {
    codigoCanonico: fam.kit_base_codigo_pai as string,
    multiplicador: Number(fam.kit_multiplicador),
    kitCodigoPai: fam.codigo_pai as string,
  };
}

/**
 * ADR-0151 D-8 — a quantidade que vai ao ML.
 *
 * `variacoes.estoque` do kit nasce e permanece em 0 (o trigger `validar_variacao_no_tenant`
 * força isso no INSERT de lote manual com operacao='CREATE'). Publicar a coluna crua faria
 * cada kit, sem exceção, nascer com "0 em estoque" no ML. O valor correto é
 * floor(estoque_base / N), calculado no momento do CREATE/UPDATE.
 *
 * Família comum é devolvida sem cópia nem consulta extra — o caminho quente não paga nada.
 */
export async function aplicarEstoqueDerivado<T extends { codigo: string; estoque: number }>(
  admin: SupabaseClient,
  orgId: string,
  familia: { kit_base_codigo_pai: string | null; kit_multiplicador: number | null },
  variacoes: T[],
): Promise<T[]> {
  const n = familia.kit_multiplicador;
  const base = familia.kit_base_codigo_pai;
  if (n == null || !base) return variacoes;

  const { data: famBase } = await admin.from('familias')
    .select('id').eq('org_id', orgId).eq('codigo_pai', base)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!famBase) {
    // Base sumiu — a guard da Task 5 deveria ter impedido. Publicar 0 é o único valor
    // seguro: publicar a coluna crua daria o mesmo 0, e inventar saldo venderia o que
    // não existe. LOUD no log para o operador achar.
    console.error('kit_sem_familia_base', { orgId, base });
    return variacoes.map((v) => ({ ...v, estoque: 0 }));
  }
  const { data: varsBase } = await admin.from('variacoes')
    .select('estoque').eq('familia_id', famBase.id);
  // A UMA variação da base — nunca a soma. `baixar_estoque` decrementa UMA linha resolvida
  // por `(org_id, codigo)`; derivar de uma soma faria o publicado e o ledger falarem de
  // números diferentes no dia em que a trava de "só produto sem cor" (D-10) for afrouxada.
  if ((varsBase ?? []).length !== 1) {
    console.error('kit_com_base_multivariacao', { orgId, base, skus: (varsBase ?? []).length });
    return variacoes.map((v) => ({ ...v, estoque: 0 }));
  }
  const estoqueBase = (varsBase![0].estoque as number) ?? 0;
  const derivado = saldoDoKit(estoqueBase, n);
  return variacoes.map((v) => ({ ...v, estoque: derivado }));
}

export interface FamiliaKit {
  id: string;
  codigo_pai: string;
  kit_multiplicador: number;
}

/**
 * Definição ÚNICA de "kit vivo" no sistema inteiro. Os dois triggers da Task 5 e a RPC da
 * Task 9 usam exatamente esta mesma lista de status — se mudar aqui, mude nos três.
 *
 * `'pronto'` está na lista porque `remover-publicado` devolve a família para `'pronto'`
 * (`processar.ts:167-171`): um kit tirado do ML ainda vai publicar assim que alguém mandar,
 * então continua sendo uma reivindicação sobre o saldo da base. Para soltar o bloqueio de
 * verdade o operador precisa de `excluir-produto` (ADR-0113) depois do `remover-publicado`.
 *
 * `'erro'` fica de fora: um kit com CREATE falho não bloqueia adicionar cor à base. Buraco
 * conhecido e aceito — se o operador adicionar cor e depois reenviar o kit, as Tasks 3 e 4
 * logam `kit_com_base_multivariacao` e empurram 0, falhando LOUD.
 */
export const STATUS_KIT_VIVO = ['pronto', 'publicando', 'publicado'] as const;

/**
 * Famílias de kit vinculadas a uma base — canônica por `codigo_pai` (a mais recente de cada),
 * do jeito que o resto do sistema já resolve produto. Usada pelo fan-out do push (Task 3) e
 * pelo guard de app de `remover-publicado` (Task 5).
 */
export async function listarKitsVivos(
  admin: SupabaseClient, orgId: string, codigoPaiBase: string,
): Promise<FamiliaKit[]> {
  const { data, error } = await admin
    .from('familias')
    .select('id, codigo_pai, kit_multiplicador, criado_em')
    .eq('org_id', orgId).eq('kit_base_codigo_pai', codigoPaiBase)
    .not('kit_multiplicador', 'is', null)
    .in('status', STATUS_KIT_VIVO as unknown as string[])
    .order('criado_em', { ascending: false });
  if (error) {
    console.error('listar_kits_vivos_falhou', { orgId, codigoPaiBase, erro: error.message });
    return [];
  }
  // Uma linha por `codigo_pai`, a mais recente — mesma regra de canonicidade do resto.
  const porPai = new Map<string, FamiliaKit>();
  for (const r of data ?? []) {
    const pai = r.codigo_pai as string;
    if (porPai.has(pai)) continue;
    porPai.set(pai, {
      id: r.id as string, codigo_pai: pai, kit_multiplicador: Number(r.kit_multiplicador),
    });
  }
  return [...porPai.values()];
}

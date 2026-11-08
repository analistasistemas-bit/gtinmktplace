// Módulos por org, isolado do Deno.serve para teste (molde arquivar-org.ts).
import type { Resposta } from './marca-org.ts';

// Mesmos ids do registry do frontend (src/lib/modulos.ts) — manter em sincronia.
export const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal', 'promocoes', 'ads', 'extensao', 'kit_variacao', 'imagem_ia'];

/** ADR-0199: `chamar` é a RPC set_modulos_org_seguro, que trava a org, valida e grava numa transação:
 *  desligar `kit_variacao` com saldo ou saga aberta deixaria os dois sem dono. */
export async function gravarModulosOrg(
  chamar: () => PromiseLike<{ data: { ok: boolean; motivo?: string } | null; error: { message: string } | null }>,
): Promise<Resposta> {
  const { data, error } = await chamar();
  if (error) return { status: 400, body: { error: error.message } };
  if (!data?.ok) return { status: 409, body: { error: data?.motivo ?? 'Módulos não gravados.' } };
  return { status: 200, body: { ok: true } };
}

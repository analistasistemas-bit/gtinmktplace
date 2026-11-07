// Módulos por org, isolado do Deno.serve para teste (molde arquivar-org.ts).
import type { Resposta } from './marca-org.ts';

// Mesmos ids do registry do frontend (src/lib/modulos.ts) — manter em sincronia.
export const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal', 'promocoes', 'ads', 'extensao', 'kit_variacao', 'imagem_ia'];

/** ADR-0197: desligar `kit_variacao` deixaria saldo e saga sem dono. Null libera. */
export async function recusaDesligarKitVariacao(
  modulos: string[],
  consultar: () => PromiseLike<{ data: string | null; error: { message: string } | null }>,
): Promise<Resposta | null> {
  if (modulos.includes('kit_variacao')) return null;
  const { data, error } = await consultar();
  if (error) return { status: 500, body: { error: `Não foi possível conferir os kits: ${error.message}` } };
  return data ? { status: 409, body: { error: data } } : null;
}

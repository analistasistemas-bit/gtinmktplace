// ADR-0188 — "Editar marca" de um produto. Grava a marca (RPC transacional) e, se o produto está
// publicado, enfileira a sincronização no ML na hora. Nunca republica: o worker só faz PUT de BRAND.
import type { MarcaOrg } from '../_shared/categoria/marca-org.ts';

export interface EntradaEdicaoMarca {
  orgId: string;
  /** admin da org ou suporte `full` (mesma regra do Pausar, ADR-0060). */
  podeEditar: boolean;
  codigoPai: string;
  /** null = "usar a marca da org". */
  marca: string | null;
}

export interface DepsEdicaoMarca {
  lerMarcaOrg: (orgId: string) => Promise<MarcaOrg>;
  gravarMarca: (orgId: string, codigoPai: string, marca: string) => Promise<{ publicado: boolean; versao: number | null }>;
  enfileirar: (orgId: string, codigoPai: string, versao: number) => Promise<void>;
  marcarErro: (orgId: string, codigoPai: string, versao: number, erro: string) => Promise<void>;
  auditar: (resultado: 'succeeded' | 'failed' | 'denied') => Promise<void>;
}

type Resposta = { status: number; body: Record<string, unknown> };

export async function processarEdicaoMarca(deps: DepsEdicaoMarca, e: EntradaEdicaoMarca): Promise<Resposta> {
  if (!e.podeEditar) {
    await deps.auditar('denied');
    return { status: 403, body: { erro: 'Somente administradores podem editar a marca.' } };
  }
  if (!e.codigoPai) return { status: 400, body: { erro: 'codigo_pai obrigatório.' } };
  if (e.marca != null && !e.marca.trim()) return { status: 400, body: { erro: 'Informe a marca.' } };

  const org = await deps.lerMarcaOrg(e.orgId);
  if (!org.marcaPropria) return { status: 400, body: { erro: 'Organização sem marca própria.' } };
  const marca = e.marca?.trim() || org.marcaPadrao!;

  let gravado: { publicado: boolean; versao: number | null };
  try {
    gravado = await deps.gravarMarca(e.orgId, e.codigoPai, marca);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('MARCA_OCUPADO')) {
      return { status: 409, body: { erro: 'Produto em processamento ou publicação — tente de novo quando terminar.' } };
    }
    if (msg.includes('MARCA_INEXISTENTE')) return { status: 404, body: { erro: 'Produto não encontrado.' } };
    await deps.auditar('failed');
    return { status: 500, body: { erro: `Falha ao salvar a marca: ${msg}` } };
  }

  if (!gravado.publicado || gravado.versao == null) {
    await deps.auditar('succeeded');
    return { status: 200, body: { ok: true, publicado: false, status: null } };
  }
  try {
    await deps.enfileirar(e.orgId, e.codigoPai, gravado.versao);
  } catch (err) {
    // A marca já está salva no produto; o status durável mostra o erro e o card oferece "Reenviar".
    await deps.marcarErro(e.orgId, e.codigoPai, gravado.versao,
      `Falha ao enviar ao Mercado Livre: ${(err as Error).message}`).catch(() => {});
    await deps.auditar('succeeded');
    return { status: 200, body: { ok: true, publicado: true, status: 'erro' } };
  }
  await deps.auditar('succeeded');
  return { status: 200, body: { ok: true, publicado: true, status: 'pendente' } };
}

// ADR-0186 — corrige a marca de anúncios JÁ publicados de org com marca própria, sem republicar.
// Um PUT só de `attributes` (BRAND, e MANUFACTURER se o item já o tiver) por SKU; nunca preço,
// estoque, fotos, descrição, título ou status. Converge SKU a SKU (o certo é pulado — retry seguro)
// e para na 1ª divergência: o ML pode reagrupar a família UP ou mexer no status, e aí ninguém
// deve continuar escrevendo às cegas.
import type { MarcaOrg } from '../_shared/categoria/marca-org.ts';

export interface SincronizarMarcaJob { org_id: string; codigo_pai: string; dry_run?: boolean }

export interface AtributoLido { id: string; value_id?: string | null; value_name?: string | null }
export interface ItemLido { status: string; familyId: string | null; attrs: AtributoLido[] }
export interface AtributoMarca { id: string; value_name: string }

export interface DepsMarca {
  lerMarcaOrg: (orgId: string) => Promise<MarcaOrg>;
  portas: {
    listarFilhos: (orgId: string, codigoPai: string) => Promise<{ sku: string; itemId: string }[]>;
    lerItem: (itemId: string) => Promise<ItemLido>;
    putAtributos: (itemId: string, attrs: AtributoMarca[]) => Promise<void>;
    /** Grava o family_id vigente no vínculo local (`anuncios_externos_itens`) — só nos itens lidos. */
    gravarFamilyIdLocal: (orgId: string, itemIds: string[], familyId: string) => Promise<void>;
  };
}

export interface ResultadoMarca {
  dryRun: boolean;
  corrigidos: string[];
  jaCertos: string[];
  /** family_id único lido no ML no início da rodada (gravado no vínculo local, fora do dry_run). */
  familyId?: string;
  parouEm?: { sku: string | null; motivo: string };
}

const IDS_MARCA = ['BRAND', 'MANUFACTURER'];

/** Atributos de marca que precisam ir no PUT. Vazio = SKU já certo. BRAND ausente conta como
 *  divergente; MANUFACTURER só entra se o item já o tiver (não inventa atributo). */
function atributosACorrigir(item: ItemLido, marca: string): AtributoMarca[] {
  const alvo = marca.toLowerCase();
  return IDS_MARCA.filter((id) => {
    const a = item.attrs.find((x) => x.id === id);
    if (!a) return id === 'BRAND';
    return a.value_name?.trim().toLowerCase() !== alvo;
  }).map((id) => ({ id, value_name: marca }));
}

export async function processarSincronizacaoMarca(
  deps: DepsMarca, job: SincronizarMarcaJob,
): Promise<{ status: number; body: ResultadoMarca | { erro: string } }> {
  const org = await deps.lerMarcaOrg(job.org_id);
  if (!org.marcaPropria) return { status: 400, body: { erro: 'Organização sem marca própria' } };
  const marca = org.marcaPadrao!;

  const filhos = await deps.portas.listarFilhos(job.org_id, job.codigo_pai);
  if (filhos.length === 0) return { status: 400, body: { erro: 'Família sem SKUs publicados' } };

  // Lê TUDO antes de escrever: erro de rede aqui é transitório (500, o QStash retenta) e nada
  // foi alterado ainda.
  let lidos: ItemLido[];
  try {
    lidos = await Promise.all(filhos.map((f) => deps.portas.lerItem(f.itemId)));
  } catch (e) {
    return { status: 500, body: { erro: `leitura do ML falhou: ${(e as Error).message}` } };
  }

  const r: ResultadoMarca = { dryRun: !!job.dry_run, corrigidos: [], jaCertos: [] };
  const familyIds = new Set(lidos.map((l) => l.familyId));
  if (familyIds.has(null) || familyIds.size !== 1) {
    return { status: 200, body: { ...r, parouEm: { sku: null, motivo: 'family_id ausente ou divergente antes de qualquer PUT' } } };
  }
  const familyId = lidos[0].familyId!;
  r.familyId = familyId;
  // Trocar BRAND faz o ML reagrupar a família UP inteira num family_id NOVO, minutos depois do PUT
  // (medido no 00000064, 18/10 — a releitura logo após o PUT ainda mostra o antigo). Toda rodada
  // que lê os SKUs unificados grava o id vigente no vínculo local; rodar de novo depois da
  // convergência fecha o ciclo. Sem isso, a próxima cor nova acusaria "família desagrupada".
  if (!r.dryRun) {
    try {
      await deps.portas.gravarFamilyIdLocal(job.org_id, filhos.map((f) => f.itemId), familyId);
    } catch (e) {
      return { status: 500, body: { erro: `gravar family_id local falhou: ${(e as Error).message}` } };
    }
  }

  for (let i = 0; i < filhos.length; i++) {
    const { sku, itemId } = filhos[i];
    const antes = lidos[i];
    const attrs = atributosACorrigir(antes, marca);
    if (attrs.length === 0) { r.jaCertos.push(sku); continue; }
    if (r.dryRun) { r.corrigidos.push(sku); continue; }

    try {
      await deps.portas.putAtributos(itemId, attrs);
    } catch (e) {
      return { status: 200, body: { ...r, parouEm: { sku, motivo: `ML recusou o PUT: ${(e as Error).message}` } } };
    }
    let depois: ItemLido;
    try {
      depois = await deps.portas.lerItem(itemId);
    } catch (e) {
      return { status: 200, body: { ...r, parouEm: { sku, motivo: `releitura falhou após o PUT: ${(e as Error).message}` } } };
    }
    const motivo = atributosACorrigir(depois, marca).length > 0 ? 'marca não ficou certa após o PUT'
      : depois.familyId !== familyId ? `family_id mudou (${familyId} → ${depois.familyId})`
      : depois.status !== antes.status ? `status mudou (${antes.status} → ${depois.status})`
      : null;
    if (motivo) return { status: 200, body: { ...r, parouEm: { sku, motivo } } };
    r.corrigidos.push(sku);
  }
  return { status: 200, body: r };
}

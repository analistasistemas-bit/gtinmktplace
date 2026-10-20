// ADR-0186 — corrige a marca de anúncios JÁ publicados de org com marca própria, sem republicar.
// Um PUT só de `attributes` (BRAND, e MANUFACTURER se o item já o tiver) por SKU; nunca preço,
// estoque, fotos, descrição, título ou status. Converge SKU a SKU (o certo é pulado — retry seguro)
// e para na 1ª divergência: o ML pode reagrupar a família UP ou mexer no status, e aí ninguém
// deve continuar escrevendo às cegas.
export interface SincronizarMarcaJob {
  org_id: string; codigo_pai: string; dry_run?: boolean;
  /** ADR-0188: versão da edição (raiz `marca_sync_versao`); job de versão antiga não escreve. */
  versao?: number;
  /** Rodadas já feitas (reagendamento até a família UP convergir). */
  tentativa?: number;
}

export interface AtributoLido { id: string; value_id?: string | null; value_name?: string | null }
export interface ItemLido { status: string; familyId: string | null; attrs: AtributoLido[] }
export interface AtributoMarca { id: string; value_name: string }

export interface PortasRodada {
  listarFilhos: (orgId: string, codigoPai: string) => Promise<{ sku: string; itemId: string }[]>;
  lerItem: (itemId: string) => Promise<ItemLido>;
  putAtributos: (itemId: string, attrs: AtributoMarca[]) => Promise<void>;
  /** Grava o family_id vigente no vínculo local (`anuncios_externos_itens`) — só nos itens lidos. */
  gravarFamilyIdLocal: (orgId: string, itemIds: string[], familyId: string) => Promise<void>;
}

/** Raiz `particao=0` do anúncio + marca do produto vigente. null = produto não publicado. */
export interface EstadoMarca { raizId: string; versao: number; marca: string | null }
export type StatusMarca = 'pendente' | 'ok' | 'erro';

export interface DepsMarca {
  lerEstado: (orgId: string, codigoPai: string) => Promise<EstadoMarca | null>;
  adquirirLease: (raizId: string, ttlSegundos: number) => Promise<boolean>;
  liberarLease: (raizId: string) => Promise<void>;
  versaoAtual: (raizId: string) => Promise<number>;
  /** Condicional à versão: job antigo nunca sobrescreve o status de uma edição nova. */
  gravarStatus: (raizId: string, versao: number, status: StatusMarca, erro?: string) => Promise<void>;
  reagendar: (job: SincronizarMarcaJob, delaySegundos: number) => Promise<void>;
  portas: PortasRodada;
}

export interface ResultadoMarca {
  dryRun: boolean;
  corrigidos: string[];
  jaCertos: string[];
  /** family_id único lido no ML no início da rodada (gravado no vínculo local, fora do dry_run). */
  familyId?: string;
  /** `transitorio`: falha de rede/5xx/429 — reagenda em vez de virar erro definitivo. */
  parouEm?: { sku: string | null; motivo: string; transitorio?: boolean };
  /** Todos os SKUs já com a marca, mas o ML ainda não juntou a família (transição esperada). */
  convergindo?: boolean;
  /** Uma edição mais nova chegou no meio da rodada: este job para sem escrever. */
  versaoNova?: boolean;
}

const IDS_MARCA = ['BRAND', 'MANUFACTURER'];

const ehTransitorio = (e: unknown): boolean => {
  const st = (e as { status?: number }).status;
  return st == null || st === 429 || st >= 500;
};

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

type Resposta = { status: number; body: ResultadoMarca | { erro: string } | { ignorado: string } };

/** Uma passada pelos SKUs UP do produto: PUT só de BRAND(/MANUFACTURER) onde diverge, com conferência. */
export async function rodadaMarca(
  portas: PortasRodada, job: SincronizarMarcaJob, marca: string, versaoValida: () => Promise<boolean>,
): Promise<Resposta> {
  const deps = { portas };
  let filhos: { sku: string; itemId: string }[];
  try {
    filhos = await portas.listarFilhos(job.org_id, job.codigo_pai);
  } catch (e) {
    return { status: 500, body: { erro: `listar SKUs falhou: ${(e as Error).message}` } };
  }
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
  // Trocar BRAND faz o ML reagrupar os SKUs corrigidos numa família NOVA, segundos depois do PUT
  // (00000064 e 00000043, 18/10) — inclusive no meio da rodada. A transição esperada tem no máximo
  // 1 família antiga (SKUs com o fornecedor) e 1 nova (SKUs já com a marca da org). Id ausente,
  // segunda família de qualquer lado, ou família fora dessas duas = algo que não entendemos: para.
  const certo = lidos.map((l) => atributosACorrigir(l, marca).length === 0);
  const famCertos = new Set(lidos.filter((_, i) => certo[i]).map((l) => l.familyId));
  const famPendentes = new Set(lidos.filter((_, i) => !certo[i]).map((l) => l.familyId));
  if (famPendentes.size === 0 && famCertos.size > 1 && !famCertos.has(null)) {
    return { status: 200, body: { ...r, convergindo: true } };
  }
  if (famCertos.has(null) || famPendentes.has(null) || famCertos.size > 1 || famPendentes.size > 1) {
    return { status: 200, body: { ...r, parouEm: { sku: null, motivo: 'family_id ausente ou divergente antes de qualquer PUT' } } };
  }
  const familiaAntiga = [...famPendentes][0] as string | undefined;
  let familiaNova = [...famCertos][0] as string | undefined;
  if (familiaNova === familiaAntiga) familiaNova = undefined;

  // Família unificada: grava o id vigente no vínculo local — rodar de novo depois da convergência
  // fecha o ciclo. Sem isso, a próxima cor nova acusaria "família desagrupada".
  const unicas = new Set([...famCertos, ...famPendentes]);
  if (unicas.size === 1) {
    const familyId = [...unicas][0]!;
    r.familyId = familyId;
    if (!r.dryRun) {
      try {
        await deps.portas.gravarFamilyIdLocal(job.org_id, filhos.map((f) => f.itemId), familyId);
      } catch (e) {
        return { status: 500, body: { erro: `gravar family_id local falhou: ${(e as Error).message}` } };
      }
    }
  }

  // Depois do PUT o SKU fica na família em que estava ou passa para a nova; a 1ª nova vista vira a
  // referência das seguintes.
  const familiaInesperada = (antes: string | null, depois: string | null): boolean => {
    if (depois == null) return true;
    if (depois === antes || depois === familiaNova) return false;
    if (familiaNova === undefined) { familiaNova = depois; return false; }
    return true;
  };

  for (let i = 0; i < filhos.length; i++) {
    const { sku, itemId } = filhos[i];
    const antes = lidos[i];
    const attrs = atributosACorrigir(antes, marca);
    if (attrs.length === 0) { r.jaCertos.push(sku); continue; }
    if (r.dryRun) { r.corrigidos.push(sku); continue; }

    if (!(await versaoValida())) return { status: 200, body: { ...r, versaoNova: true } };
    try {
      await deps.portas.putAtributos(itemId, attrs);
    } catch (e) {
      return { status: 200, body: { ...r, parouEm: { sku, motivo: `ML recusou o PUT: ${(e as Error).message}`, transitorio: ehTransitorio(e) } } };
    }
    let depois: ItemLido;
    try {
      depois = await deps.portas.lerItem(itemId);
    } catch (e) {
      return { status: 200, body: { ...r, parouEm: { sku, motivo: `releitura falhou após o PUT: ${(e as Error).message}`, transitorio: true } } };
    }
    const motivo = atributosACorrigir(depois, marca).length > 0 ? 'marca não ficou certa após o PUT'
      : familiaInesperada(antes.familyId, depois.familyId) ? `family_id inesperado (${antes.familyId} → ${depois.familyId})`
      : depois.status !== antes.status ? `status mudou (${antes.status} → ${depois.status})`
      : null;
    if (motivo) return { status: 200, body: { ...r, parouEm: { sku, motivo } } };
    r.corrigidos.push(sku);
  }

  // Conferência final (achado Codex): a releitura por SKU não vê um SKU JÁ corrigido migrar para
  // outra família depois. Uma passada no fim — reler tudo a cada PUT custaria O(n²) GETs — garante
  // que nenhuma rodada termina "ok" com os corrigidos espalhados em mais de uma família nova.
  if (!r.dryRun && r.corrigidos.length > 0) {
    let finais: ItemLido[];
    try {
      finais = await Promise.all(filhos.map((f) => deps.portas.lerItem(f.itemId)));
    } catch (e) {
      return { status: 200, body: { ...r, parouEm: { sku: null, motivo: `conferência após a rodada falhou: ${(e as Error).message}`, transitorio: true } } };
    }
    const novas = new Set(finais.map((l) => l.familyId).filter((id) => id !== familiaAntiga));
    if (novas.has(null) || novas.size > 1) {
      return { status: 200, body: { ...r, parouEm: { sku: null, motivo: `após a rodada: SKUs em ${novas.size} famílias novas (${[...novas].join(', ')})` } } };
    }
  }
  return { status: 200, body: r };
}

const MAX_TENTATIVAS = 5;
const DELAY_CONVERGENCIA_S = 120;
const DELAY_LEASE_S = 30;
const TTL_LEASE_S = 300; // > timeout da edge
const MSG_NAO_CONVERGIU = 'A família do anúncio não convergiu no Mercado Livre depois de 5 tentativas.';
const MSG_LEGACY = 'Anúncio Legacy (sem SKUs User Products): a marca vai no próximo Atualizar.';

/** ADR-0188 — orquestra a sincronização da marca do produto: versão da edição, lease por produto,
 *  status durável e reagendamento até a família UP convergir (máx. 5 rodadas). */
export async function processarSincronizacaoMarca(deps: DepsMarca, job: SincronizarMarcaJob): Promise<Resposta> {
  let estado: EstadoMarca | null;
  try {
    estado = await deps.lerEstado(job.org_id, job.codigo_pai);
  } catch (e) {
    return { status: 500, body: { erro: `ler estado falhou: ${(e as Error).message}` } };
  }
  if (!estado) return { status: 400, body: { erro: 'Produto não publicado no Mercado Livre' } };
  const versao = job.versao ?? estado.versao;
  if (versao !== estado.versao) return { status: 200, body: { ignorado: 'versão antiga' } };
  const dry = !!job.dry_run;
  const raiz = estado.raizId;
  // Falha ao gravar o status propaga (→ 500, o QStash retenta; o job é idempotente): engolir aqui
  // deixaria a UI em "pendente" para sempre.
  const fim = async (status: StatusMarca, erro?: string) => {
    if (dry) return;
    await deps.gravarStatus(raiz, versao, status, erro);
  };
  const proximo = async (motivoSeEsgotar: string) => {
    const tentativa = (job.tentativa ?? 0) + 1;
    if (tentativa > MAX_TENTATIVAS) return fim('erro', motivoSeEsgotar);
    try {
      await deps.reagendar({ ...job, versao, tentativa }, DELAY_CONVERGENCIA_S);
      await fim('pendente');
    } catch (e) {
      await fim('erro', `Falha ao reagendar a sincronização: ${(e as Error).message}`);
    }
  };

  const marca = estado.marca?.trim();
  if (!marca) {
    await fim('erro', 'Produto sem marca definida.');
    return { status: 400, body: { erro: 'Produto sem marca definida' } };
  }
  if (dry) return rodadaMarca(deps.portas, job, marca, () => Promise.resolve(true));

  if (!(await deps.adquirirLease(raiz, TTL_LEASE_S))) {
    try { await deps.reagendar({ ...job, versao }, DELAY_LEASE_S); }
    catch (e) { await fim('erro', `Falha ao reagendar a sincronização: ${(e as Error).message}`); }
    return { status: 200, body: { ignorado: 'outra sincronização em andamento' } };
  }
  let res: Resposta;
  try {
    res = await rodadaMarca(deps.portas, job, marca, async () => (await deps.versaoAtual(raiz)) === versao);
  } finally {
    await deps.liberarLease(raiz).catch((e) => console.error('liberarLease marca falhou:', e));
  }

  try {
    const body = res.body;
    if ('ignorado' in body) return res;
    if ('erro' in body) {
      if (res.status === 400) await fim('erro', MSG_LEGACY);
      else await proximo(body.erro);
      return res;
    }
    if (body.versaoNova) return res;
    if (body.parouEm?.transitorio) { await proximo(body.parouEm.motivo); return res; }
    if (body.parouEm) { await fim('erro', body.parouEm.motivo); return res; }
    if (body.familyId && body.corrigidos.length === 0) { await fim('ok'); return res; }
    await proximo(MSG_NAO_CONVERGIU);
    return res;
  } catch (e) {
    return { status: 500, body: { erro: `gravar status falhou: ${(e as Error).message}` } };
  }
}

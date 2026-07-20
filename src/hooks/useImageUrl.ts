import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const BUCKET = 'imagens';
const TTL_S = 7 * 24 * 60 * 60; // 7 dias
const RENOVAR_ANTES_MS = 24 * 60 * 60 * 1000; // renova no último dia de validade
const STORE_KEY = 'publiai:img-urls:v1';

const chave = (path: string) => ['img-url', path] as const;

type Entrada = { url: string; expira: number };

function lerStore(): Record<string, Entrada> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Entrada>;
  } catch {
    return {};
  }
}

function gravarStore(store: Record<string, Entrada>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota estourada ou storage indisponível: seguir sem persistir (só perde o cache).
  }
}

/** Descarta a URL salva de um path. Chame ao trocar/remover a foto daquele path — junto com
 *  `qc.invalidateQueries({ queryKey: ['img-url', path] })` para a UI buscar a URL nova. */
export function invalidarImagem(qc: QueryClient, path: string | null | undefined): void {
  if (!path) return;
  const store = lerStore();
  delete store[path];
  gravarStore(store);
  qc.invalidateQueries({ queryKey: chave(path) });
}

/** Descarta todas as URLs guardadas. Chamada no logout — a URL assinada é bearer token e
 *  sobreviveria 7 dias ao fim da sessão. */
export function limparUrlsImagem(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // storage indisponível: nada a limpar.
  }
}

/** URL assinada da foto, reaproveitada por até 7 dias via localStorage (ADR-0081).
 *
 *  O bucket é privado, então a URL precisa de token. Antes o token era gerado a cada sessão:
 *  URL sempre diferente = cache de CDN e de navegador nunca acertava, e o bucket inteiro era
 *  rebaixado ~12x/mês (70% do egress da conta). Persistindo a URL, ela fica estável entre
 *  recargas e sessões, e o `cache-control: max-age=3600` dos objetos volta a valer.
 *
 *  Trocar a foto reusa o mesmo path; `invalidarImagem` força um token novo, que por ser uma URL
 *  diferente também fura o cache do navegador. */
export async function resolverUrlImagem(path: string): Promise<string> {
  const cached = lerStore()[path];
  if (cached && cached.expira > Date.now()) return cached.url;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_S);
  if (error) throw error;

  // Relê o store AQUI, depois do await. Entre este lerStore e o gravarStore não há await, então
  // nenhuma chamada concorrente intercala. Reaproveitar o store lido lá em cima perdia quase
  // todas as entradas quando a tela carrega N fotos de uma vez: todas liam o estado vazio e
  // cada uma gravava o objeto inteiro por cima — só a última sobrevivia, e o cache nunca enchia.
  const agora = Date.now();
  const store = lerStore();
  for (const [k, v] of Object.entries(store)) if (v.expira <= agora) delete store[k];
  store[path] = { url: data.signedUrl, expira: agora + TTL_S * 1000 - RENOVAR_ANTES_MS };
  gravarStore(store);
  return data.signedUrl;
}

export function useImageUrl(path: string | undefined | null) {
  return useQuery({
    queryKey: chave(path ?? ''),
    enabled: !!path,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: () => resolverUrlImagem(path!),
  });
}

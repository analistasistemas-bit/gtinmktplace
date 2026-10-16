// ADR-0181 Plano 2b-1 — fonte das compras: notas do mês (RLS + org) e XMLs do bucket com hash dos BYTES.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import type { NotaCompraRow, XmlCompra } from './tipos-compras';

const COLS = 'id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, assinada, xml_path, xml_sha256, status, importada_em, desfeita_em, divergencia_total_aceita';
const TIMEOUT_MS = 30_000;
const CONCORRENCIA = 4;

/** Limites do mês em America/Sao_Paulo. */
// ponytail: offset fixo −03:00 (sem horário de verão desde 2019). Upgrade se voltar: Intl com timeZone.
export function limitesMesSP(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: new Date(`${mes}-01T00:00:00-03:00`).toISOString(), ate: new Date(`${prox}-01T00:00:00-03:00`).toISOString() };
}

type Pagina = PromiseLike<{ data: NotaCompraRow[] | null; error: { message: string } | null }>;
export async function listarNotasCompraMes(mes: string, org: string): Promise<NotaCompraRow[]> {
  const { de, ate } = limitesMesSP(mes);
  return buscarTodasPaginas<NotaCompraRow>((ini, fim) => supabase.from('notas_compra').select(COLS)
    .eq('org_id', org).gte('emitida_em', de).lt('emitida_em', ate)
    .order('emitida_em').order('id').range(ini, fim) as unknown as Pagina);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

const abortErr = () => new DOMException('cancelado', 'AbortError');

/** Um XML: download + leitura + hash sob o MESMO prazo e cancelamento; falha vira dado, só o abort externo rejeita. */
export async function baixarXmlCompra(nota: NotaCompraRow, signal: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<XmlCompra> {
  if (signal.aborted) throw abortErr();
  if (!nota.xml_sha256 || !/^[0-9a-f]{64}$/.test(nota.xml_sha256)) return { tipo: 'sem_hash' };
  const ctl = new AbortController();
  const repassar = () => ctl.abort();
  signal.addEventListener('abort', repassar, { once: true });
  let esgotou = false;
  const timer = setTimeout(() => { esgotou = true; ctl.abort(); }, timeoutMs);
  const parado = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(abortErr()), { once: true }));
  parado.catch(() => {});
  try {
    const trabalho = (async (): Promise<XmlCompra> => {
      const r = await supabase.storage.from('notas-compra').download(nota.xml_path, undefined, { signal: ctl.signal });
      if (r.error || !r.data) return { tipo: 'indisponivel', motivo: r.error?.message ?? 'XML não encontrado' };
      const bytes = new Uint8Array(await r.data.arrayBuffer());   // bytes: nunca blob.text() no caminho do hash (BOM)
      return (await sha256Hex(bytes)) === nota.xml_sha256 ? { tipo: 'ok', bytes } : { tipo: 'divergente' };
    })();
    trabalho.catch(() => {});
    const res = await Promise.race([trabalho, parado]);
    if (signal.aborted) throw abortErr();
    return res;
  } catch (e) {
    if (signal.aborted) throw abortErr();
    if (esgotou) return { tipo: 'indisponivel', motivo: 'tempo esgotado' };
    return { tipo: 'indisponivel', motivo: e instanceof Error ? e.message : 'falha ao baixar o XML' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', repassar);
    ctl.abort();   // derruba o request perdedor (não fica rodando além dos 4)
  }
}

export async function baixarXmlsCompra(
  notas: NotaCompraRow[], signal: AbortSignal, onProgresso?: (feitos: number, total: number) => void,
  concorrencia = CONCORRENCIA, timeoutMs = TIMEOUT_MS,
): Promise<Map<string, XmlCompra>> {
  if (signal.aborted) throw abortErr();
  const out = new Map<string, XmlCompra>();
  let i = 0; let feitos = 0;
  const trabalhador = async () => {
    while (i < notas.length) {
      if (signal.aborted) throw abortErr();
      const n = notas[i++];
      out.set(n.id, await baixarXmlCompra(n, signal, timeoutMs));
      onProgresso?.(++feitos, notas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, notas.length) }, trabalhador));
  return out;
}

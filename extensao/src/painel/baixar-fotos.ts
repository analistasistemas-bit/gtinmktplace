// Baixar fotos do anúncio em ZIP (ADR-0189 D-10, Task 19). Roda no painel: fetch no mlstatic (CORS `*`, sem permissão
// nova), uma foto por vez, com teto de tempo e de bytes; ZIP sem compressão (JPEG já é comprimido). Clips ficam fora:
// são HLS e o ML os casa por algoritmo (podem ser de outro criador).
import { zipSync } from 'fflate';
import { ID_FOTO } from '../compartilhado/qualidade';

export const MAX_FOTOS = 20;
export const TEMPO_POR_FOTO_MS = 15_000;
export const MAX_BYTES_FOTO = 10 * 2 ** 20;
export const MAX_BYTES_TOTAL = 100 * 2 ** 20;

/** Resolução cheia em JPEG (medido 22/10: `-F` = original; `-O` = 500 px). Host fixo, id validado antes. */
export const urlDaFoto = (id: string) => `https://http2.mlstatic.com/D_${id}-F.jpg`;

export interface ResultadoZip {
  zip: Uint8Array | null; // null = nenhuma foto passou
  incluidas: number;
  falhas: number[]; // posições (1-based) que não vieram
  alemDoLimite: number; // fotos além de MAX_FOTOS
  alemDoTamanho: number; // fotos que não couberam no teto total de bytes
}

/** Lê o corpo contando os bytes de fato recebidos (Content-Length pode faltar). Passou do teto → 'excedeu'. */
async function lerAte(r: Response, max: number): Promise<Uint8Array | 'excedeu' | null> {
  if (!r.body) return null;
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await leitor.cancel().catch(() => {}); return 'excedeu'; }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { tudo.set(p, i); i += p.byteLength; }
  return tudo;
}

const HOST_FOTOS = 'http2.mlstatic.com';
// Início SOI (FF D8 FF) e fim EOI (FF D9) nos últimos bytes: corpo truncado ou de erro não entra como foto.
const ehJpeg = (b: Uint8Array) => {
  if (b.length < 128 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return false;
  for (let i = b.length - 2; i >= b.length - 32; i--) if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
  return false;
};

async function baixarUma(id: string, sinal: AbortSignal, buscar: typeof fetch, restante: number): Promise<Uint8Array | 'excedeu' | null> {
  const tempo = AbortSignal.timeout(TEMPO_POR_FOTO_MS); // inclui a leitura do corpo
  try {
    const r = await buscar(urlDaFoto(id), { credentials: 'omit', signal: AbortSignal.any([sinal, tempo]) });
    // Redirect para fora do mlstatic ou erro: descarta sem ler o corpo.
    if (!r.ok || (r.url && new URL(r.url).host !== HOST_FOTOS)) { await r.body?.cancel().catch(() => {}); return null; }
    const dados = await lerAte(r, Math.min(MAX_BYTES_FOTO, restante));
    return dados === 'excedeu' ? 'excedeu' : dados && ehJpeg(dados) ? dados : null;
  } catch {
    if (sinal.aborted) throw sinal.reason; // cancelado pelo usuário: para tudo
    return null;
  }
}

/** Fotos na ordem da galeria → ZIP `01.jpg`, `02.jpg`… (a numeração mantém a posição original mesmo com falhas). */
export async function montarZipDeFotos(ids: string[], opcoes: {
  sinal: AbortSignal; buscar?: typeof fetch; aoProgresso?: (feitas: number, total: number) => void; tetoTotal?: number; // tetoTotal: só testes
}): Promise<ResultadoZip> {
  const buscar = opcoes.buscar ?? fetch.bind(globalThis);
  const teto = opcoes.tetoTotal ?? MAX_BYTES_TOTAL;
  const alvo = ids.slice(0, MAX_FOTOS);
  let alemDoTamanho = 0;
  const arquivos: Record<string, Uint8Array> = {};
  const falhas: number[] = [];
  let total = 0;
  for (let i = 0; i < alvo.length; i++) {
    const posicao = i + 1;
    const restante = teto - total;
    const dados = ID_FOTO.test(alvo[i]) ? await baixarUma(alvo[i], opcoes.sinal, buscar, restante) : null;
    // Estourou o que resta do ZIP (não o teto da foto): esta e as seguintes ficam de fora pelo tamanho total.
    if (dados === 'excedeu' && restante < MAX_BYTES_FOTO) { alemDoTamanho = alvo.length - i; break; }
    if (dados instanceof Uint8Array) { arquivos[`${String(posicao).padStart(2, '0')}.jpg`] = dados; total += dados.byteLength; } else falhas.push(posicao);
    opcoes.aoProgresso?.(posicao, alvo.length);
  }
  const incluidas = Object.keys(arquivos).length;
  return { zip: incluidas ? zipSync(arquivos, { level: 0 }) : null, incluidas, falhas, alemDoLimite: ids.length - alvo.length, alemDoTamanho };
}

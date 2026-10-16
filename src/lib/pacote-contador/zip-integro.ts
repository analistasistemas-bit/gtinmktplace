// ADR-0181 Plano 2a — abre o zip inteiro e confere estrutura, tamanho e CRC32 de cada entrada.
// fflate não confere CRC no unzip: CRC esperado vem do diretório central, lido aqui.
import { unzipSync } from 'fflate';
import { ErroDownloadIncompleto } from './tipos';

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = TABELA[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

/** nome → CRC32 do diretório central. Nome decodificado como o fflate: UTF-8 com o bit 11, senão latin1. */
// ponytail: sem ZIP64 (zips do ML medidos ≤ 12 MB / ~2.700 entradas). Upgrade: ler o EOCD64 se aparecer.
function crcsDoDiretorio(b: Uint8Array): Map<string, number> {
  const utf8 = new TextDecoder();
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) !== 0x06054b50) continue;
    const totalDisco = u16(b, i + 8), total = u16(b, i + 10), tamanhoDir = u32(b, i + 12);
    let p = u32(b, i + 16);
    // Contagens do EOCD têm de bater e o diretório tem de terminar exatamente onde o EOCD começa
    // (o fflate usa +8; contagem adulterada omitiria notas em silêncio).
    if (totalDisco !== total || p + tamanhoDir !== i) throw new ErroDownloadIncompleto();
    const m = new Map<string, number>();
    for (let k = 0; k < total; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new ErroDownloadIncompleto();
      const flags = u16(b, p + 8), crc = u32(b, p + 16), ln = u16(b, p + 28), le = u16(b, p + 30), lc = u16(b, p + 32);
      const bytesNome = b.subarray(p + 46, p + 46 + ln);
      m.set(flags & 0x800 ? utf8.decode(bytesNome) : latin1(bytesNome), crc);
      p += 46 + ln + le + lc;
    }
    if (p !== i || m.size !== total) throw new ErroDownloadIncompleto();
    return m;
  }
  throw new ErroDownloadIncompleto();
}

export function abrirZipIntegro(bytes: Uint8Array): Record<string, Uint8Array> {
  const crcs = crcsDoDiretorio(bytes);
  const declarado: Record<string, number> = {};
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes, { filter: (f) => { declarado[f.name] = f.originalSize; return true; } });
  } catch {
    throw new ErroDownloadIncompleto();
  }
  if (Object.keys(arquivos).length !== crcs.size) throw new ErroDownloadIncompleto();
  for (const [nome, dados] of Object.entries(arquivos)) {
    if (dados.length !== declarado[nome] || crcs.get(nome) !== crc32(dados)) throw new ErroDownloadIncompleto();
  }
  return Object.fromEntries(Object.entries(arquivos).filter(([n]) => !n.endsWith('/')));
}

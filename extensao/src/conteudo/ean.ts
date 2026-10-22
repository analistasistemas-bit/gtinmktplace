// EAN digitado na busca do ML (ADR-0189). Puro: o content script só o registra no SW da aba.
const COMPRIMENTOS = new Set([8, 12, 13, 14]);

function checksumOk(d: string): boolean {
  let soma = 0;
  for (let i = 0; i < d.length - 1; i++) soma += Number(d[d.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]);
}

/** Primeiro segmento do path de lista.mercadolivre.com.br, se for GTIN com dígito verificador válido. */
export function eanDaUrlDeBusca(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'lista.mercadolivre.com.br') return null;
  // Sufixos do ML vêm após `_` (ex.: `7899941205918_NoIndex_True`).
  let seg: string;
  try {
    seg = decodeURIComponent(u.pathname.split('/')[1] ?? '').split('_')[0];
  } catch {
    return null;
  }
  return /^\d+$/.test(seg) && COMPRIMENTOS.has(seg.length) && checksumOk(seg) ? seg : null;
}

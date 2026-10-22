// "Quanto vende" observado (ADR-0189 D-9 + emenda 2026-10-22). Faixa e data vêm do HTML de
// produto.mercadolivre.com.br/MLB-{id}, que é do anúncio; a faixa de /p/ e /up/ é agregada (catálogo / produto do
// vendedor) e não serve para ritmo. Sem data → só a faixa; nada é estimado nem presumido aqui.

export type Semaforo = 'verde' | 'amarelo' | 'vermelho';

export interface QuantoVende {
  piso: number | null;
  criadoEm: string | null;
  dias: number | null;
  semaforo: Semaforo | null;
  minimoPorMes: number | null;
  minimoPorDia: number | null;
}

const DIA = 86_400_000;
const MES_DIAS = 365.25 / 12;

/** Piso da faixa pública: "+1000 vendidos" → 1000, "+2,5 mil vendidos" → 2500. Ilegível → null. */
export function pisoDosVendidos(texto: string | null): number | null {
  const m = texto?.match(/(\d[\d.,]*)\s*(mil\s+)?vendidos?/i);
  if (!m) return null;
  const n = m[2] ? Number(m[1].replace(/\./g, '').replace(',', '.')) * 1000 : Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** `startTime` do `gtm_event` do HTML de `produto.mercadolivre.com.br/MLB-{id}`, só se o evento é do item pedido. */
export function startTimeDoHtml(html: string, mlItemId: string): string | null {
  const ini = html.indexOf('"gtm_event":{');
  if (ini < 0) return null;
  // Só o objeto do evento (chaves balanceadas, ignorando as de dentro de strings): data de outro objeto nunca vale.
  let fim = -1;
  for (let i = ini + 12, prof = 0, str = false; i < html.length && i < ini + 20_000; i++) {
    const c = html[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) { fim = i; break; }
  }
  if (fim < 0) return null;
  const ev = html.slice(ini, fim + 1);
  if (ev.match(/"itemId":"(MLB\d+)"/)?.[1] !== mlItemId) return null;
  return ev.match(/"startTime":"([^"]+)"/)?.[1] ?? null;
}

/** "N vendidos" do subtitle do HTML do anúncio (o mesmo de `startTimeDoHtml`), só se o HTML é do item pedido. */
export function vendidosDoHtml(html: string, mlItemId: string): string | null {
  if (!html.includes(`"itemId":"${mlItemId}"`)) return null;
  const sub = html.match(/"subtitle_label":\{[^}]*?"text":"([^"]*)"/)?.[1];
  return sub?.match(/\+?\d[\d.,]*\s*(?:mil\s*)?vendidos?/i)?.[0] ?? null;
}

/** Ritmo do anúncio: `vendidosTexto` e `criadoEm` precisam ser do MESMO anúncio. */
export function quantoVende(
  { vendidosTexto, criadoEm }: { vendidosTexto: string | null; criadoEm: string | null },
  agora = new Date(),
): QuantoVende {
  const piso = pisoDosVendidos(vendidosTexto);
  const t = criadoEm ? new Date(criadoEm).getTime() : NaN;
  if (!Number.isFinite(t) || t > agora.getTime()) return { piso, criadoEm: null, dias: null, semaforo: null, minimoPorMes: null, minimoPorDia: null };
  const dias = Math.floor((agora.getTime() - t) / DIA);
  const semaforo: Semaforo = dias <= 180 ? 'verde' : dias <= 365 ? 'amarelo' : 'vermelho';
  const minimoPorMes = piso === null ? null : Math.floor(piso / Math.max(dias / MES_DIAS, 1));
  const minimoPorDia = piso === null ? null : Math.floor((piso / Math.max(dias, 1)) * 10) / 10;
  return { piso, criadoEm, dias, semaforo, minimoPorMes, minimoPorDia };
}

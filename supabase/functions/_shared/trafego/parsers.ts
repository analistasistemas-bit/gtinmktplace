// Parsers puros das respostas do ML (spike 052). Nunca lançam: resposta malformada → `null`
// (a orquestração decide `falha`); a rota `visits/time_window` omite dias sem visita — dia
// pedido e ausente numa resposta 200 é 0, estado `ok`.
import { DAY_MS, OFFSET_BRT_MS } from './janelas.ts';

export interface PontoVisitas {
  dia: string;
  visitas: number;
  estado: 'ok' | 'pendente';
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARENTA_E_OITO_HORAS_MS = 48 * 3_600_000;

function diasDaJanela(desde: string, ate: string): string[] {
  const desdeMs = Date.parse(`${desde}T00:00:00Z`);
  const ateMs = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(desdeMs) || Number.isNaN(ateMs) || ateMs < desdeMs) return [];
  const out: string[] = [];
  for (let ms = desdeMs; ms <= ateMs; ms += DAY_MS) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

/**
 * `resp` de `GET /items/{id}/visits/time_window`. O rótulo do dia é `results[].date` literal
 * (nunca convertido de fuso — spike 052 §2.3); `calendario` só decide o instante em que um dia
 * termina, para a regra das 48h. `results` fora de ordem, duplicado ou com forma inválida →
 * resposta inteira `null` (dado não confiável, nunca inventar um valor).
 */
export function parseVisitas(
  resp: unknown,
  calendario: 'utc' | 'brt',
  agora: Date,
  janela: { desde: string; ate: string },
): PontoVisitas[] | null {
  if (typeof resp !== 'object' || resp === null) return null;
  const results = (resp as Record<string, unknown>).results;
  if (!Array.isArray(results)) return null;

  const porDia = new Map<string, number>();
  for (const r of results) {
    if (typeof r !== 'object' || r === null) return null;
    const { date, total } = r as Record<string, unknown>;
    if (typeof date !== 'string' || date.length < 10) return null;
    const dia = date.slice(0, 10);
    if (!DIA_RE.test(dia) || typeof total !== 'number' || !Number.isFinite(total)) return null;
    if (porDia.has(dia)) return null;
    porDia.set(dia, total);
  }

  const agoraMs = agora.getTime();
  if (Number.isNaN(agoraMs)) return null;
  const dias = diasDaJanela(janela.desde, janela.ate);
  if (dias.length === 0) return null;

  const offset = calendario === 'brt' ? OFFSET_BRT_MS : 0;
  return dias.map((dia) => {
    const fimDoDiaMs = Date.parse(`${dia}T00:00:00Z`) + DAY_MS + offset;
    const estado: 'ok' | 'pendente' =
      agoraMs - fimDoDiaMs < QUARENTA_E_OITO_HORAS_MS ? 'pendente' : 'ok';
    return { dia, visitas: porDia.get(dia) ?? 0, estado };
  });
}

export interface PrecoObservado {
  preco: number;
  precoRegular: number | null;
  moeda: string;
}

/** `resp` de `GET /items/{id}/sale_price?context=channel_marketplace`. Nunca lança. */
export function parseSalePrice(resp: unknown): PrecoObservado | null {
  if (typeof resp !== 'object' || resp === null) return null;
  const { amount, regular_amount: regularAmount, currency_id: currencyId } = resp as Record<string, unknown>;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (typeof currencyId !== 'string' || !currencyId) return null;
  const precoRegular =
    typeof regularAmount === 'number' && Number.isFinite(regularAmount) ? regularAmount : null;
  return { preco: amount, precoRegular, moeda: currencyId };
}

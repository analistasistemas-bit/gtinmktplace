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

export function diasDaJanela(desde: string, ate: string): string[] {
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
 *
 * `date_from`/`date_to` da resposta precisam confirmar a janela pedida: comparando só
 * `[:10]` (nunca convertendo — o fuso ecoado varia entre `Z` e `-04:00`, spike 052 §2.2 item 5),
 * `date_from[:10]` tem que ser igual a `janela.desde` e `date_to[:10]` igual a `janela.ate`
 * (medido nas 3 fixtures reais: sempre igualdade exata, com e sem `ending`). Ausentes, inválidos
 * ou divergentes → `null` (a orquestração trata como `falha`, que nunca sobrescreve um dia `ok` —
 * ao contrário de um zero de resposta truncada ou de outra janela). Um `result` cuja data caia
 * fora de `[date_from, date_to]` ecoados também é dado não confiável → `null`.
 */
export function parseVisitas(
  resp: unknown,
  calendario: 'utc' | 'brt',
  agora: Date,
  janela: { desde: string; ate: string },
): PontoVisitas[] | null {
  if (typeof resp !== 'object' || resp === null) return null;
  const { results, date_from: dateFrom, date_to: dateTo } = resp as Record<string, unknown>;
  if (!Array.isArray(results)) return null;
  if (typeof dateFrom !== 'string' || typeof dateTo !== 'string') return null;
  if (dateFrom.length < 10 || dateTo.length < 10) return null;
  const echoDesde = dateFrom.slice(0, 10);
  const echoAte = dateTo.slice(0, 10);
  if (!DIA_RE.test(echoDesde) || !DIA_RE.test(echoAte)) return null;
  if (echoDesde !== janela.desde || echoAte !== janela.ate) return null;

  const porDia = new Map<string, number>();
  for (const r of results) {
    if (typeof r !== 'object' || r === null) return null;
    const { date, total } = r as Record<string, unknown>;
    if (typeof date !== 'string' || date.length < 10) return null;
    const dia = date.slice(0, 10);
    if (!DIA_RE.test(dia) || typeof total !== 'number' || !Number.isFinite(total)) return null;
    if (dia < echoDesde || dia > echoAte) return null;
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

// ADR-0181 Plano 2a — download em lote das notas do mês no ML. Só repassa o zip (sem parse, sem gravar).
export interface DepsNotasVenda {
  travar(chave: string, ttlS: number): Promise<boolean>;
  liberar(chave: string, cooldownS: number): Promise<void>;
  token(): Promise<string>;
  fetchMl(url: string, token: string, signal: AbortSignal): Promise<Response>;
}
export type SaidaNotas =
  | { tipo: 'zip'; body: ReadableStream<Uint8Array> }
  | { tipo: 'vazio' }
  | { tipo: 'erro'; status: number; mensagem: string };

const INDISPONIVEL = 'Mercado Livre indisponível — o pacote não foi gerado.';
const AMBIGUO = 'Não foi possível confirmar as notas do mês.';
// ponytail: 120 s para token + headers + 1º chunk (o gateway corta em 150 s sem começar a responder). Medido: 30–56 s
// para ~1.400 vendas/mês. Loja bem maior → dividir o mês em quinzenas (o `stream` aceita), ao custo de mais cota.
const PRAZO_MS = 120_000;
// R1: trava enquanto houver download (460 s > teto de 400 s da edge) e 60 s de cooldown ao terminar.
const TRAVA_S = 460;
const COOLDOWN_S = 60;

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
function mesSP(d: Date): string {
  const x = FMT.formatToParts(d);
  return `${x.find((q) => q.type === 'year')!.value}-${x.find((q) => q.type === 'month')!.value}`;
}

export function intervaloDoMes(mes: string, agora: Date): { start: string; end: string } | { erro: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { erro: 'Mês inválido.' };
  if (mes > mesSP(agora)) return { erro: 'Mês futuro não tem notas.' };
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const base = `${a}${String(m).padStart(2, '0')}`;
  return { start: `${base}01`, end: `${base}${String(ultimo).padStart(2, '0')}` };
}

export const urlLote = (conta: string, start: string, end: string) =>
  `https://api.mercadolibre.com/users/${conta}/invoices/sites/MLB/batch_request/period/stream`
  + `?start=${start}&end=${end}&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false`;

/** Repassa o corpo já com o 1º chunk lido; `fim` roda uma vez (fim, erro ou cancelamento). */
function encadear(primeiro: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, fim: () => Promise<void>): ReadableStream<Uint8Array> {
  let enviado = false;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (!enviado) { enviado = true; c.enqueue(primeiro); return; }
      try {
        const { done, value } = await reader.read();
        if (done) { await fim(); c.close(); } else c.enqueue(value);
      } catch (e) { await fim(); c.error(e); }
    },
    async cancel(motivo) { await reader.cancel(motivo).catch(() => {}); await fim(); },
  });
}

async function interpretar(r: Response, fim: () => Promise<void>): Promise<SaidaNotas> {
  if (r.status === 200) {
    const tipo = r.headers.get('Content-Type') ?? '';
    if (!r.body || !/^application\/(zip|octet-stream)\b/i.test(tipo)) { await r.body?.cancel().catch(() => {}); return { tipo: 'erro', status: 502, mensagem: AMBIGUO }; }
    const reader = r.body.getReader();
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) { await reader.cancel().catch(() => {}); return { tipo: 'erro', status: 502, mensagem: AMBIGUO }; }
    return { tipo: 'zip', body: encadear(value, reader, fim) };
  }
  if (r.status === 404) return (await r.text()) === '' ? { tipo: 'vazio' } : { tipo: 'erro', status: 502, mensagem: AMBIGUO };
  await r.body?.cancel().catch(() => {});
  if (r.status === 429) return { tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' };
  if (r.status === 401 || r.status === 403) return { tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' };
  if (r.status >= 500) return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  return { tipo: 'erro', status: 502, mensagem: AMBIGUO };
}

export async function baixarLoteMes(
  deps: DepsNotasVenda,
  p: { conexaoId: string; conta: string; mes: string; agora: Date; signal: AbortSignal; prazoMs?: number },
): Promise<SaidaNotas> {
  const iv = intervaloDoMes(p.mes, p.agora);
  if ('erro' in iv) return { tipo: 'erro', status: 400, mensagem: iv.erro };
  if (p.signal.aborted) return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  const chave = `lock:notas-venda:${p.conexaoId}`;
  if (!(await deps.travar(chave, TRAVA_S))) {
    return { tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos.' };
  }

  const ctl = new AbortController();
  const cancelar = () => ctl.abort();
  p.signal.addEventListener('abort', cancelar, { once: true });   // navegador cancelou → aborta o ML, inclusive no corpo
  let encerrado = false;
  const fim = async () => {
    if (encerrado) return;
    encerrado = true;
    p.signal.removeEventListener('abort', cancelar);
    await deps.liberar(chave, COOLDOWN_S).catch(() => {});
  };
  const abortado = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('abortado')), { once: true }));
  abortado.catch(() => {});
  if (p.signal.aborted) cancelar();   // abortou enquanto esperava a trava
  const prazo = setTimeout(cancelar, p.prazoMs ?? PRAZO_MS);

  try {
    ctl.signal.throwIfAborted();
    const token = await Promise.race([deps.token(), abortado]);
    const r = await Promise.race([deps.fetchMl(urlLote(p.conta, iv.start, iv.end), token, ctl.signal), abortado]);
    const saida = await Promise.race([interpretar(r, fim), abortado]);
    clearTimeout(prazo);
    if (saida.tipo !== 'zip') { ctl.abort(); await fim(); }
    return saida;
  } catch {
    clearTimeout(prazo);
    ctl.abort();
    await fim();
    return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  }
}

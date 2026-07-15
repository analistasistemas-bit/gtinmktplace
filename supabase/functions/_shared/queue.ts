import { Client, Receiver } from 'npm:@upstash/qstash@^2';

let cachedClient: Client | null = null;
let cachedReceiver: Receiver | null = null;

export function qstashClient(): Client {
  if (cachedClient) return cachedClient;
  cachedClient = new Client({ token: Deno.env.get('QSTASH_TOKEN')! });
  return cachedClient;
}

export function qstashReceiver(): Receiver {
  if (cachedReceiver) return cachedReceiver;
  cachedReceiver = new Receiver({
    currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY')!,
    nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY')!,
  });
  return cachedReceiver;
}

export interface ProcessFamiliaJob {
  familia_id: string;
  lote_id: string;
  listing_type_id?: string;
  // ADR-0078 F1: quando true, o worker de update/split repõe só estoque (não empurra preço).
  // enfileirarAtualizacao/enfileirarSplit serializam o job inteiro → propaga sozinho.
  somenteEstoque?: boolean;
}

export async function enfileirarFamilia(job: ProcessFamiliaJob): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/process-familia`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: job,
    retries: 3,
  });
  return messageId;
}

// Fila serial das escritas no ML por usuário (parallelism=1), ADR-0034. Publicar várias
// famílias concorrentes faz o processamento assíncrono de foto do ML ficar muito lento
// (foto isolada processa em segundos; em par, trava). Serializar por conta de vendedor
// elimina essa concorrência. CREATE e UPDATE compartilham a fila (mesma conta ML).
function nomeFilaPublicacao(userId: string): string {
  return `publish-ml-${userId}`;
}

/** Garante a fila serial (parallelism=1) do usuário. Idempotente; chamar antes de enfileirar. */
export async function garantirFilaSerial(userId: string): Promise<void> {
  await qstashClient().queue({ queueName: nomeFilaPublicacao(userId) }).upsert({ parallelism: 1 });
}

// Rede de segurança do retry das escritas no ML (CREATE/UPDATE/split). Com o pré-upload das fotos
// no process-familia (pre-subir-fotos.ts), a propagação corre ANTES do publish e o item.create
// costuma achar o picture_id já propagado → publica de primeira, sem retry. Este retry só dispara
// quando o operador publica antes de a foto assentar. Reusa o MESMO picture_id (re-subir reinicia o
// relógio de propagação). Granularidade fina: retryDelay 30s (antes 90s) evita passar do ponto —
// foto pronta em ~142s aterrissa em ~150s, não em 180s. retries × retryDelay cobre ~5 min (pior caso
// medido). retries casa com MAX_RETRIES_TRANSIENTES (_shared/publicacao/retry.ts). ADR-0033.
const RETRIES_PUBLICACAO_ML = 10;
const RETRY_DELAY_PUBLICACAO_ML = '30000'; // 30s × 10 = 5 min de cobertura, granularidade fina

export async function enfileirarPublicacao(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publish-familia-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: RETRIES_PUBLICACAO_ML, retryDelay: RETRY_DELAY_PUBLICACAO_ML });
  return messageId;
}

export async function enfileirarAtualizacao(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/update-familia-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: RETRIES_PUBLICACAO_ML, retryDelay: RETRY_DELAY_PUBLICACAO_ML });
  return messageId;
}

// Split (ADR-0048): produto com >100 cores vai para o worker de split (N anúncios por partição),
// não para publish/update. Mesma fila serial por usuário (uma escrita no ML por vez, ADR-0034).
export async function enfileirarSplit(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publicar-split-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: RETRIES_PUBLICACAO_ML, retryDelay: RETRY_DELAY_PUBLICACAO_ML });
  return messageId;
}

// E6 (ADR-0061): fan-out por (canal, org) — o worker genérico publicar-anuncio atende
// canais ≠ ML; o ML continua na fila `publish-ml-${userId}` acima (D-E6.1, intocada).
export interface PublicarAnuncioJob { familia_id: string; lote_id: string; canal: string; }

/** Fila serial por (canal, org): rate limit do canal é por conta de vendedor (D-E6.4). */
export function filaCanal(canal: string, orgId: string): string {
  return `publish-${canal}-${orgId}`;
}

/** Garante a fila serial (parallelism=1) do (canal, org). Idempotente; espelha garantirFilaSerial. */
export async function garantirFilaSerialCanal(nomeFila: string): Promise<void> {
  await qstashClient().queue({ queueName: nomeFila }).upsert({ parallelism: 1 });
}

export async function enfileirarPublicacaoCanal(job: PublicarAnuncioJob, orgId: string): Promise<string> {
  const nomeFila = filaCanal(job.canal, orgId);
  await garantirFilaSerialCanal(nomeFila);
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publicar-anuncio`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFila })
    .enqueueJSON({ url: target, body: job, retries: RETRIES_PUBLICACAO_ML, retryDelay: RETRY_DELAY_PUBLICACAO_ML });
  return messageId;
}

export interface VincularCatalogoJob { familia_id: string; }

/**
 * Enfileira o opt-in de catálogo (ADR-0021) com delay. A elegibilidade de catálogo do ML só
 * fica pronta alguns minutos após o `POST /items`, então o passo NÃO pode rodar síncrono no
 * publish. Além de demorar a computar, ela passa por estados transitórios: um anúncio multi-cor
 * de famílias diferentes pode aparecer `READY_FOR_OPTIN` por instantes e depois assentar em
 * `FAMILY_DIFF`. O delay (10 min) dá tempo de a elegibilidade ASSENTAR antes de agirmos — assim
 * só itens genuinamente elegíveis (mesma família) seguem READY e vinculam; `retries` cobre o
 * caso de ainda não ter computado (o worker devolve 500 enquanto houver variação `pendente`).
 */
export async function enfileirarVinculacaoCatalogo(familiaId: string, delaySeconds = 600): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/vincular-catalogo`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: { familia_id: familiaId } satisfies VincularCatalogoJob,
    delay: delaySeconds,
    retries: 5,
  });
  return messageId;
}

export async function verificarAssinatura(req: Request, body: string): Promise<boolean> {
  const sig = req.headers.get('upstash-signature');
  if (!sig) return false;
  try {
    return await qstashReceiver().verify({ signature: sig, body });
  } catch {
    return false;
  }
}

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

// retryDelay curto + retries: rede de segurança p/ erro transiente de foto (ADR-0033). retries=3
// casa com MAX_RETRIES_TRANSIENTES do worker (_shared/publicacao/retry.ts). A fila serial já
// elimina a concorrência que era a causa principal da lentidão, então o retry raramente dispara.
export async function enfileirarPublicacao(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publish-familia-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: 3, retryDelay: '10000' });
  return messageId;
}

export async function enfileirarAtualizacao(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/update-familia-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: 3, retryDelay: '10000' });
  return messageId;
}

// Split (ADR-0048): produto com >100 cores vai para o worker de split (N anúncios por partição),
// não para publish/update. Mesma fila serial por usuário (uma escrita no ML por vez, ADR-0034).
export async function enfileirarSplit(job: ProcessFamiliaJob, userId: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publicar-split-ml`;
  const { messageId } = await qstashClient()
    .queue({ queueName: nomeFilaPublicacao(userId) })
    .enqueueJSON({ url: target, body: job, retries: 3, retryDelay: '10000' });
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

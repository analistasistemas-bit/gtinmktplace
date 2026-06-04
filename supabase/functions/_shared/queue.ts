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

export async function enfileirarPublicacao(job: ProcessFamiliaJob): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/publish-familia-ml`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: job,
    retries: 3,
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

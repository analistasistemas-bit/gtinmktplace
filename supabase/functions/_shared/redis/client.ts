const URL = () => Deno.env.get('UPSTASH_REDIS_REST_URL')!;
const TOKEN = () => Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

async function call<T>(comando: (string | number)[]): Promise<T | null> {
  const res = await fetch(URL(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(comando),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const json = await res.json() as { result: T | null; error?: string };
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result;
}

export function redisGet(chave: string): Promise<string | null> {
  return call<string>(['GET', chave]);
}

export async function redisSet(chave: string, valor: string, ttlSegundos?: number): Promise<void> {
  const cmd: (string | number)[] = ['SET', chave, valor];
  if (ttlSegundos) cmd.push('EX', ttlSegundos);
  await call(cmd);
}

export async function redisDel(chave: string): Promise<void> {
  await call(['DEL', chave]);
}

export async function redisSetNX(
  chave: string,
  valor: string,
  ttlSegundos: number,
): Promise<boolean> {
  const r = await call<string>(['SET', chave, valor, 'NX', 'EX', ttlSegundos]);
  return r === 'OK';
}

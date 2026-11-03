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

/** Lê e apaga numa única operação atômica (ADR-0091). Usado onde "uso único" é requisito de
 *  segurança e não só higiene: um GET seguido de DEL deixa janela para duas requisições
 *  concorrentes lerem o mesmo valor antes de qualquer uma apagar. Devolve null se a chave já
 *  não existia — que é justamente como o chamador detecta a segunda tentativa. */
export function redisGetDel(chave: string): Promise<string | null> {
  return call<string>(['GETDEL', chave]);
}

/** Incrementa um contador de janela fixa e devolve o valor novo. O TTL é aplicado só na
 *  primeira ocorrência (quando INCR devolve 1), então a janela começa no primeiro evento e
 *  expira sozinha — não precisa de limpeza. Usado pelo throttle do ml-webhook, que não pode
 *  depender de um INSERT ter dado certo para contabilizar tráfego. */
export async function redisIncrComTTL(chave: string, ttlSegundos: number): Promise<number> {
  const n = await call<number>(['INCR', chave]) ?? 0;
  if (n === 1) await call(['EXPIRE', chave, ttlSegundos]);
  return n;
}

export async function redisSetNX(
  chave: string,
  valor: string,
  ttlSegundos: number,
): Promise<boolean> {
  const r = await call<string>(['SET', chave, valor, 'NX', 'EX', ttlSegundos]);
  return r === 'OK';
}

/** Contadores do orçamento da extensão (fatia 2): resposta que não é inteiro lança — sem o `?? 0` de
 *  `redisIncrComTTL`, porque quem chama é fail-closed. */
async function inteiro(comando: (string | number)[]): Promise<number> {
  const n = await call<number>(comando);
  if (!Number.isInteger(n)) throw new Error(`Redis ${comando[0]}: resposta inválida ${JSON.stringify(n)}`);
  return n as number;
}

export function redisIncrBy(chave: string, n: number): Promise<number> {
  return inteiro(['INCRBY', chave, n]);
}

export function redisDecrBy(chave: string, n: number): Promise<number> {
  return inteiro(['DECRBY', chave, n]);
}

/** true = TTL aplicado; false = chave não existe. */
export async function redisExpire(chave: string, ttlSegundos: number): Promise<boolean> {
  const r = await inteiro(['EXPIRE', chave, ttlSegundos]);
  if (r !== 0 && r !== 1) throw new Error(`Redis EXPIRE: resposta inválida ${r}`);
  return r === 1;
}

/** Um único MGET (1 comando no Upstash; pipeline de GET contaria N). Ordem preservada, miss = null. */
export async function redisMget(chaves: string[]): Promise<(string | null)[]> {
  if (chaves.length === 0) return [];
  const r = await call<unknown[]>(['MGET', ...chaves]);
  if (!Array.isArray(r) || r.length !== chaves.length || r.some((v) => v !== null && typeof v !== 'string')) {
    throw new Error('Redis MGET: resposta inválida');
  }
  return r as (string | null)[];
}

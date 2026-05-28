export async function pool<T, U>(
  limite: number,
  itens: T[],
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (itens.length === 0) return [];
  const resultado: U[] = new Array(itens.length);
  let proximo = 0;
  async function runner(): Promise<void> {
    while (true) {
      const i = proximo++;
      if (i >= itens.length) return;
      resultado[i] = await worker(itens[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limite, itens.length) }, runner);
  await Promise.all(runners);
  return resultado;
}

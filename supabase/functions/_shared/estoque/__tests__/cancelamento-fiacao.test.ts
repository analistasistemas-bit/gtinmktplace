// Emenda 24/11/2026 ao ADR-0121: todo chamador de `tratarPedidoCancelado` passa status E substatus do envio,
// pelo mesmo `envioParaTratamento`. sync-venda e reconciliar-faturamento são módulos Deno.serve; a fiação é
// conferida no texto (a regra em si é testada em cancelamento.test.ts e a drenagem em cancelamentos.test.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (f: string) => readFileSync(resolve(process.cwd(), 'supabase/functions', f), 'utf8');

describe('fiação do substatus do envio', () => {
  it.each([['sync-venda/index.ts', 1], ['reconciliar-faturamento/index.ts', 4]] as const)(
    '%s: cada pedido montado para o tratamento usa envioParaTratamento', (arquivo, n) => {
      const t = ler(arquivo);
      expect(t).not.toMatch(/shipmentStatus:\s*shipment\?\.status/);
      expect(t.match(/\.\.\.envioParaTratamento\(shipment\)/g) ?? []).toHaveLength(n);
    });
});

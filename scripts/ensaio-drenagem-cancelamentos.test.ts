// Teste sem rede do plano do ensaio (ADR-0211, ressalva a da rodada 5): um cenário por org, e a reabertura usa
// outra referência de baixa. Rodar: deno test --node-modules-dir=none -A scripts/ensaio-drenagem-cancelamentos.test.ts
import { deepStrictEqual as assertEquals, ok as assert, throws as assertThrows } from 'node:assert/strict';
import { codigoSaida, planoEnsaio } from './ensaio-drenagem-cancelamentos.ts';

const ORGS = {
  A: '00000000-0000-0000-0000-00000000000a',
  B: '00000000-0000-0000-0000-00000000000b',
  C: '00000000-0000-0000-0000-00000000000c',
};

Deno.test('orgs repetidas ou inválidas são recusadas', () => {
  assertThrows(() => planoEnsaio({ ...ORGS, B: ORGS.A }, 't'), /distintas/);
  assertThrows(() => planoEnsaio({ ...ORGS, C: 'x' }, 't'), /uuid/);
});

Deno.test('cada cenário vive só na sua org; pedidos e SKUs não se repetem', () => {
  const p = planoEnsaio(ORGS, 't');
  assertEquals(p.vendas.filter((v) => v.letra === 'A').length, 20);
  assertEquals(p.vendas.filter((v) => v.letra === 'B').length, 20);
  assertEquals(p.vendas.filter((v) => v.letra === 'C').length, 2);
  assertEquals(new Set(p.vendas.map((v) => v.orderId)).size, p.vendas.length);
  for (const v of p.vendas) assert(p.skus[v.letra].includes(v.sku), `${v.sku} fora da org ${v.letra}`);
  assertEquals(p.vendas.filter((v) => v.letra === 'A' && v.envio === 'ready_to_ship').length, 10);
  assertEquals(p.vendas.filter((v) => v.kit).length, 5);
  assertEquals(new Set(Object.values(p.lotes)).size, 4);
});

Deno.test('reabertura: mesmo pedido, outra referência de baixa (outro SKU da org C)', () => {
  const p = planoEnsaio(ORGS, 't');
  const original = p.vendas.find((v) => v.orderId === p.reabertura.orderId)!;
  assertEquals(original.letra, 'C');
  assert(p.reabertura.skuNovo !== original.sku);
  assert(p.skus.C.includes(p.reabertura.skuNovo));
  assert(!p.vendas.some((v) => v.sku === p.reabertura.skuNovo), 'o SKU novo não tem baixa original');
  assert(p.reabertura.naoReabre !== p.reabertura.orderId);
});

Deno.test('qualquer critério reprovado sai com código 1', () => {
  assertEquals(codigoSaida([]), 0);
  assertEquals(codigoSaida(['aceite: CPU 900 ms < 500']), 1);
});

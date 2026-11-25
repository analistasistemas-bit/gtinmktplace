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

// Emenda 8: todo pedido montado para o tratamento leva o leitor do histórico; a fila lê tentativas com a geração.
describe('fiação do envio que nunca saiu', () => {
  it.each([['sync-venda/index.ts', 1], ['reconciliar-faturamento/index.ts', 4]] as const)('%s: o thunk vai com o envio', (arquivo, n) => {
    expect(ler(arquivo).match(/\.\.\.envioParaTratamento\(shipment\),\s*lerNuncaSaiu: \(\) => lerNuncaSaiu\(token, shippingId!\),/g) ?? []).toHaveLength(n);
  });
  it('fila: leitor do histórico e tentativas lidas junto da geração', () => {
    const t = ler('reconciliar-faturamento/index.ts');
    expect(t).toMatch(/lerNuncaSaiu: \(id\) => lerNuncaSaiu\(token, id\),/);
    expect(t).toMatch(/select\('cancelamento_tentativas'\)\s*\.eq\('org_id', orgId\)\.eq\('id', o\.id\)\.eq\('cancelamento_geracao', o\.geracao\)/);
    expect(t).toMatch(/tentativas: Number\(data\.cancelamento_tentativas\)/);
  });
  it('fila: ledger do lote no teto de linhas é leitura falha, não "sem baixa aberta"', () => {
    expect(ler('reconciliar-faturamento/index.ts')).toMatch(/if \(error\) throw new Error\(`cancelamento_baixas: \$\{error\.message\}`\);\s*conferirTeto\(data \?\? \[\], 'cancelamento_baixas'\);/);
  });
  it('deps reais: ledger, trava, dedupe e fila ligados, com as duas flags', () => {
    const t = ler('_shared/estoque/cancelamento-deps.ts');
    for (const d of ['baixasAbertas', 'saldoMexidoDepois', 'notificacaoJaEnviada']) expect(t, d).toMatch(new RegExp(`^  ${d},$`, 'm'));
    expect(t).toMatch(/drenar: Deno\.env\.get\('DRENAR_CANCELAMENTOS'\), fanout: fanoutAtivo\('FANOUT_RECONCILIAR'\)/);
  });
});

// Emenda 9: sync-devolucao dispara depois de gravar a venda e ANTES do 502 do MP, com as duas flags da fila.
describe('fiação do cancelamento na hora', () => {
  const t = ler('sync-devolucao/index.ts');
  it('depois do upsertVenda e antes do retorno por MP indisponível', () => {
    const [u, d, mp] = ['await upsertVenda(', 'await dispararCancelamentoNaHora(', 'mpIndisponivel: true'].map((x) => t.indexOf(x));
    expect(u).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(u);
    expect(mp).toBeGreaterThan(d);
  });
  it('publica no sync-venda e consulta a fila com as flags', () => {
    expect(t).toMatch(/functions\/v1\/sync-venda/);
    expect(t).toMatch(/drenar: Deno\.env\.get\('DRENAR_CANCELAMENTOS'\), fanout: fanoutAtivo\('FANOUT_RECONCILIAR'\)/);
  });
});

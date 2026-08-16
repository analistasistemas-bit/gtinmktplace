// Pulse (ADR-0119): detalhe do produto — ofertas atuais, histórico de menor preço e o
// simulador de margem (regra LOUD: falta insumo → "Margem indisponível", nunca assume).
// Reprecificar abre dialog-reprecificar com o preço do simulador.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QK } from '@/lib/queries';
import { fetchPulseDetalhe, fetchContextoMargem, type PulseProduto, type PulseVendedor } from '@/lib/pulse';
import { estadoAtualOfertas, menorPrecoPorDia, vendasEstimadasVendedor, margemEstimada } from '@/lib/pulse-margem';
import { fmtBRL, fmtInt, parseNumeroPtBr } from '@/lib/formato';
import { DialogReprecificar } from '@/components/pulse/dialog-reprecificar';

function insumoFaltante(
  contexto: { custo: number | null; aliquotaPct: number | null } | undefined,
  ptwCustos: { comissao: number | null; frete: number | null } | null,
): string | null {
  if (!contexto || contexto.custo == null) return 'custo do produto';
  if (contexto.aliquotaPct == null) return 'alíquota de imposto';
  if (!ptwCustos || ptwCustos.comissao == null || ptwCustos.frete == null) return 'price-to-win do Mercado Livre';
  return null;
}

export function DialogDetalhe({ produto, onFechar }: { produto: PulseProduto | null; onFechar: () => void }) {
  const aberto = produto != null;
  const [precoEditado, setPrecoEditado] = useState<string | null>(null);
  const [reprecificarAberto, setReprecificarAberto] = useState(false);
  useEffect(() => setPrecoEditado(null), [produto?.id]);
  useEffect(() => setReprecificarAberto(false), [produto?.id]);

  const { data, isLoading } = useQuery({
    queryKey: produto ? QK.pulseDetalhe(produto.id) : QK.pulseDetalhe('_'),
    queryFn: () => fetchPulseDetalhe(produto!.id),
    enabled: aberto,
  });
  const { data: contexto, isLoading: contextoCarregando } = useQuery({
    queryKey: ['pulse', 'contexto-margem', produto?.codigo_pai],
    queryFn: () => fetchContextoMargem(produto!.codigo_pai!),
    enabled: aberto && !!produto?.codigo_pai,
  });

  const ofertas = data?.ofertas ?? [];
  const vendedores = data?.vendedores ?? [];
  // Estado atual vem da view (sem truncamento); estadoAtualOfertas aqui só filtra ativo e ordena.
  const atuais = estadoAtualOfertas(data?.ofertasAtuais ?? []);
  const historico = menorPrecoPorDia(ofertas).slice(-14);

  const vendedoresPorSeller = new Map<number, PulseVendedor[]>();
  for (const v of vendedores) {
    const lista = vendedoresPorSeller.get(v.seller_id) ?? [];
    lista.push(v);
    vendedoresPorSeller.set(v.seller_id, lista);
  }

  const menorConcorrente = atuais[0]?.preco ?? null;
  const precoDefault = contexto?.precoAtual ?? menorConcorrente;
  const precoInput = precoEditado ?? (precoDefault != null ? String(precoDefault) : '');
  const precoSimulado = parseNumeroPtBr(precoInput);
  // Enquanto o contexto de margem ainda carrega, não afirma qual insumo falta — só sabe isso
  // depois que a resposta chega (regra LOUD é sobre dado ausente, não sobre dado ainda em voo).
  const faltando = produto?.codigo_pai && !contextoCarregando ? insumoFaltante(contexto, produto.ptw_custos) : null;
  const margem = precoSimulado && precoSimulado > 0 && !faltando
    ? margemEstimada({
        preco: precoSimulado, custoProduto: contexto?.custo ?? null,
        ptwCustos: produto?.ptw_custos ?? null, aliquotaPct: contexto?.aliquotaPct ?? null,
      })
    : null;

  return (
    <>
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{produto?.titulo ?? produto?.catalog_product_id}</DialogTitle>
          <DialogDescription>{produto?.catalog_product_id}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <h3 className="mb-2 text-sm font-medium">Ofertas atuais</h3>
              {atuais.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma oferta ativa coletada ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground">
                      <TableHead>Preço</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Frete</TableHead>
                      <TableHead>Loja</TableHead>
                      <TableHead>Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {atuais.map((o) => {
                      const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
                      const ultimo = hist[hist.length - 1];
                      const delta = vendasEstimadasVendedor(hist);
                      return (
                        <TableRow key={o.item_id}>
                          <TableCell className="tabular-nums">{fmtBRL(o.preco)}</TableCell>
                          <TableCell>
                            <div className="font-medium">{ultimo?.nickname ?? `Vendedor ${o.seller_id}`}</div>
                            <div className="text-xs text-muted-foreground">
                              {ultimo?.power_seller ?? '—'}
                              {ultimo?.transactions_total != null && (
                                <> · {fmtInt(ultimo.transactions_total)} vendas totais do vendedor</>
                              )}
                              {delta != null && <> · ≈{fmtInt(delta)} vendas do vendedor no período (estimado)</>}
                            </div>
                          </TableCell>
                          <TableCell>{o.frete_gratis ? 'Grátis' : '—'}</TableCell>
                          <TableCell>{o.loja_oficial ? 'Oficial' : '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.tier ?? '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Menor preço por dia de coleta</h3>
              {historico.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ainda sem histórico suficiente.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {historico.map((h) => (
                    <li key={h.dia} className="flex justify-between border-b border-dashed py-1 last:border-0">
                      <span className="text-muted-foreground">{h.dia}</span>
                      <span className="tabular-nums">{fmtBRL(h.preco)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {produto?.codigo_pai && (
              <section>
                <h3 className="mb-2 text-sm font-medium">Sua posição</h3>
                <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Seu preço atual</p>
                    <p className="tabular-nums">{contexto?.precoAtual != null ? fmtBRL(contexto.precoAtual) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Menor concorrente</p>
                    <p className="tabular-nums">{menorConcorrente != null ? fmtBRL(menorConcorrente) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Price-to-win sugerido</p>
                    <p className="tabular-nums">
                      {produto.ptw_preco_sugerido != null ? fmtBRL(produto.ptw_preco_sugerido) : '—'}
                    </p>
                  </div>
                </div>

                <h4 className="mb-1.5 text-sm font-medium">Simulador de margem</h4>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    inputMode="decimal"
                    className="w-32"
                    aria-label="Preço simulado"
                    value={precoInput}
                    onChange={(e) => setPrecoEditado(e.target.value)}
                  />
                  {contextoCarregando ? (
                    <span className="text-sm text-muted-foreground">Carregando custo e alíquota…</span>
                  ) : faltando ? (
                    <Badge variant="destructive">Margem indisponível: falta {faltando}</Badge>
                  ) : margem ? (
                    <span className="text-sm">
                      Líquido <span className="font-medium tabular-nums">{fmtBRL(margem.liquido)}</span>{' '}
                      <span className="text-muted-foreground tabular-nums">({margem.margemPct.toFixed(1)}%)</span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Informe um preço para simular.</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={!precoSimulado || precoSimulado <= 0}
                    onClick={() => setReprecificarAberto(true)}
                  >
                    Reprecificar
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    <DialogReprecificar
      codigoPai={reprecificarAberto ? produto?.codigo_pai ?? null : null}
      precoInicial={precoSimulado ?? null}
      ptwCustos={produto?.ptw_custos ?? null}
      onFechar={() => setReprecificarAberto(false)}
    />
    </>
  );
}

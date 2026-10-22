// Aba "Extensão" da Central (ADR-0189 D-19, Task 25): uso da Extensão PubliAI no mês e erros de leitura de página.
// Mesmo idioma da aba Pulse (KpiCard, DataTable, EmptyState); dados de extensao_uso_diario e extensao_erros_leitura.
import { AlertTriangle, Link2, MousePointerClick, Puzzle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Column, DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { StatusPill } from '@/components/ui/status-pill';
import { usePlatformExtensaoUsage } from '@/hooks/usePlatformAdmin';
import { fmtInt } from '@/lib/formato';
import type { ExtensaoErroLeitura, ExtensaoUsoPessoa } from '@/lib/platform-admin';

const PAGINA: Record<string, string> = { anuncio: 'Anúncio', busca: 'Busca', catalogo: 'Catálogo' };
const dataBr = (dia: string) => new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR');

// Campos que a extensão lê na página (pdp.ts) → nome para quem administra.
const CAMPO: Record<string, string> = {
  ml_item_id: 'Identificador do anúncio ausente',
  seller_id: 'Vendedor ausente',
  categoria_id: 'Categoria ausente',
  preco: 'Preço ausente',
  selo: 'Lugar do selo não encontrado',
};

/** Motivo gravado pela extensão → texto legível; o código técnico fica como detalhe. */
function motivoLegivel(motivo: string): string {
  if (motivo === 'estado_nao_encontrado') return 'Dados da página não encontrados';
  const campo = /^campo_ausente:(.+)$/.exec(motivo)?.[1];
  return campo ? CAMPO[campo] ?? `Campo ausente: ${campo}` : motivo;
}

const colunasPessoas: Column<ExtensaoUsoPessoa>[] = [
  { key: 'pessoa', header: 'Pessoa', cell: (row) => row.actor_name ?? row.actor_id },
  { key: 'analises', header: 'Análises', className: 'text-right tabular-nums', cell: (row) => fmtInt(row.analises) },
  { key: 'ultimo', header: 'Último uso', className: 'tabular-nums', cell: (row) => dataBr(row.ultimo_dia) },
];

const colunasErros: Column<ExtensaoErroLeitura>[] = [
  { key: 'dia', header: 'Data', className: 'tabular-nums', cell: (row) => dataBr(row.dia) },
  { key: 'pagina', header: 'Página', cell: (row) => <StatusPill tone="neutral">{PAGINA[row.tipo_pagina] ?? row.tipo_pagina}</StatusPill> },
  {
    key: 'motivo', header: 'Motivo',
    cell: (row) => (
      <div>
        <span>{motivoLegivel(row.motivo)}</span>
        <span className="block font-mono text-xs text-muted-foreground">{row.motivo}</span>
      </div>
    ),
  },
  { key: 'versao', header: 'Versão', className: 'tabular-nums', cell: (row) => row.versao },
  { key: 'ocorrencias', header: 'Ocorrências', className: 'text-right tabular-nums', cell: (row) => fmtInt(row.ocorrencias) },
  { key: 'anuncio', header: 'Último anúncio', className: 'tabular-nums', cell: (row) => row.ultimo_ml_item_id ?? 'Não informado' },
];

export function OrgExtensao({ orgId, month }: { orgId: string; month: string }) {
  const query = usePlatformExtensaoUsage(orgId, month);
  const uso = query.data;
  // Igual à aba Pulse: enabled:false deixa isLoading=false sem dado; "ainda não carregou" não é "sem uso".
  const loading = query.isLoading || (!uso && !query.isError);

  if (query.isError && !uso) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <span>Não foi possível carregar o uso da extensão.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const tipos = uso ? (['anuncio', 'catalogo', 'busca'] as const).map((t) => ({ tipo: t, n: uso.por_tipo[t] })) : [];

  return (
    <div className="space-y-4" aria-busy={loading || undefined}>
      {loading && <span className="sr-only" role="status">Carregando o uso da extensão…</span>}
      {query.isError && uso && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>A atualização do uso falhou; os últimos dados disponíveis permanecem na tela.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard size="compact" loading={loading} icon={MousePointerClick} label="Análises no mês" value={uso ? fmtInt(uso.analises) : undefined}
          hint={uso ? `${fmtInt(uso.dias_com_uso)} ${uso.dias_com_uso === 1 ? 'dia' : 'dias'} com uso` : undefined} />
        <KpiCard size="compact" loading={loading} icon={Users} label="Pessoas ativas" value={uso ? fmtInt(uso.pessoas_ativas) : undefined} />
        <KpiCard size="compact" loading={loading} icon={Link2} label="Vínculos de produto"
          value={uso ? (uso.vinculos === null ? 'Indisponível' : fmtInt(uso.vinculos)) : undefined}
          hint={uso?.vinculos === null ? 'Contagem indisponível' : 'Total da organização'} />
        <KpiCard size="compact" loading={loading} icon={AlertTriangle} label="Erros de leitura"
          tom={uso && uso.erros_total > 0 ? 'danger' : 'success'} value={uso ? fmtInt(uso.erros_total) : undefined} hint="Ocorrências no mês" />
      </div>

      {uso && uso.analises > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Análises por tipo de página</h3>
          <ul aria-label="Análises por tipo de página" className="space-y-2">
            {tipos.map(({ tipo, n }) => (
              <li key={tipo} className="grid grid-cols-[88px_1fr_48px] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{PAGINA[tipo]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(n / uso.analises) * 100}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums">{fmtInt(n)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uso?.primeiro_uso && (
        <p className="text-xs text-muted-foreground">Em uso desde {dataBr(uso.primeiro_uso)}.</p>
      )}

      <section className="space-y-2" aria-labelledby="ext-pessoas">
        <h3 id="ext-pessoas" className="text-sm font-medium">Quem usou</h3>
        <DataTable columns={colunasPessoas} rows={uso?.pessoas ?? []} rowKey={(row) => row.actor_id} loading={loading}
          empty={<div className="whitespace-normal"><EmptyState icon={Puzzle} title="Ninguém usou a extensão neste mês" description="As análises aparecem aqui quando alguém da organização abrir anúncios do Mercado Livre com a extensão conectada." /></div>} />
      </section>

      <section className="space-y-2" aria-labelledby="ext-erros">
        <h3 id="ext-erros" className="text-sm font-medium">Erros de leitura de página</h3>
        <DataTable columns={colunasErros} rows={uso?.erros ?? []} rowKey={(row) => `${row.dia}:${row.tipo_pagina}:${row.versao}:${row.motivo}`} loading={loading}
          empty={<div className="whitespace-normal"><EmptyState icon={AlertTriangle} title="Nenhum erro de leitura no mês" description="Quando o Mercado Livre muda o layout e a extensão não consegue ler uma página, o motivo aparece aqui." /></div>} />
      </section>
    </div>
  );
}

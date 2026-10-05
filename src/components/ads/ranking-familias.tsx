import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtBRLSinal } from '@/lib/formato';
import type { FamiliaPainel, MotivoFamilia, PainelAds, Semaforo } from '@/lib/ads-painel';
import { pct, razao } from '@/components/ads/resumo-conta';

const NADA = '—';
const MOTIVO: Record<Exclude<MotivoFamilia, null>, string> = {
  compartilhado: 'gasto compartilhado com outra família',
  cobertura: 'coleta de Ads incompleta no período',
  historico: 'período antes do histórico de vendas',
  sem_vendas: 'sem vendas no período',
  sem_custo: 'sem custo cadastrado',
  custo_parcial: 'custo parcial: sem semáforo',
};
const SEMAFORO: Record<Semaforo, { tom: 'success' | 'danger'; txt: string }> = {
  dentro: { tom: 'success', txt: 'dentro' },
  acima: { tom: 'danger', txt: 'acima' },
  sem_espaco: { tom: 'danger', txt: 'sem espaço para Ads' },
};
const LINK = 'font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

const nomeFamilia = (f: FamiliaPainel) => f.nome ?? f.codigoPai;
const par = (a: string, b: string) => `${a} / ${b}`;

function Equilibrio({ f, liberado }: { f: FamiliaPainel; liberado: boolean }) {
  const eq = f.acosEquilibrio;
  const sem = liberado && f.semaforo ? SEMAFORO[f.semaforo] : null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <span>{pct(f.acosDireto)} direto / {pct(f.acos)} total × {pct(eq)}</span>
      {sem && <StatusPill tone={sem.tom}>{sem.txt}</StatusPill>}
    </span>
  );
}

function Resultado({ f }: { f: FamiliaPainel }) {
  const motivo = f.motivo && f.motivo !== 'custo_parcial' ? <span className="block text-xs text-muted-foreground">{MOTIVO[f.motivo]}</span> : null;
  return (
    <>
      {f.resultado != null && <span className={f.resultado < 0 ? 'text-danger' : undefined}>{fmtBRLSinal(f.resultado)}</span>}
      {f.resultado == null && !motivo && NADA}
      {motivo}
    </>
  );
}

/** Motivo que não bloqueia o resultado (custo parcial): aparece como marca ao lado. */
const MarcaCusto = ({ f }: { f: FamiliaPainel }) =>
  f.motivo === 'custo_parcial' || f.fonteCusto === 'parcial' || f.fonteCusto === 'estimado'
    ? <StatusPill tone="neutral" className="ml-1">{f.motivo === 'custo_parcial' ? MOTIVO.custo_parcial : `custo ${f.fonteCusto}`}</StatusPill>
    : null;

function Cartao({ f, liberado }: { f: FamiliaPainel; liberado: boolean }) {
  const linhas: [string, ReactNode][] = [
    ['Gasto', fmtBRL(f.custo)],
    ['Vendas (direta / total)', par(fmtBRL(f.vendasDiretas), fmtBRL(f.vendasTotais))],
    ['ROAS (direto / total)', par(razao(f.roasDireto), razao(f.roas))],
    ['ACOS (direto / total) × equilíbrio', <Equilibrio key="e" f={f} liberado={liberado} />],
    ['Lucro antes', f.lucroAntes == null ? NADA : fmtBRLSinal(f.lucroAntes)],
    ['Resultado', <Resultado key="r" f={f} />],
    ['Margem consumida', pct(f.margemConsumida)],
  ];
  return (
    <li className="rounded-lg border bg-card p-3">
      <Link to={`/faturamento/sku/familia/${f.codigoPai}`} className={LINK}>{nomeFamilia(f)}</Link>
      <MarcaCusto f={f} />
      <dl className="mt-2 space-y-1 text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export function RankingFamilias({ painel }: { painel: PainelAds }) {
  const [aberto, setAberto] = useState(false);
  const { conta, familias, compartilhados, semaforoLiberado } = painel;
  const temCompartilhado = compartilhados.length > 0;
  const naoId = conta?.naoIdentificado;
  const num = 'text-right tabular-nums';

  return (
    <section aria-label="Ranking de famílias">
      <h2 className="mb-2 text-sm font-medium">Famílias por gasto</h2>

      <ul className="space-y-2 md:hidden">
        {familias.map((f) => <Cartao key={f.codigoPai} f={f} liberado={semaforoLiberado} />)}
      </ul>

      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Família</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Vendas (direta / total)</TableHead>
              <TableHead className="text-right">ROAS (direto / total)</TableHead>
              <TableHead className="text-right">ACOS (direto / total) × equilíbrio</TableHead>
              <TableHead className="text-right">Lucro antes</TableHead>
              <TableHead className="text-right">Resultado</TableHead>
              <TableHead className="text-right">Margem consumida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {familias.map((f) => (
              <TableRow key={f.codigoPai}>
                <TableCell>
                  <Link to={`/faturamento/sku/familia/${f.codigoPai}`} className={LINK}>{nomeFamilia(f)}</Link>
                  <MarcaCusto f={f} />
                </TableCell>
                <TableCell className={num}>{fmtBRL(f.custo)}</TableCell>
                <TableCell className={num}>{par(fmtBRL(f.vendasDiretas), fmtBRL(f.vendasTotais))}</TableCell>
                <TableCell className={num}>{par(razao(f.roasDireto), razao(f.roas))}</TableCell>
                <TableCell className={num}><Equilibrio f={f} liberado={semaforoLiberado} /></TableCell>
                <TableCell className={num}>{f.lucroAntes == null ? NADA : fmtBRLSinal(f.lucroAntes)}</TableCell>
                <TableCell className={num}><Resultado f={f} /></TableCell>
                <TableCell className={num}>{pct(f.margemConsumida)}</TableCell>
              </TableRow>
            ))}
            {temCompartilhado && (
              <Fragment>
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={7}>
                    <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className={LINK}>
                      Compartilhado entre famílias ({compartilhados.length} {compartilhados.length === 1 ? 'grupo' : 'grupos'})
                    </button>
                  </TableCell>
                  <TableCell className={num}>{fmtBRL(conta?.compartilhado ?? compartilhados.reduce((s, g) => s + g.custo, 0))}</TableCell>
                </TableRow>
                {aberto && compartilhados.map((g) => (
                  <TableRow key={g.id} className="text-muted-foreground">
                    <TableCell colSpan={7}>
                      Grupo {g.id}: {g.familias.join(', ') || 'sem família'}{g.semCodigo > 0 ? ` + ${g.semCodigo} sem código` : ''}
                    </TableCell>
                    <TableCell className={num}>{fmtBRL(g.custo)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            )}
            {naoId != null && (
              <TableRow className="bg-muted/30">
                <TableCell colSpan={7}>Não identificado (fora dos grupos listados)</TableCell>
                <TableCell className={num}>{fmtBRL(naoId)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {temCompartilhado && (
        <div className="mt-2 text-sm md:hidden">
          <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className={LINK}>
            Compartilhado entre famílias: {fmtBRL(compartilhados.reduce((s, g) => s + g.custo, 0))}
          </button>
          {aberto && (
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {compartilhados.map((g) => <li key={g.id}>Grupo {g.id}: {g.familias.join(', ') || 'sem família'} — {fmtBRL(g.custo)}</li>)}
            </ul>
          )}
        </div>
      )}
      {naoId != null && <p className="mt-1 text-sm text-muted-foreground md:hidden">Não identificado: {fmtBRL(naoId)}</p>}
    </section>
  );
}

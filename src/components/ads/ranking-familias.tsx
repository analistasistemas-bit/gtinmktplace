import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtBRLSinal } from '@/lib/formato';
import type { FamiliaPainel, MotivoFamilia, PainelAds, Semaforo } from '@/lib/ads-painel';
import { pct, razao } from '@/components/ads/resumo-conta';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

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
/** Par total / direto (mesma ordem do resumo): total em cima, direto abaixo — 2 linhas para caber em 1440 px. */
const Par = ({ total, direto, rotulo }: { total: string; direto: string; rotulo: string }) => (
  <><span className="block">{total}</span><span className="block text-xs text-muted-foreground">{`${rotulo} ${direto}`}</span></>
);
const textoMotivo = (m: Exclude<MotivoFamilia, null>, historicoDesde: string | null) =>
  m === 'historico' && historicoDesde ? `${MOTIVO.historico} (desde ${dataBRT(historicoDesde)})` : MOTIVO[m];

function Equilibrio({ f, liberado }: { f: FamiliaPainel; liberado: boolean }) {
  const sem = liberado && f.semaforo ? SEMAFORO[f.semaforo] : null;
  return (
    <>
      <span className="block">{pct(f.acos)} / {pct(f.acosDireto)}</span>
      <span className="flex flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
        equilíbrio {pct(f.acosEquilibrio)}
        {sem && <StatusPill tone={sem.tom}>{sem.txt}</StatusPill>}
      </span>
    </>
  );
}

function Resultado({ f, historicoDesde }: { f: FamiliaPainel; historicoDesde: string | null }) {
  const motivo = f.motivo && f.motivo !== 'custo_parcial'
    ? <span className="block text-xs text-muted-foreground">{textoMotivo(f.motivo, historicoDesde)}</span> : null;
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

function Cartao({ f, liberado, historicoDesde }: { f: FamiliaPainel; liberado: boolean; historicoDesde: string | null }) {
  const linhas: [string, ReactNode][] = [
    ['Gasto', fmtBRL(f.custo)],
    ['Vendas (total / direta)', `${fmtBRL(f.vendasTotais)} / ${fmtBRL(f.vendasDiretas)}`],
    ['ROAS (total / direto)', `${razao(f.roas)} / ${razao(f.roasDireto)}`],
    ['ACOS (total / direto) × equilíbrio', <Equilibrio key="e" f={f} liberado={liberado} />],
    ['Lucro antes', f.lucroAntes == null ? NADA : fmtBRLSinal(f.lucroAntes)],
    ['Resultado após Ads', <Resultado key="r" f={f} historicoDesde={historicoDesde} />],
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

export function RankingFamilias({ painel, historicoDesde }: { painel: PainelAds; historicoDesde: string | null }) {
  const [aberto, setAberto] = useState(false);
  const { conta, familias, compartilhados, semaforoLiberado } = painel;
  const temCompartilhado = compartilhados.length > 0;
  const totalCompartilhado = conta?.compartilhado ?? compartilhados.reduce((s, g) => s + g.custo, 0);
  const detalheGrupo = (g: PainelAds['compartilhados'][number]) =>
    g.familias.length
      ? `Grupo ${g.id}: ${g.familias.join(', ')}${g.semCodigo > 0 ? ` + ${g.semCodigo} sem código` : ''}`
      : `Grupo ${g.id}: sem código identificado (${g.semCodigo} ${g.semCodigo === 1 ? 'anúncio' : 'anúncios'})`;
  const naoId = conta?.naoIdentificado;
  const num = 'text-right tabular-nums';
  const cab = 'text-right whitespace-normal align-bottom';
  const temLinhas = familias.length > 0 || temCompartilhado || naoId != null;

  return (
    <section aria-label="Ranking de famílias">
      <h2 className="mb-2 text-sm font-medium">Famílias por gasto</h2>

      {!familias.length && <p className="mb-2 text-sm text-muted-foreground">Nenhum gasto de Ads por família no período.</p>}

      <ul className="space-y-2 md:hidden">
        {familias.map((f) => <Cartao key={f.codigoPai} f={f} liberado={semaforoLiberado} historicoDesde={historicoDesde} />)}
      </ul>

      {temLinhas && (
        <div className="hidden rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="align-bottom">Família</TableHead>
                <TableHead className={cab}>Gasto</TableHead>
                <TableHead className={cab}>Vendas (total / direta)</TableHead>
                <TableHead className={cab}>ROAS (total / direto)</TableHead>
                <TableHead className={cab}>ACOS (total / direto) × equilíbrio</TableHead>
                <TableHead className={cab}>Lucro antes</TableHead>
                <TableHead className={cab}>Resultado após Ads</TableHead>
                <TableHead className={cab}>Margem consumida</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {familias.map((f) => (
                <TableRow key={f.codigoPai}>
                  <TableCell className="min-w-[12rem] max-w-[18rem] whitespace-normal break-words">
                    <Link to={`/faturamento/sku/familia/${f.codigoPai}`} className={LINK}>{nomeFamilia(f)}</Link>
                    <MarcaCusto f={f} />
                  </TableCell>
                  <TableCell className={num}>{fmtBRL(f.custo)}</TableCell>
                  <TableCell className={num}><Par total={fmtBRL(f.vendasTotais)} direto={fmtBRL(f.vendasDiretas)} rotulo="direta" /></TableCell>
                  <TableCell className={num}><Par total={razao(f.roas)} direto={razao(f.roasDireto)} rotulo="direto" /></TableCell>
                  <TableCell className={num}><Equilibrio f={f} liberado={semaforoLiberado} /></TableCell>
                  <TableCell className={num}>{f.lucroAntes == null ? NADA : fmtBRLSinal(f.lucroAntes)}</TableCell>
                  <TableCell className={`${num} max-w-[11rem] whitespace-normal`}><Resultado f={f} historicoDesde={historicoDesde} /></TableCell>
                  <TableCell className={num}>{pct(f.margemConsumida)}</TableCell>
                </TableRow>
              ))}
              {temCompartilhado && (
                <Fragment>
                  <TableRow className="bg-muted/30">
                    <TableCell className="whitespace-normal">
                      <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className={LINK}>
                        Compartilhado entre famílias ({compartilhados.length} {compartilhados.length === 1 ? 'grupo' : 'grupos'})
                      </button>
                    </TableCell>
                    <TableCell className={num}>{fmtBRL(totalCompartilhado)}</TableCell>
                    <TableCell colSpan={6} />
                  </TableRow>
                  {aberto && compartilhados.map((g) => (
                    <TableRow key={g.id} className="text-muted-foreground">
                      <TableCell className="whitespace-normal">{detalheGrupo(g)}</TableCell>
                      <TableCell className={num}>{fmtBRL(g.custo)}</TableCell>
                      <TableCell colSpan={6} />
                    </TableRow>
                  ))}
                </Fragment>
              )}
              {naoId != null && (
                <TableRow className="bg-muted/30">
                  <TableCell className="whitespace-normal">Gasto de Ads não identificado</TableCell>
                  <TableCell className={num}>{fmtBRL(naoId)}</TableCell>
                  <TableCell colSpan={6} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {temCompartilhado && (
        <div className="mt-2 text-sm md:hidden">
          <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className={LINK}>
            Compartilhado entre famílias: {fmtBRL(totalCompartilhado)}
          </button>
          {aberto && (
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {compartilhados.map((g) => <li key={g.id}>{detalheGrupo(g)} — {fmtBRL(g.custo)}</li>)}
            </ul>
          )}
        </div>
      )}
      {naoId != null && <p className="mt-1 text-sm text-muted-foreground md:hidden">Gasto de Ads não identificado: {fmtBRL(naoId)}</p>}
    </section>
  );
}

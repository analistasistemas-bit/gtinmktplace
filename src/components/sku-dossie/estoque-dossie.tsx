import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import { LIMITES } from '@/lib/vendas-sku';
import { soKits, type DossieSku } from '@/lib/sku-dossie';
import { BlocoDossie } from './bloco-dossie';
import { diaMesBRT } from './formato-dossie';

/** Estoque na posição de hoje. Lidera com a cobertura (o número que só este bloco tem; o saldo já
 *  está na faixa de fatos). Kit vinculado não tem estoque próprio: lidera com "N kits"
 *  (floor(base / N), do catálogo) e a cobertura não vira dias, porque a base também vende. */
export function EstoqueDossie({ dados, familia, voltar, className }: {
  dados: Pick<DossieSku, 'estoque' | 'cobertura' | 'catalogo'>; familia: boolean; voltar: string; className?: string;
}) {
  const { estoque, cobertura, catalogo } = dados;
  const kit = soKits(catalogo) ? catalogo[0] : null;
  const kitsNaFamilia = kit ? 0 : catalogo.filter((c) => c.ehKit).length;
  const baixa = typeof cobertura === 'number' && cobertura < LIMITES.coberturaMinDias;
  const saldo = estoque == null ? 'desconhecido' : `${fmtInt(estoque)} ${kit ? (estoque === 1 ? 'kit' : 'kits') : 'un.'}`;
  const dias = estoque == null ? 'desconhecida'
    : typeof cobertura === 'number' ? `${fmtInt(cobertura)} ${cobertura === 1 ? 'dia' : 'dias'}` : 'sem ritmo';

  let nota: ReactNode;
  if (estoque == null) nota = 'Fora do catálogo atual: sem fonte de saldo nem de cobertura.';
  else if (kit) {
    const base = kit.kitBaseCodigo;
    nota = (
      <>
        Estoque compartilhado com a base{' '}
        {base ? (
          <Link to={`/faturamento/sku/${encodeURIComponent(base)}`} state={{ de: voltar }}
            className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {base}
          </Link>
        ) : '(base não identificada)'}
        {kit.kitMultiplicador ? `: saldo = base ÷ ${kit.kitMultiplicador}, arredondado para baixo.` : '.'}
        {' '}A base também vende sozinha, então o kit não tem cobertura própria.
      </>
    );
  } else if (typeof cobertura === 'number') {
    nota = `No ritmo dos últimos ${LIMITES.janelaTendenciaDias} dias${baixa ? `, abaixo de ${LIMITES.coberturaMinDias} dias` : ''}.${familia ? ' Soma das variações.' : ''}`;
  } else {
    nota = `Sem vendas nos últimos ${LIMITES.janelaTendenciaDias} dias: não há ritmo para medir a cobertura.`;
  }

  // Número principal: cobertura; no kit, o saldo em kits (a cobertura dele é só "compartilhada").
  const principal = kit ? { rotulo: 'Saldo em kits', valor: saldo } : { rotulo: 'Cobertura', valor: dias };
  const secundario = kit ? { rotulo: 'Cobertura', valor: 'compartilhada' } : { rotulo: 'Saldo', valor: saldo };
  const fraco = kit ? false : typeof cobertura !== 'number';

  return (
    <BlocoDossie id="dossie-estoque" titulo="Estoque" relogio={`Posição em ${diaMesBRT()}`} className={className}>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <dl className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{principal.rotulo}</dt>
            <dd className={cn('text-2xl font-semibold tabular-nums tracking-tight',
              fraco && 'text-lg font-normal text-muted-foreground', baixa && 'text-warning')}>{principal.valor}</dd>
          </div>
          <div className="flex items-baseline gap-1.5 text-sm">
            <dt className="text-muted-foreground">{secundario.rotulo}</dt>
            <dd className={cn('font-medium tabular-nums', estoque == null && 'font-normal text-muted-foreground')}>{secundario.valor}</dd>
          </div>
        </dl>
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {nota}
          {kitsNaFamilia > 0 && ` Inclui ${kitsNaFamilia} ${kitsNaFamilia === 1 ? 'variação' : 'variações'} kit com estoque da base, fora do saldo.`}
        </p>
      </div>
    </BlocoDossie>
  );
}

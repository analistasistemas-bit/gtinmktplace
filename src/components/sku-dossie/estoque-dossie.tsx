import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import { LIMITES } from '@/lib/vendas-sku';
import type { DossieSku } from '@/lib/sku-dossie';
import { BlocoDossie } from './bloco-dossie';
import { diaMesBRT } from './formato-dossie';

function Numero({ rotulo, children, tom }: { rotulo: string; children: ReactNode; tom?: 'fraco' | 'alerta' }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={cn('text-2xl font-semibold tabular-nums tracking-tight',
        tom === 'fraco' && 'text-lg font-normal text-muted-foreground', tom === 'alerta' && 'text-warning')}>{children}</dd>
    </div>
  );
}

/** Estoque na posição de hoje: saldo e cobertura. Kit vinculado não tem estoque próprio: o saldo é
 *  floor(base / N) (já calculado pelo catálogo) e a cobertura não vira dias, porque a base também vende. */
export function EstoqueDossie({ dados, familia, voltar }: {
  dados: Pick<DossieSku, 'estoque' | 'cobertura' | 'catalogo'>; familia: boolean; voltar: string;
}) {
  const { estoque, cobertura, catalogo } = dados;
  const kit = catalogo.find((c) => c.ehKit);
  const unidade = kit ? (estoque === 1 ? 'kit' : 'kits') : 'un.';
  const baixa = typeof cobertura === 'number' && cobertura < LIMITES.coberturaMinDias;

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

  return (
    <BlocoDossie id="dossie-estoque" titulo="Estoque" relogio={`Posição em ${diaMesBRT()}`}>
      <div className="flex flex-1 flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <dl className="grid grid-cols-2 gap-4">
          <Numero rotulo={kit ? 'Saldo em kits' : 'Saldo'} tom={estoque == null ? 'fraco' : undefined}>
            {estoque == null ? 'desconhecido' : `${fmtInt(estoque)} ${unidade}`}
          </Numero>
          <Numero rotulo="Cobertura"
            tom={typeof cobertura === 'number' ? (baixa ? 'alerta' : undefined) : 'fraco'}>
            {estoque == null ? 'desconhecida' : kit || cobertura === 'compartilhado' ? 'compartilhada'
              : typeof cobertura === 'number' ? `${fmtInt(cobertura)} ${cobertura === 1 ? 'dia' : 'dias'}` : 'sem ritmo'}
          </Numero>
        </dl>
        <p className="mt-auto border-t pt-3 text-xs text-muted-foreground">{nota}</p>
      </div>
    </BlocoDossie>
  );
}

// ADR-0200 (adendo 08/11): preço avulso das peças ao lado do preço do kit. Só informativo: compara preços de venda
// (o lucro segue no simulador) e nunca muda o preço sozinho.
import { AlertTriangle } from 'lucide-react';
import { fmtBRL } from '@/lib/formato';
import type { ComparacaoKit, LinhaAvulsa, SomaAvulsa } from '@/lib/kit-preco-avulso';
import { cn } from '@/lib/utils';

export const INDISPONIVEL = 'preço avulso indisponível';

/** dd/mm no fuso de Brasília (o fim da promoção vem em UTC). */
export const diaMes = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

const pct = (n: number) => `${Math.abs(n)}% ${n >= 0 ? 'abaixo' : 'acima'}`;

/** Etapa 1: soma das peças da combinação naquele tamanho. */
export function CelulaAvulso({ soma, lendo, rotulo }: { soma: SomaAvulsa; lendo: boolean; rotulo: string }) {
  return (
    <span aria-label={`Avulso ${rotulo}`} className="mt-0.5 block whitespace-nowrap text-[11px] leading-tight tabular-nums text-muted-foreground">
      {lendo ? '…' : !soma.disponivel ? 'indisponível' : (
        <>
          {fmtBRL(soma.normal)}
          {soma.temPromocao && <span className="block text-warning">promo {fmtBRL(soma.promocao)}</span>}
        </>
      )}
    </span>
  );
}

/** Kit ≥ soma avulsa: o comprador pode preferir as peças separadas. */
export function AvisoAvulso({ c, pecas }: { c: ComparacaoKit; pecas: number }) {
  if (!c.maisCaro && !c.semComparacao) return null;
  return (
    <div role="alert" className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="grid gap-1">
        {c.maisCaro && c.referencia != null && (
          <p>
            O kit sai mais caro que comprar as {pecas} peças avulsas{c.pior?.soma.temPromocao ? ' na promoção atual' : ' no preço atual'}
            {' '}({fmtBRL(c.referencia)}). O comprador pode preferir o avulso.
          </p>
        )}
        {c.maisCaro && c.fimPromocao && (
          <p>A promoção da peça termina em {diaMes(c.fimPromocao)}. Depois disso a comparação muda.</p>
        )}
        {c.semComparacao && (
          <p>Não foi possível comparar com o preço avulso de todas as combinações ({INDISPONIVEL}).</p>
        )}
      </div>
    </div>
  );
}

/** Etapas 2 e 3 e Gerenciar: referência da pior combinação e o desconto do kit; com `linhas`, uma por combinação. */
export function ComparacaoAvulso({ c, preco, lendo, erro, linhas, pecas }: {
  c: ComparacaoKit; preco: number; lendo: boolean; erro: boolean; pecas: number; linhas?: LinhaAvulsa[];
}) {
  if (lendo) return <p className="text-xs text-muted-foreground" role="status">Lendo o preço avulso das peças no Mercado Livre…</p>;
  if (erro || !c.pior) {
    return (
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground">Preço avulso indisponível: não foi possível comparar o kit com as peças separadas.</p>
      </div>
    );
  }
  const { pior } = c;
  return (
    <div className="grid gap-2" aria-label="Comparação com o preço avulso">
      <div className="grid gap-0.5 text-xs tabular-nums">
        <p className="text-muted-foreground">
          Avulso ({pecas} peças, {pior.rotulo} · {pior.tamanho}): <span className="text-foreground">{fmtBRL(pior.soma.normal)} normal</span>
          {pior.soma.temPromocao && <> · <span className="text-foreground">{fmtBRL(pior.soma.promocao)} em promoção</span></>}
        </p>
        {preco > 0 && c.descontoNormal != null && (
          <p className={cn('font-medium', c.maisCaro ? 'text-warning' : 'text-foreground')}>
            Kit {fmtBRL(preco)} · {pct(c.descontoNormal)} do normal
            {pior.soma.temPromocao && c.descontoPromocao != null && ` · ${pct(c.descontoPromocao)} da promoção`}
          </p>
        )}
      </div>
      {linhas && linhas.length > 1 && (
        <ul className="divide-y divide-border rounded-md border text-xs" aria-label="Preço avulso por combinação">
          {linhas.map((l) => {
            const ehPior = l === pior;
            const cara = l.soma.disponivel && Math.round(preco * 100) >= Math.round(l.soma.promocao * 100);
            return (
              <li key={`${l.rotulo}#${l.tamanho}`} className={cn('flex items-center justify-between gap-2 px-2 py-1.5 tabular-nums', ehPior && 'bg-muted/50')}>
                <span className="min-w-0 truncate">{l.rotulo} · {l.tamanho}{ehPior && <span className="ml-1 text-muted-foreground">(pior)</span>}</span>
                {l.soma.disponivel ? (
                  <span className={cn(cara ? 'text-warning' : 'text-muted-foreground')}>
                    {fmtBRL(l.soma.normal)}{l.soma.temPromocao && ` · promo ${fmtBRL(l.soma.promocao)}`}
                  </span>
                ) : <span className="text-muted-foreground">indisponível</span>}
              </li>
            );
          })}
        </ul>
      )}
      <AvisoAvulso c={c} pecas={pecas} />
    </div>
  );
}

import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Spec §3.1: faixa única, sem data prometida, quando mais da metade ainda depende da curva da família.
 *  O "i" explica a mistura do ADR-0207 §7 (limiar de 6 unidades vendidas por item). */
export function AvisoLoja({ pct }: { pct: number }) {
  const n = Math.round(pct * 100);
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-sm text-foreground">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="O que é estimado pela família"
            className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-info focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:-m-1 md:h-7 md:w-7"
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 text-sm">
          <p className="font-medium">Como o PubliAI calcula quanto comprar de cada cor e tamanho</p>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>
              <strong>Pelas vendas do próprio item:</strong> a partir de 6 unidades vendidas nos últimos 60 dias, a conta usa só o que
              aquele item (cor + tamanho) vendeu.
            </li>
            <li>
              <strong>Pela família:</strong> com menos de 6, a conta usa o produto inteiro: quanto ele vende no total e quanto cada
              cor e cada tamanho costuma pesar. Se no produto o M vende o dobro do P, o M recebe o dobro do P.
            </li>
            <li>
              <strong>No meio do caminho, mistura os dois:</strong> com 3 vendas, metade vem do item e metade da família. A cada
              venda o item pesa mais.
            </li>
          </ul>
          <p className="text-muted-foreground">
            A família não inventa venda: só reparte entre as cores e os tamanhos o que o produto já vende. O {n}% conta os itens
            que já tiveram venda e ainda não chegaram a 6; o aviso some quando forem menos da metade. Na grade, o * marca o item
            estimado. Confira as quantidades antes de mandar ao fornecedor.
          </p>
        </PopoverContent>
      </Popover>
      <p className="pt-0.5">
        {n}% dos itens que já venderam ainda têm a compra estimada pela família: cada um vendeu pouco até agora.
      </p>
    </div>
  );
}

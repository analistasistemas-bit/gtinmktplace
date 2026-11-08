// ADR-0200: explicação de "Vender só em kit", meta e reposição, com os valores que o operador digitou. Texto e tabela
// da spec ("Reposição"), pedido do Diego: "bem explicado, para não ficar confuso".
import { rotuloCombinacao } from '@/lib/kit-variacao';

export function ExplicacaoReposicao({ meta, cores, tamanho }: {
  meta: number;
  /** Combinação de exemplo (a primeira com quantidade). */
  cores: string[];
  tamanho: string;
}) {
  const combinacao = `${rotuloCombinacao(cores)} ${tamanho}`;
  const primeira = `${cores[0] ?? ''} ${tamanho}`;
  const outra = `${cores[1] ?? cores[0] ?? ''} ${tamanho}`;
  const linhas: Array<[string, string]> = [
    ...(meta > 0 ? [[
      `Vendeu 1 kit ${combinacao}, o saldo foi para ${meta - 1}, e há peças guardadas de todas as cores`,
      `O sistema move 1 peça de cada cor para o kit e volta a ${meta}. Esse kit sai do ar por alguns minutos durante a reposição.`,
    ] as [string, string]] : []),
    [
      `Acabou o ${primeira} guardado e sobrou ${outra}`,
      `Não move. O kit vende até acabar, e o ${outra} volta a ser vendido sozinho, no anúncio individual.`,
    ],
    ['Chegou mercadoria', `O sistema repõe cada combinação até a meta de ${meta}.`],
    ['O kit zerou e falta peça', 'O kit sai do ar e volta sozinho quando entrar peça.'],
  ];

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs" aria-label="Como funciona a reposição">
      <p>
        <span className="font-medium">Como funciona:</span> as peças das cores do kit ficam <strong>guardadas</strong> no
        estoque, com o anúncio individual pausado. O sistema monta kits conforme eles vendem, até a <strong>meta
        de {meta}</strong> kits em cada combinação e tamanho. Ele não move tudo de uma vez, porque a mesma peça serve em
        várias combinações.
      </p>
      {meta === 0 && (
        <p className="text-warning">Com meta 0 a reposição não monta nenhum kit. Defina quantos kits manter no ar.</p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="w-2/5 py-1 pr-3 font-medium">Exemplo ({combinacao}, meta {meta})</th>
            <th className="py-1 font-medium">O que acontece</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([situacao, efeito]) => (
            <tr key={situacao} className="border-t align-top">
              <td className="py-1.5 pr-3">{situacao}</td>
              <td className="py-1.5">{efeito}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground">
        Desligar &quot;Vender só em kit&quot; reativa os anúncios individuais que o kit pausou.
      </p>
    </div>
  );
}

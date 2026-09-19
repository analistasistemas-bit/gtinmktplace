// ADR-0166: o operador digita a lista de cores UMA vez e marca os tamanhos UMA vez; o botão
// monta o produto cartesiano como linhas editáveis. Sem isto, cadastrar 4 cores × 5 tamanhos
// seria preencher 20 cards à mão — o que o operador faz hoje é justamente por isso que a org
// piloto não cadastrava roupa no app.
//
// O componente NÃO decide nada sobre a org: quem manda os grupos é o diálogo, a partir de
// `opcoesDeTamanho(tiposHabilitados)`. Lista vazia de grupos = o bloco nem é renderizado.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { contarCombinacoes, gerarCombinacoes, type Combinacao, type GrupoTamanho } from '@/lib/tamanhos';

/** Cores separadas por vírgula OU quebra de linha — o operador cola de uma planilha tanto num
 *  formato quanto no outro, e exigir um só produziria uma linha "Azul\nPreto". */
function separarCores(texto: string): string[] {
  return texto.split(/[,\n]/).map((c) => c.trim()).filter(Boolean);
}

export function GeradorVariacoes({ gruposTamanho, onGerar }: {
  gruposTamanho: GrupoTamanho[];
  /** Chamado só quando a geração é válida. O diálogo é quem substitui as linhas. */
  onGerar: (combinacoes: Combinacao[]) => void;
}) {
  const [cores, setCores] = useState('');
  const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const listaCores = separarCores(cores);
  const listaTamanhos = [...tamanhos];
  // Prévia da contagem: o operador vê o número ANTES de clicar, em vez de descobrir 40 cards.
  // Usa a mesma dedup+trim de `gerarCombinacoes` (via `contarCombinacoes`) — senão "Azul, Azul"
  // mostraria uma prévia que o resultado real nunca entrega.
  const total = contarCombinacoes(listaCores, listaTamanhos);
  const vazio = listaCores.length === 0 && listaTamanhos.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <span className="text-sm font-medium">Gerar variações</span>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ger-cores" className="text-xs text-muted-foreground">Cores</label>
        <Textarea
          id="ger-cores" rows={2} value={cores}
          placeholder="Azul, Preto, Branco"
          onChange={(e) => { setCores(e.target.value); setErro(null); }}
        />
        <span className="text-xs text-muted-foreground">
          Separe por vírgula ou por linha. Produto sem cor? Deixe em branco e marque só os tamanhos.
        </span>
      </div>
      {gruposTamanho.map((g) => (
        <div key={g.grupo} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{g.grupo}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {g.valores.map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  aria-label={v}
                  checked={tamanhos.has(v)}
                  onCheckedChange={(checked) => {
                    setErro(null);
                    setTamanhos((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(v); else next.delete(v);
                      return next;
                    });
                  }}
                />
                {v}
              </label>
            ))}
          </div>
        </div>
      ))}
      {erro && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button" variant="outline" size="sm" disabled={vazio}
          onClick={() => {
            try {
              onGerar(gerarCombinacoes(listaCores, listaTamanhos));
              setErro(null);
            } catch (e) {
              // Erro do limite (LIMITE_VARIACOES_GERADAS): mensagem acionável, e NADA é gerado.
              setErro(e instanceof Error ? e.message : 'Não foi possível gerar as variações.');
            }
          }}
        >
          Gerar variações
        </Button>
        {!vazio && <span className="text-xs text-muted-foreground">{total} variações</span>}
      </div>
      <span className="text-xs text-muted-foreground">
        Gerar substitui as variações abaixo. Depois é só ajustar preço, estoque, GTIN e foto de
        cada linha — ou remover as combinações que você não tem.
      </span>
    </div>
  );
}

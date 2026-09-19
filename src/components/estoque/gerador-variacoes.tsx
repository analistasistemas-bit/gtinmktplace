// ADR-0166: o operador marca as cores UMA vez e os tamanhos UMA vez; o botão monta o produto
// cartesiano como linhas editáveis. Sem isto, cadastrar 4 cores × 5 tamanhos seria preencher 20
// cards à mão — o que o operador faz hoje é justamente por isso que a org piloto não cadastrava
// roupa no app.
//
// Cor é por CLIQUE, não por texto livre (pedido do Diego, 2026-09-19): uma lista separada por
// vírgula era fácil de digitar errado (typo mescla "Azul Preto" numa cor só, sem o operador
// perceber antes de gerar). CORES_POPULARES cobre o caso comum; "Adicionar cor" é a válvula de
// escape pro resto, uma cor de cada vez — o próprio ato de clicar "Adicionar" é a checagem que a
// vírgula não dava.
//
// O componente NÃO decide nada sobre a org: quem manda os grupos de tamanho é o diálogo, a
// partir de `opcoesDeTamanho(tiposHabilitados)`. Lista vazia de grupos = o bloco nem é renderizado.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { contarCombinacoes, gerarCombinacoes, type Combinacao, type GrupoTamanho } from '@/lib/tamanhos';

const CORES_POPULARES = [
  'Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal', 'Vermelho',
  'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege',
] as const;

export function GeradorVariacoes({ gruposTamanho, onGerar }: {
  gruposTamanho: GrupoTamanho[];
  /** Chamado só quando a geração é válida. O diálogo é quem substitui as linhas. */
  onGerar: (combinacoes: Combinacao[]) => void;
}) {
  const [coresPopulares, setCoresPopulares] = useState<Set<string>>(new Set());
  const [coresPersonalizadas, setCoresPersonalizadas] = useState<string[]>([]);
  const [novaCor, setNovaCor] = useState('');
  const [tamanhos, setTamanhos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const listaCores = [...coresPopulares, ...coresPersonalizadas];
  const listaTamanhos = [...tamanhos];
  // Prévia da contagem: o operador vê o número ANTES de clicar, em vez de descobrir 40 cards.
  // Usa a mesma dedup de `gerarCombinacoes` (via `contarCombinacoes`).
  const total = contarCombinacoes(listaCores, listaTamanhos);
  const vazio = listaCores.length === 0 && listaTamanhos.length === 0;

  function adicionarCorPersonalizada() {
    const cor = novaCor.trim();
    if (!cor) return;
    // Digitou o nome de uma cor que já é popular? Marca o checkbox em vez de duplicar como
    // badge — o operador não precisa saber que "Preto" já tinha um atalho.
    if ((CORES_POPULARES as readonly string[]).includes(cor)) {
      setCoresPopulares((prev) => new Set(prev).add(cor));
    } else if (!coresPersonalizadas.includes(cor)) {
      setCoresPersonalizadas((prev) => [...prev, cor]);
    }
    setErro(null);
    setNovaCor('');
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <span className="text-sm font-medium">Gerar variações</span>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Cores</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CORES_POPULARES.map((cor) => (
            <label key={cor} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                aria-label={cor}
                checked={coresPopulares.has(cor)}
                onCheckedChange={(checked) => {
                  setErro(null);
                  setCoresPopulares((prev) => {
                    const next = new Set(prev);
                    if (checked === true) next.add(cor); else next.delete(cor);
                    return next;
                  });
                }}
              />
              {cor}
            </label>
          ))}
        </div>
        {coresPersonalizadas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {coresPersonalizadas.map((cor) => (
              <Badge key={cor} variant="secondary">
                {cor}
                <button
                  type="button"
                  aria-label={`Remover cor ${cor}`}
                  onClick={() => setCoresPersonalizadas((prev) => prev.filter((c) => c !== cor))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            aria-label="Nova cor"
            placeholder="Cor fora da lista"
            value={novaCor}
            onChange={(e) => setNovaCor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); adicionarCorPersonalizada(); }
            }}
            className="h-8 max-w-48"
          />
          <Button
            type="button" variant="outline" size="sm"
            disabled={!novaCor.trim()}
            onClick={adicionarCorPersonalizada}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar cor
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Produto sem cor? Deixe tudo desmarcado e marque só os tamanhos.
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

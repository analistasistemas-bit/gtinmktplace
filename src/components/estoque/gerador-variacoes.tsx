// ADR-0166 + spec 2026-09-19: o operador marca as cores UMA vez e os tamanhos UMA vez. Desde a
// tela de grade o componente é CONTROLADO e não tem mais botão "Gerar": a seleção já é a ação
// (cor e tamanho são cliques discretos, não um textarea onde fazia sentido esperar o operador
// terminar de digitar). Quem reconcilia as linhas é o dialog, via `reconciliarGrade`.
//
// Cor é por CLIQUE, não por texto livre: uma lista separada por vírgula era fácil de digitar
// errado (typo mescla "Azul Preto" numa cor só). CORES_POPULARES cobre o caso comum;
// "Adicionar cor" é a válvula de escape, uma cor de cada vez.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { GrupoTamanho } from '@/lib/tamanhos';

// Exportada: o dialog de grade precisa da mesma lista para calcular quais chips estourariam o
// limite. Redigitá-la lá seria duas fontes divergindo na primeira cor nova. Exportar um não-
// componente daqui é aceito pelo lint — `react-refresh/only-export-components` roda com
// `allowConstantExport: true` (eslint.config.js:26-29) e isto é um `const`.
export const CORES_POPULARES = [
  'Preto', 'Branco', 'Cinza', 'Azul Marinho', 'Azul Royal', 'Vermelho',
  'Verde Bandeira', 'Amarelo', 'Rosa', 'Roxo', 'Marrom', 'Bege',
] as const;

const MOTIVO_LIMITE = 'Marcar isto passaria do limite de 60 variações por cadastro.';

function alternar(atual: ReadonlySet<string>, valor: string, marcar: boolean): Set<string> {
  const next = new Set(atual);
  if (marcar) next.add(valor); else next.delete(valor);
  return next;
}

export function GeradorVariacoes({
  gruposTamanho, cores, tamanhos, coresBloqueadas, tamanhosBloqueados, bloquearNovaCor,
  avisoTamanho, desabilitado, onMudarCores, onMudarTamanhos,
}: {
  gruposTamanho: GrupoTamanho[];
  cores: ReadonlySet<string>;
  tamanhos: ReadonlySet<string>;
  /** Cores AINDA NÃO marcadas cuja marcação estouraria LIMITE_VARIACOES_GERADAS. Calculadas
   *  pelo dialog (só ele conhece as exclusões manuais) com `totalDaGrade`. */
  coresBloqueadas: ReadonlySet<string>;
  tamanhosBloqueados: ReadonlySet<string>;
  /** true quando nem uma cor a mais caberia no limite — trava "Adicionar cor". */
  bloquearNovaCor: boolean;
  /** Aviso inline por valor de tamanho (ex.: numeração sem guia no ML). `null` = sem aviso. */
  avisoTamanho: (valor: string) => string | null;
  /** true durante `salvando`: congela a seleção (o casamento posicional exige a lista congelada). */
  desabilitado: boolean;
  onMudarCores: (cores: Set<string>) => void;
  onMudarTamanhos: (tamanhos: Set<string>) => void;
}) {
  const [novaCor, setNovaCor] = useState('');
  // Derivado da prop, não um segundo estado: cor personalizada é toda cor selecionada que não
  // está na lista de populares. Dois estados divergiriam na primeira reconciliação.
  const personalizadas = [...cores].filter((c) => !(CORES_POPULARES as readonly string[]).includes(c));

  function adicionarCorPersonalizada() {
    const cor = novaCor.trim();
    if (!cor) return;
    // Cor popular digitada à mão apenas marca o checkbox — sem badge duplicado.
    onMudarCores(alternar(cores, cor, true));
    setNovaCor('');
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <span className="text-sm font-medium">Cores e tamanhos</span>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Cores</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CORES_POPULARES.map((cor) => {
            const bloqueada = coresBloqueadas.has(cor) && !cores.has(cor);
            return (
              <label key={cor} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  aria-label={cor}
                  aria-describedby={bloqueada ? 'gerador-motivo-limite' : undefined}
                  title={bloqueada ? MOTIVO_LIMITE : undefined}
                  checked={cores.has(cor)}
                  disabled={desabilitado || bloqueada}
                  onCheckedChange={(checked) => onMudarCores(alternar(cores, cor, checked === true))}
                />
                {cor}
              </label>
            );
          })}
        </div>
        {personalizadas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {personalizadas.map((cor) => (
              <Badge key={cor} variant="secondary">
                {cor}
                <button
                  type="button"
                  aria-label={`Remover cor ${cor}`}
                  disabled={desabilitado}
                  onClick={() => onMudarCores(alternar(cores, cor, false))}
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
            disabled={desabilitado}
            onChange={(e) => setNovaCor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); adicionarCorPersonalizada(); }
            }}
            className="h-8 max-w-48"
          />
          <Button
            type="button" variant="outline" size="sm"
            title={bloquearNovaCor ? MOTIVO_LIMITE : undefined}
            disabled={desabilitado || bloquearNovaCor || !novaCor.trim()}
            onClick={adicionarCorPersonalizada}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar cor
          </Button>
        </div>
      </div>
      {gruposTamanho.map((g) => (
        <div key={g.grupo} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{g.grupo}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {g.valores.map((v) => {
              const bloqueado = tamanhosBloqueados.has(v) && !tamanhos.has(v);
              const aviso = avisoTamanho(v);
              return (
                <label key={v} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Checkbox
                      aria-label={v}
                      aria-describedby={bloqueado ? 'gerador-motivo-limite' : undefined}
                      title={bloqueado ? MOTIVO_LIMITE : undefined}
                      checked={tamanhos.has(v)}
                      disabled={desabilitado || bloqueado}
                      onCheckedChange={(checked) => onMudarTamanhos(alternar(tamanhos, v, checked === true))}
                    />
                    {v}
                  </span>
                  {aviso && <span className="text-xs text-amber-600 dark:text-amber-500">{aviso}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {/* Um só alvo de `aria-describedby` para todos os chips bloqueados — o motivo é o mesmo. */}
      <span id="gerador-motivo-limite" className="sr-only">{MOTIVO_LIMITE}</span>
      <span className="text-xs text-muted-foreground">
        Cada cor marcada vira uma linha por tamanho marcado. Desmarcar tira só as linhas daquela
        seleção; remover uma linha na mão mantém a grade parcial.
      </span>
    </div>
  );
}

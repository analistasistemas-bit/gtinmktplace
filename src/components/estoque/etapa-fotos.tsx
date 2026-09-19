// Etapa 2 do cadastro (fotos), compartilhada pelos dois dialogs. Não conhece `LinhaVariacao`:
// quem sabe de onde vem o arquivo de cada índice é o dialog (no cadastro normal, a linha; na
// grade, a foto da cor resolvida por `resolverLinha`).
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CampoFoto } from '@/components/estoque/campo-foto';
import type { ResultadoCadastro } from '@/lib/produtos-saldo';
import type { CadastroProdutoApi } from '@/components/estoque/use-cadastro-produto';

export function EtapaFotos({
  api, resultado, fotosCapa, onEscolherCapa, arquivoPorIndice, onPatchFotoLinha,
}: {
  api: CadastroProdutoApi;
  resultado: ResultadoCadastro;
  fotosCapa: Record<'capa' | 'capa2' | 'capa3', File | null>;
  onEscolherCapa: (tipo: 'capa' | 'capa2' | 'capa3', f: File | null) => void;
  /** Arquivo em memória da i-ésima variação — `null` quando a contagem divergiu. */
  arquivoPorIndice: (i: number) => File | null;
  onPatchFotoLinha: (i: number, f: File | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!resultado.filaOk && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            O produto foi cadastrado, mas o enriquecimento por IA não foi enfileirado.
            Sem isso ele não fica pronto para publicar.
            <div className="mt-2">
              <Button size="sm" onClick={() => api.reprocessar(resultado.familiaId)}>Reprocessar</Button>
            </div>
          </div>
        </div>
      )}
      {resultado.falhasEstoque.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            O estoque inicial não foi aplicado nestes SKUs — use “Dar entrada” na tela de
            Estoque para corrigir:
            <ul className="mt-1 list-inside list-disc font-mono text-xs">
              {resultado.falhasEstoque.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        </div>
      )}
      {api.enviandoFotos && (
        <p className="text-sm text-muted-foreground">
          enviando fotos ({api.enviandoFotos.feitos}/{api.enviandoFotos.total})…
        </p>
      )}
      {api.falhasFoto.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>Falha ao enviar a foto de: {api.falhasFoto.join(', ')}. Envie de novo abaixo.</div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Fotos do produto</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['capa', 'capa2', 'capa3'] as const).map((tipo) => {
            const rotulo = tipo === 'capa' ? 'Capa' : tipo === 'capa2' ? 'Capa 2' : 'Capa 3';
            // FALHOU tem prioridade sobre ENVIADA: um retry manual que falhou depois de um
            // sucesso anterior ainda precisa pedir o arquivo de novo.
            const status: 'falhou' | 'enviada' | 'naoEnviada' = api.falhasFoto.includes(rotulo)
              ? 'falhou' : api.fotosEnviadas.has(tipo) ? 'enviada' : 'naoEnviada';
            return (
              <div key={tipo} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{rotulo}</span>
                <CampoFoto
                  id={`retry-capa-${tipo}`}
                  ariaLabel={rotulo}
                  arquivo={fotosCapa[tipo]}
                  disabled={api.enviandoFoto}
                  enviada={status === 'enviada' && !api.trocando.has(tipo)}
                  opcional={status === 'naoEnviada'}
                  onTrocar={() => api.marcarTrocando(tipo)}
                  onEscolher={(f) => {
                    if (f) {
                      // Retry manual bem-sucedido apaga o aviso de falha desse alvo (senão o
                      // banner vermelho contradiz o toast de sucesso), marca como enviado e sai
                      // de `trocando` — é o que devolve o card ao estado "✓ enviada".
                      api.subirFoto(f, { tipo, familiaId: resultado.familiaId }, resultado.loteId)
                        .then(() => { api.limparFalha(rotulo); api.marcarEnviada(tipo); api.limparTrocando(tipo); })
                        .catch(() => {});
                    } else {
                      api.limparFalha(rotulo);
                    }
                    onEscolherCapa(tipo, f);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Foto por variação</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {resultado.variacoes.map((v, i) => {
            const status: 'falhou' | 'enviada' | 'naoEnviada' = api.falhasFoto.includes(v.codigo)
              ? 'falhou' : api.fotosEnviadas.has(v.id) ? 'enviada' : 'naoEnviada';
            return (
              <div key={v.id} className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground">{v.codigo}</span>
                <CampoFoto
                  id={`retry-var-${v.id}`}
                  ariaLabel={v.codigo}
                  arquivo={arquivoPorIndice(i)}
                  disabled={api.enviandoFoto}
                  enviada={status === 'enviada' && !api.trocando.has(v.id)}
                  opcional={status === 'naoEnviada'}
                  onTrocar={() => api.marcarTrocando(v.id)}
                  onEscolher={(f) => {
                    if (f) {
                      api.subirFoto(f, { tipo: 'variacao', variacaoId: v.id }, resultado.loteId)
                        .then(() => { api.limparFalha(v.codigo); api.marcarEnviada(v.id); api.limparTrocando(v.id); })
                        .catch(() => {});
                    } else {
                      api.limparFalha(v.codigo);
                    }
                    onPatchFotoLinha(i, f);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { varrerAnunciosOrfaos, type ResultadoVarredura } from '@/lib/orfaos';

/**
 * Confere a conta do ML contra o banco e lista anúncios que o PubliAI não conhece — os que
 * escaparam antes do guard de exclusão (incidente 2026-09-10, adendo do ADR-0088). Sob demanda:
 * cada clique gasta chamadas de API, então nada de rodar sozinho ao abrir a tela.
 *
 * Só informa. Encerrar ou re-vincular um órfão é decisão do operador, feita no ML — o app não mexe
 * em anúncio que não conhece.
 */
export function AnunciosOrfaos() {
  // Estado local em vez de react-query de propósito: é ação pontual, sem cache a compartilhar, e
  // este card vive numa tela cujos testes renderizam sem QueryClientProvider.
  const [resultado, setResultado] = useState<ResultadoVarredura | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function verificar() {
    setCarregando(true);
    setErro(null);
    try {
      setResultado(await varrerAnunciosOrfaos());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setResultado(null);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mb-4 rounded-md border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">Anúncios fora do PubliAI</p>
          <p className="text-xs text-muted-foreground">
            Compara os anúncios ativos e pausados da sua conta no Mercado Livre com o que o app conhece.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={carregando}
          onClick={verificar}
        >
          <RefreshCw className={carregando ? 'mr-1 h-3.5 w-3.5 animate-spin' : 'mr-1 h-3.5 w-3.5'} />
          {carregando ? 'Verificando…' : 'Verificar agora'}
        </Button>
      </div>

      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}

      {resultado && !carregando && (
        resultado.orfaos.length === 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Nenhum anúncio fora do app — {resultado.totalNoMl} conferidos no Mercado Livre.
          </p>
        ) : (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {resultado.orfaos.length === 1
                ? '1 anúncio no Mercado Livre que o app não conhece'
                : `${resultado.orfaos.length} anúncios no Mercado Livre que o app não conhece`}
              {' '}(de {resultado.totalNoMl} conferidos)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Venda nesses anúncios não baixa estoque aqui. Encerre no Mercado Livre o que não deveria
              estar no ar.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {resultado.orfaos.map((o) => (
                <li key={o.mlItemId} className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{o.titulo ?? o.mlItemId}</span>
                    <span className="text-muted-foreground">{o.mlItemId}</span>
                    {o.status && <span className="text-muted-foreground">· {o.status}</span>}
                    {o.estoque != null && <span className="text-muted-foreground">· {o.estoque} un.</span>}
                    {/* SKU preenchido = o anúncio saiu daqui e perdeu o vínculo (não é anúncio de fora). */}
                    {o.sku && <span className="text-muted-foreground">· código {o.sku}</span>}
                    {o.permalink && (
                      <a href={o.permalink} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        abrir no ML
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {resultado?.truncado && (
        <p className="mt-2 text-xs text-warning">
          Varredura parcial: a conta tem mais anúncios do que o Mercado Livre entrega numa busca
          (teto de 1.000). O que aparece acima é o que foi possível conferir.
        </p>
      )}
    </div>
  );
}

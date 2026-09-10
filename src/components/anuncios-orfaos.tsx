import { useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { varrerAnunciosOrfaos, type AnuncioOrfao, type ResultadoVarredura } from '@/lib/orfaos';

/**
 * Confere a conta do ML contra o banco e mostra o que o PubliAI não reconhece (incidente
 * 2026-09-10, adendo do ADR-0088).
 *
 * A CLASSIFICAÇÃO é o que torna isso útil: sem ela a lista mistura o caso acionável com anúncios de
 * catálogo saudáveis e com centenas que nunca foram do app — na conta de um cliente, 307 de 313.
 * Só informa; encerrar ou re-vincular é decisão do operador, feita no ML.
 */
export function AnunciosOrfaos() {
  const [resultado, setResultado] = useState<ResultadoVarredura | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verExternos, setVerExternos] = useState(false);

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

  const perdidos = resultado?.orfaos.filter((o) => o.classe === 'perdido_do_app' && !o.provavelRemocaoPeloApp) ?? [];
  const removidos = resultado?.orfaos.filter((o) => o.classe === 'perdido_do_app' && o.provavelRemocaoPeloApp) ?? [];
  const catalogo = resultado?.orfaos.filter((o) => o.classe === 'catalogo_sem_vinculo') ?? [];
  const externos = resultado?.orfaos.filter((o) => o.classe === 'externo') ?? [];

  return (
    <div className="mb-4 rounded-md border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">Conferir anúncios com o Mercado Livre</p>
          <p className="text-xs text-muted-foreground">
            Compara os anúncios ativos e pausados da conta com o que o app tem registrado.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8" disabled={carregando} onClick={verificar}>
          <RefreshCw className={carregando ? 'mr-1 h-3.5 w-3.5 animate-spin' : 'mr-1 h-3.5 w-3.5'} />
          {carregando ? 'Verificando…' : 'Verificar agora'}
        </Button>
      </div>

      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}

      {resultado && !carregando && (
        <div className="mt-3 flex flex-col gap-3">
          {perdidos.length === 0 && catalogo.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Nada pendente — {resultado.totalNoMl} anúncios conferidos.
            </p>
          ) : null}

          {perdidos.length > 0 && (
            <Grupo
              tom="destructive"
              titulo={`${perdidos.length} ${perdidos.length === 1 ? 'anúncio saiu do app e perdeu o vínculo' : 'anúncios saíram do app e perderam o vínculo'}`}
              ajuda="Nasceram aqui (têm código do PubliAI) e o app não os reconhece mais. Confira no Mercado Livre antes de qualquer ação."
              itens={perdidos}
            />
          )}

          {catalogo.length > 0 && (
            <Grupo
              tom="warning"
              titulo={`${catalogo.length} ${catalogo.length === 1 ? 'anúncio de catálogo sem vínculo salvo' : 'anúncios de catálogo sem vínculo salvo'}`}
              ajuda="São anúncios de catálogo do próprio produto — o Mercado Livre os criou, mas o app não guardou o vínculo. Não encerre: são anúncios legítimos, que vendem."
              itens={catalogo}
            />
          )}

          {removidos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {removidos.length} {removidos.length === 1 ? 'anúncio pausado' : 'anúncios pausados'} com código
              do app — provavelmente foram removidos por você aqui (o “Remover” pausa no Mercado Livre).
            </p>
          )}

          {externos.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setVerExternos((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {verExternos ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {externos.length} {externos.length === 1 ? 'anúncio que nunca foi do PubliAI' : 'anúncios que nunca foram do PubliAI'}
              </button>
              {verExternos && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {externos.map((o) => <Item key={o.mlItemId} o={o} />)}
                </ul>
              )}
            </div>
          )}

          {resultado.truncado && (
            <p className="text-xs text-warning">
              Varredura parcial: a conta tem mais anúncios do que o Mercado Livre entrega numa busca
              (teto de 1.000).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Grupo({ tom, titulo, ajuda, itens }: {
  tom: 'destructive' | 'warning';
  titulo: string;
  ajuda: string;
  itens: AnuncioOrfao[];
}) {
  const cor = tom === 'destructive' ? 'text-destructive' : 'text-warning';
  return (
    <div>
      <p className={`flex items-center gap-1.5 text-sm font-medium ${cor}`}>
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {titulo}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {itens.map((o) => <Item key={o.mlItemId} o={o} destaque={tom} />)}
      </ul>
    </div>
  );
}

function Item({ o, destaque }: { o: AnuncioOrfao; destaque?: 'destructive' | 'warning' }) {
  const borda = destaque === 'destructive'
    ? 'border-destructive/30 bg-destructive/5'
    : destaque === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-border';
  return (
    <li className={`rounded-md border px-2 py-1.5 text-xs ${borda}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium">{o.titulo ?? o.mlItemId}</span>
        <span className="text-muted-foreground">{o.mlItemId}</span>
        {o.status && <span className="text-muted-foreground">· {o.status}</span>}
        {o.estoque != null && <span className="text-muted-foreground">· {o.estoque} un.</span>}
        {o.sku && <span className="text-muted-foreground">· código {o.sku}</span>}
        {o.permalink && (
          <a href={o.permalink} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            abrir no ML
          </a>
        )}
      </div>
    </li>
  );
}

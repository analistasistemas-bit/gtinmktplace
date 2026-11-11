// ADR-0201 (Task 7b): Galeria IA da linha de Publicados. Identidade = `ml_item_id` da linha (+ `codigo_pai` só para o
// título); a família vigente volta da edge e é ela que a tela reenvia. Passos: fatos/referências → roteiro.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  ERROS_DE_RECARGA, lerRoteiro, listarImagens, mensagemErro, montarFicha,
  type Ficha, type Res, type RespostaRoteiro,
} from '@/lib/galeria/api';
import { PassoFatos } from './passo-fatos';
import { PassoRoteiro } from './passo-roteiro';
import { PassoGerar } from './passo-gerar';
import { PassoAplicar } from './passo-aplicar';

type Falha = Extract<Res<unknown>, { ok: false }>;

export function DialogGaleria({ mlItemId, codigoPai, open, onOpenChange, isAdmin }: {
  mlItemId: string; codigoPai: string; open: boolean; onOpenChange: (v: boolean) => void; isAdmin: boolean;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [resp, setResp] = useState<RespostaRoteiro | null>(null);
  const [moda, setModa] = useState<boolean | null>(null);
  const [passo, setPasso] = useState<'fatos' | 'roteiro' | 'gerar' | 'aplicar'>('fatos');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Id da abertura/recarga em curso: respostas de aberturas antigas (troca de anúncio, recarga) são descartadas.
  const abertura = useRef(0);
  // `ler` respondeu nesta abertura: só então a aba Roteiro sabe se há roteiro vigente e pode oferecer "Criar roteiro".
  const [roteiroLido, setRoteiroLido] = useState(false);
  // Galeria com algo a mostrar: roteiro aprovado do anúncio (mesmo com rascunho por cima) ou cena não exibida.
  const [temGaleria, setTemGaleria] = useState(false);

  const carregar = useCallback(async () => {
    const id = ++abertura.current;
    setCarregando(true); setRoteiroLido(false);
    // Sequencial: `montar` pode chamar a visão paga e desatualizar o roteiro; `ler` só depois, já vendo esse estado.
    const r = await montarFicha(mlItemId);
    if (id !== abertura.current) return;
    // Não limpa o erro: a mensagem que motivou a recarga (categoria_mudou etc.) tem de sobreviver a ela.
    if (!r.ok) { setErro(mensagemErro(r.erro)); setCarregando(false); return; }
    const l = await lerRoteiro(mlItemId);
    if (id !== abertura.current) return;
    // Ficha e roteiro entram juntos, ao fim da mesma abertura.
    setFicha(r.dados);
    if (l.ok) {
      // Moda só vale se a edge a leu ao vivo (null = desconhecida: nada de Moda é oferecido).
      setModa(l.dados.moda);
      setResp(l.dados.roteiro ? (l.dados as RespostaRoteiro) : null);
      setRoteiroLido(true);
      if (l.dados.aviso) setErro(mensagemErro(l.dados.aviso));
    } else setErro(mensagemErro(l.erro));
    // Depois do `ler`, na mesma abertura: só leitura, nunca cobra.
    const g = await listarImagens(mlItemId);
    if (id !== abertura.current) return;
    setTemGaleria(g.ok && (!!g.dados.roteiro || g.dados.imagens.some((i) => i.origem === 'gerador' && !i.exibida)));
    setCarregando(false);
  }, [mlItemId]);

  useEffect(() => {
    if (!open) return;
    setFicha(null); setResp(null); setModa(null); setPasso('fatos'); setTemGaleria(false);
    void carregar();
    // Contador, não nó do DOM: invalidar a abertura em curso é exatamente o que a limpeza quer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { abertura.current++; };
  }, [open, carregar]);

  /** Falha de qualquer ação: mensagem clara; erros que invalidam o chão recarregam a ficha e descartam o roteiro em tela. */
  const falhou = useCallback((f: Falha) => {
    setErro(mensagemErro(f.erro));
    if (f.erro === 'roteiro_invalido') {
      setResp((r) => (r ? { ...r, erros: (f.corpo.erros as string[]) ?? r.erros, erros_por_missao: (f.corpo.erros_por_missao as Record<string, string[]>) ?? r.erros_por_missao } : r));
    } else if (f.erro === 'ciencia_pendente') {
      setResp((r) => (r ? { ...r, ciencia_pendente: (f.corpo.campos as string[]) ?? r.ciencia_pendente } : r));
    }
    if (ERROS_DE_RECARGA.has(f.erro)) { setResp(null); void carregar(); }
  }, [carregar]);

  const aoMudarFicha = useCallback((r: Res<Ficha>) => {
    if (r.ok) { setFicha(r.dados); setErro(null); } else falhou(r);
  }, [falhou]);

  const roteiroAprovado = useCallback(() => {
    toast.success('Roteiro aprovado');
    void carregar();
  }, [carregar]);

  // Passo 3 com roteiro aprovado ou imagem pendente de exibição (pedido novo continua exigindo aprovado vigente).
  const podeGerar = resp?.roteiro.status === 'aprovado' || temGaleria;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Galeria IA · {codigoPai}</DialogTitle>
          <DialogDescription>Confira os fatos do produto e aprove o roteiro das imagens.</DialogDescription>
        </DialogHeader>

        {erro && <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">{erro}</p>}
        {carregando && <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="Carregando" />}

        {ficha && !carregando && (
          <>
            <div role="tablist" className="flex gap-2">
              <Button role="tab" aria-selected={passo === 'fatos'} size="sm" variant={passo === 'fatos' ? 'default' : 'outline'}
                onClick={() => setPasso('fatos')}>1. Fatos e referências</Button>
              <Button role="tab" aria-selected={passo === 'roteiro'} size="sm" variant={passo === 'roteiro' ? 'default' : 'outline'}
                onClick={() => setPasso('roteiro')}>2. Roteiro</Button>
              {podeGerar && (
                <Button role="tab" aria-selected={passo === 'gerar'} size="sm" variant={passo === 'gerar' ? 'default' : 'outline'}
                  onClick={() => setPasso('gerar')}>3. Gerar</Button>
              )}
              {podeGerar && (
                <Button role="tab" aria-selected={passo === 'aplicar'} size="sm" variant={passo === 'aplicar' ? 'default' : 'outline'}
                  onClick={() => setPasso('aplicar')}>4. Aplicar</Button>
              )}
            </div>
            {passo === 'fatos'
              ? <PassoFatos mlItemId={mlItemId} ficha={ficha} moda={moda} aoMudar={aoMudarFicha} />
              : passo === 'aplicar' && podeGerar
                ? <PassoAplicar mlItemId={mlItemId} ficha={ficha} isAdmin={isAdmin} aoFamiliaMudou={(m) => { setErro(m); setResp(null); void carregar(); }} />
              : passo === 'gerar' && podeGerar
                ? <PassoGerar mlItemId={mlItemId} ficha={ficha} aoRecarregar={() => void carregar()} aoVoltarRoteiro={() => setPasso('roteiro')} />
                : <PassoRoteiro mlItemId={mlItemId} ficha={ficha} isAdmin={isAdmin} resp={resp} podeCriar={roteiroLido}
                aoResposta={(r) => { setResp(r); setModa(r.roteiro.moda); setErro(null); }} aoFalhar={falhou} aoAprovar={roteiroAprovado} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

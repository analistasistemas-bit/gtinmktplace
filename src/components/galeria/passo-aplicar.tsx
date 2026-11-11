// ADR-0201 (Task 15): passo "Aplicar". Troca as fotos aprovadas de uma cor no Mercado Livre e reverte. Só admin (ADR-0060).
// Fluxo: Preparar (nunca escreve no ML; a edge congela o manifesto) → confirmação com os MLB e as imagens na ordem →
// Confirmar (a saga roda no servidor). A tela só acompanha: lê o estado a cada 5 s enquanto houver aplicação em
// andamento, abortando ou revertendo; para ao sair do passo/fechar o diálogo. Toda ação leva o `ml_item_id` da linha.
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  APLICACAO_EM_ANDAMENTO, confirmarAplicacao, ERROS_DE_RECARGA, estadoAplicacoes, mensagemErro, prepararAplicacao,
  reverterAplicacao, type AplicacaoPreparada, type EstadoAplicacao, type Ficha, type ModoAplicar, type Res,
} from '@/lib/galeria/api';

const POLLING_MS = 5000;
const SO_ADMIN = 'Somente administradores podem aplicar ou reverter fotos';
const STATUS: Record<string, string> = {
  preparada: 'Preparada', em_andamento: 'Aplicando…', aplicada: 'Aplicada', abortando: 'Abortando…', falhou: 'Falhou',
  revertendo: 'Revertendo…', revertida: 'Revertida', reversao_incompleta: 'Reversão incompleta',
  pendente: 'Na fila', subindo: 'Enviando fotos', aplicando: 'Aplicando', aplicado: 'Aplicado', compensando: 'Revertendo',
  compensado: 'Revertido', pulado: 'Não alterado',
};
// Itens que pedem atenção do operador: vermelho, com o MLB.
const PROBLEMA = new Set(['reversao_incompleta', 'pulado', 'falhou']);
// Mensagens próprias deste passo (as de `api.ts` falam da aprovação de imagem).
const MENSAGENS: Record<string, string> = {
  desatualizada: 'O roteiro ou os fatos mudaram desde a preparação. Prepare de novo.',
  mudou: 'As fotos do anúncio mudaram no Mercado Livre desde a preparação. Prepare de novo.',
  nao_encontrada: 'Aplicação não encontrada neste anúncio.',
};
const NOVA_PREPARACAO = new Set(['mudou', 'desatualizada']);

type Falha = Extract<Res<unknown>, { ok: false }>;

export function PassoAplicar({ mlItemId, ficha, isAdmin, aoRecarregar }: {
  mlItemId: string; ficha: Ficha; isAdmin: boolean; aoRecarregar: () => void;
}) {
  const [cor, setCor] = useState(ficha.cores[0] ?? '');
  const [modo, setModo] = useState<ModoAplicar>('substituir');
  const [preparada, setPreparada] = useState<AplicacaoPreparada | null>(null);
  const [aplicacoes, setAplicacoes] = useState<EstadoAplicacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rodar = async () => {
      const r = await estadoAplicacoes(mlItemId);
      if (!vivo) return;
      // Falha passageira (rede/5xx) reagenda; recusa (4xx) para.
      if (!r.ok) { if (r.status === 0 || r.status >= 500) timer = setTimeout(rodar, POLLING_MS); return; }
      setAplicacoes(r.dados.aplicacoes);
      if (r.dados.aplicacoes.some((a) => APLICACAO_EM_ANDAMENTO.has(a.status))) timer = setTimeout(rodar, POLLING_MS);
    };
    void rodar();
    return () => { vivo = false; clearTimeout(timer); };
  }, [mlItemId, rodada]);

  const falhou = useCallback((f: Falha) => {
    const base = MENSAGENS[f.erro] ?? mensagemErro(f.erro);
    const onde = [f.corpo.item_id, f.corpo.detalhe].filter((x): x is string => typeof x === 'string').join(' · ');
    setErro(onde ? `${base} (${onde})` : base);
    if (NOVA_PREPARACAO.has(f.erro)) setPreparada(null);
    if (f.erro === 'limite') setModo('substituir');
    if (ERROS_DE_RECARGA.has(f.erro)) { setPreparada(null); aoRecarregar(); }
  }, [aoRecarregar]);

  const rodarAcao = async <T,>(acao: () => Promise<Res<T>>, aoOk: (d: T) => void) => {
    setOcupado(true); setErro(null);
    const r = await acao();
    setOcupado(false);
    if (r.ok) aoOk(r.dados); else falhou(r);
  };

  const preparar = () => rodarAcao(() => prepararAplicacao(mlItemId, cor, modo), setPreparada);
  const confirmar = () => rodarAcao(() => confirmarAplicacao(mlItemId, preparada!.aplicacao_id), () => {
    toast.success('Aplicação iniciada'); setPreparada(null); setRodada((n) => n + 1);
  });
  const reverter = (id: string) => rodarAcao(() => reverterAplicacao(mlItemId, id), () => {
    toast.success('Reversão iniciada'); setRodada((n) => n + 1);
  });

  const bloqueio = isAdmin ? undefined : SO_ADMIN;

  return (
    <div className="space-y-4">
      {erro && <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">{erro}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded border p-3 text-sm">
        <div className="space-y-1">
          <p className="font-medium">Cor</p>
          <Select value={cor} onValueChange={(v) => { setCor(v); setPreparada(null); }}>
            <SelectTrigger aria-label="Cor" className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{ficha.cores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="font-medium">Modo</p>
          <Select value={modo} onValueChange={(v) => { setModo(v as ModoAplicar); setPreparada(null); }}>
            <SelectTrigger aria-label="Modo" className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="substituir">Substituir</SelectItem>
              <SelectItem value="adicionar">Adicionar</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" disabled={!isAdmin || ocupado || !cor} title={bloqueio ?? 'Preparar a troca das fotos'} onClick={() => void preparar()}>
          {ocupado && !preparada && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preparar
        </Button>
      </div>

      {preparada && (
        <div className="space-y-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Isto troca as fotos dos anúncios abaixo no Mercado Livre.</p>
          <ul aria-label="Anúncios afetados" className="list-inside list-disc">
            {preparada.itens.map((i) => <li key={i}>{i}</li>)}
          </ul>
          <p className="font-medium">Imagens ({modo === 'substituir' ? 'substituem as fotos da cor' : 'entram depois das fotos da cor'}), na ordem:</p>
          <ol aria-label="Imagens na ordem" className="list-inside list-decimal">
            {preparada.manifesto.map((m) => <li key={m.imagem_id}>Missão {m.missao}</li>)}
          </ol>
          <div className="flex gap-2">
            <Button size="sm" disabled={!isAdmin || ocupado} title={bloqueio ?? 'Confirmar a troca'} onClick={() => void confirmar()}>
              {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar e trocar no ML
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setPreparada(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {aplicacoes.length > 0 && (
        <ul aria-label="Aplicações" className="space-y-2">
          {aplicacoes.map((a) => (
            <li key={a.id} className="space-y-1 rounded border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className={PROBLEMA.has(a.status) ? 'font-medium text-red-600' : 'font-medium'}>
                  {a.cor} · {a.modo === 'substituir' ? 'Substituir' : 'Adicionar'} · {STATUS[a.status] ?? a.status}
                </p>
                {a.status === 'aplicada' && (
                  <Button size="sm" variant="outline" disabled={!isAdmin || ocupado} title={bloqueio ?? 'Voltar as fotos anteriores'}
                    onClick={() => void reverter(a.id)}>Reverter</Button>
                )}
              </div>
              <ul className="space-y-0.5">
                {a.itens.map((i) => (
                  <li key={i.item_id} className={PROBLEMA.has(i.status) ? 'text-red-600' : 'text-muted-foreground'}>
                    {i.item_id}: {STATUS[i.status] ?? i.status}{i.erro ? ` (${i.erro})` : ''}
                    {i.status === 'reversao_incompleta' && ' — confira as fotos no Mercado Livre'}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

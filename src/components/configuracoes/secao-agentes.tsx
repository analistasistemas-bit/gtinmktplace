import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { BotaoCopiar } from '@/components/ui/botao-copiar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MCP_URL, criarConexaoAgente, useAgenteConexoes, useChamadasConexao, useInvalidarConexoes, useRevogarConexao,
  type ConexaoAgente, type ConexaoCriada, type Validade,
} from '@/hooks/useAgenteConexoes';
import { LinhasCarregando, SettingsGroup, SettingsRow } from './settings-row';

const fmtData = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

function situacao(c: ConexaoAgente): 'ativa' | 'revogada' | 'expirada' {
  if (c.revogada_em) return 'revogada';
  return new Date(c.expira_em).getTime() > Date.now() ? 'ativa' : 'expirada';
}
const PILL = {
  ativa: <StatusPill tone="success">Ativa</StatusPill>,
  expirada: <StatusPill tone="warning">Expirada</StatusPill>,
  revogada: <StatusPill tone="neutral">Revogada</StatusPill>,
};

/** Seção "Agentes" (ADR-0210, fatia 1): só admin fora de sessão de suporte, com o módulo `agentes`. */
export function SecaoAgentes() {
  const { data, isLoading, isError } = useAgenteConexoes();
  const [novaAberta, setNovaAberta] = useState(false);
  const [revogando, setRevogando] = useState<ConexaoAgente | null>(null);
  const [vendo, setVendo] = useState<ConexaoAgente | null>(null);
  const revogar = useRevogarConexao();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setNovaAberta(true)}>Nova conexão</Button>
      </div>

      <SettingsGroup
        titulo="Conexões de agentes"
        descricao="Cada conexão dá a um agente de IA (Claude, ChatGPT e afins) acesso de leitura às margens desta loja."
      >
        {isLoading && <LinhasCarregando linhas={2} />}
        {isError && <p className="px-4 py-3.5 text-sm text-destructive">Não foi possível carregar as conexões.</p>}
        {data && data.length === 0 && (
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Nenhuma conexão criada.</p>
        )}
        {data?.map((c) => {
          const s = situacao(c);
          return (
            <SettingsRow
              key={c.id}
              titulo={c.nome}
              descricao={`Chave pai_${c.prefixo}_… · Validade até ${fmtData(c.expira_em)} · Último uso: ${c.ultimo_uso_em ? fmtData(c.ultimo_uso_em) : 'nunca'}`}
              estado={PILL[s]}
            >
              <Button size="sm" variant="ghost" onClick={() => setVendo(c)}>Ver chamadas</Button>
              {s === 'ativa' && (
                <Button size="sm" variant="outline" onClick={() => setRevogando(c)}>Revogar</Button>
              )}
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      <DialogNovaConexao aberto={novaAberta} onFechar={() => setNovaAberta(false)} />

      <AlertDialog open={!!revogando} onOpenChange={(v) => { if (!v) setRevogando(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar “{revogando?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente que usa esta chave perde o acesso na hora. Não dá para desfazer: para voltar, crie uma conexão nova.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!revogando) return;
                revogar.mutate(revogando.id, {
                  onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível revogar a conexão.'),
                });
              }}
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DialogChamadas conexao={vendo} onFechar={() => setVendo(null)} />
    </div>
  );
}

export function DialogNovaConexao({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const invalidar = useInvalidarConexoes();
  const [nome, setNome] = useState('');
  const [dias, setDias] = useState<Validade>(90);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // A chave vive só aqui, em estado local: sai da memória do React ao fechar (nem React Query, nem localStorage).
  const [criada, setCriada] = useState<ConexaoCriada | null>(null);
  const [copiado, setCopiado] = useState(false);
  // Cada fechamento abre uma "sessão" nova: resposta que chega depois de fechar não grava a chave.
  const sessao = useRef(0);
  useEffect(() => { if (!aberto) sessao.current += 1; }, [aberto]);

  function fechar() {
    sessao.current += 1;
    setNome(''); setDias(90); setErro(null); setCriada(null); setCopiado(false); setEnviando(false);
    onFechar();
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const minha = sessao.current;
    setEnviando(true); setErro(null);
    try {
      const r = await criarConexaoAgente(nome.trim(), dias);
      void invalidar();
      if (minha === sessao.current) setCriada(r);
    } catch (err) {
      if (minha === sessao.current) setErro(err instanceof Error ? err.message : 'Não foi possível criar a conexão.');
    } finally {
      if (minha === sessao.current) setEnviando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  // Enviando: nada fecha (a chave ficaria órfã). Com a chave na tela: só "Concluir" fecha.
  const travado = enviando || !!criada;
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v && !travado) fechar(); }}>
      <DialogContent
        processando={enviando}
        showCloseButton={!travado}
        onInteractOutside={(e) => { if (travado) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (travado) e.preventDefault(); }}
      >
        {criada ? (
          <>
            <DialogHeader>
              <DialogTitle>Conexão criada</DialogTitle>
              <DialogDescription>Configure o agente com a chave e o endereço abaixo.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="agente-chave" className="mb-1 block text-xs font-medium text-muted-foreground">Chave</label>
                <div className="flex gap-2">
                  <Input id="agente-chave" readOnly value={criada.chave} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                  <Button type="button" variant="outline" size="sm" onClick={() => void copiar(criada.chave)}>
                    {copiado ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs font-medium text-warning">Esta chave não será exibida de novo.</p>
              </div>
              <div>
                <label htmlFor="agente-url" className="mb-1 block text-xs font-medium text-muted-foreground">Endereço do servidor MCP</label>
                <div className="flex items-center gap-2">
                  <Input id="agente-url" readOnly value={MCP_URL} className="font-mono text-xs" />
                  <BotaoCopiar texto={MCP_URL} rotulo="Copiar endereço" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={fechar}>Concluir</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Nova conexão</DialogTitle>
              <DialogDescription>Dê um nome para reconhecer o agente depois.</DialogDescription>
            </DialogHeader>
            <div>
              <label htmlFor="agente-nome" className="mb-1 block text-sm font-medium">Nome</label>
              <Input id="agente-nome" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Claude do Diego" />
            </div>
            <div>
              <label htmlFor="agente-validade" className="mb-1 block text-sm font-medium">Validade</label>
              <Select value={String(dias)} onValueChange={(v) => setDias(Number(v) as Validade)}>
                <SelectTrigger id="agente-validade" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="90">90 dias</SelectItem>
                  <SelectItem value="365">365 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={enviando} onClick={fechar}>Cancelar</Button>
              <Button type="submit" disabled={enviando || !nome.trim()}>Criar</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Nomes gravados pela edge `agentes` (`_shared/agentes/mcp.ts`); fora do mapa aparece como veio.
const FERRAMENTAS: Record<string, string> = {
  publiai_loja: 'Loja',
  publiai_margem_anuncio: 'Margem do anúncio',
  publiai_margens_catalogo: 'Margens do catálogo',
  publiai_simular_margem: 'Simulação de preço',
  desconhecida: 'Ferramenta desconhecida',
};
const RESULTADOS: Record<string, string> = {
  ok: 'Concluída',
  nao_encontrado: 'Não encontrado',
  candidatos: 'Vários resultados',
  erro: 'Erro',
  limite_tarifas: 'Limite diário atingido',
  indisponivel: 'Indisponível',
};

function DialogChamadas({ conexao, onFechar }: { conexao: ConexaoAgente | null; onFechar: () => void }) {
  const { data, isLoading, isError } = useChamadasConexao(conexao?.id ?? null);
  return (
    <Dialog open={!!conexao} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chamadas de “{conexao?.nome}”</DialogTitle>
          <DialogDescription>As 50 mais recentes.</DialogDescription>
        </DialogHeader>
        {isLoading && <LinhasCarregando linhas={2} />}
        {isError && <p className="text-sm text-destructive">Não foi possível carregar as chamadas.</p>}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma chamada registrada.</p>}
        {data && data.length > 0 && (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Data</TableHead><TableHead>Ferramenta</TableHead><TableHead>Alvo</TableHead><TableHead>Resultado</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{fmtData(c.criado_em)}</TableCell>
                    <TableCell>{FERRAMENTAS[c.ferramenta] ?? c.ferramenta}</TableCell>
                    <TableCell>{c.alvo ?? '—'}</TableCell>
                    <TableCell>{RESULTADOS[c.resultado] ?? c.resultado}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

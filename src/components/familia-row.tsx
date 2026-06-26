import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { useImageUrl } from '@/hooks/useImageUrl';
import { useDescontoPct } from '@/hooks/useConfiguracoes';
import { useUpdateExibirDesconto, useUpdateDescontoPctFamilia, useReprocessar, useUpdateFamiliaAtacado } from '@/hooks/useFamiliaMutations';
import { calcularPrecoDe, pctEfetivo } from '@/lib/desconto';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { AtacadoEditor } from '@/components/atacado-editor';
import { cn } from '@/lib/utils';
import type { Familia } from '@/lib/tipos-dominio';
import { familiaPublicavel, criticasVariacao, familiaIncompleta, variacoesEstoqueAlterado, familiaExigeCor } from '@/lib/publicavel';
import { coresNovasComEstoque, coresSemFotoExcluidas } from '@/lib/revisao-variacoes';

interface FamiliaRowProps {
  familia: Familia;
  selecionada: boolean;
  expandida: boolean;
  onSelecionar: (id: string, valor: boolean) => void;
  onExpandir: (id: string) => void;
  onIrParaCritica?: (familiaId: string, codigo: string) => void;
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DescontoControle({ familia }: { familia: Familia }) {
  const { data: globalPct } = useDescontoPct();
  const updExibir = useUpdateExibirDesconto(familia.loteId);
  const updPct = useUpdateDescontoPctFamilia(familia.loteId);
  const pct = pctEfetivo(familia.descontoPct, globalPct ?? 15);
  // Preço de venda real (mesma fonte do card "Você recebe", painel-analise): menor
  // preço de PUBLICAÇÃO das cores incluídas — não o preço da planilha. Reage à edição.
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const baseVariacoes = incluidas.length > 0 ? incluidas : familia.variacoes;
  const precoVenda = baseVariacoes.length > 0
    ? Math.min(...baseVariacoes.map((v) => v.precoPublicacao ?? v.preco))
    : 0;
  const de = calcularPrecoDe(precoVenda, pct);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Checkbox
        aria-label="Exibir com desconto"
        checked={familia.exibirComDesconto}
        onCheckedChange={(v) => updExibir.mutate({ familiaId: familia.id, exibir: !!v })}
      />
      <span>Exibir com desconto</span>
      {familia.exibirComDesconto && (
        <>
          <Input
            type="number"
            min={0}
            max={99}
            className="w-14"
            defaultValue={familia.descontoPct ?? globalPct ?? 15}
            onBlur={(e) => {
              const n = Number(e.target.value);
              updPct.mutate({ familiaId: familia.id, pct: Number.isFinite(n) ? n : null });
            }}
          />
          <span>%</span>
          {de != null && (
            <span className="text-muted-foreground">
              <s>R$ {formatarBRL(de)}</s> · R$ {formatarBRL(precoVenda)} · {pct}% OFF
            </span>
          )}
        </>
      )}
    </div>
  );
}

function AtacadoControle({ familia }: { familia: Familia }) {
  const upd = useUpdateFamiliaAtacado(familia.loteId);
  const [faixas, setFaixas] = useState<FaixaAtacado[]>(familia.atacado ?? []);
  // Re-sincroniza quando o valor salvo muda no servidor (ex.: aplicar atacado no lote).
  // Dep por conteúdo serializado: refetch que devolve o mesmo valor NÃO dispara (não
  // atrapalha edição em andamento); só ressincroniza quando o conteúdo realmente muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setFaixas(familia.atacado ?? []); }, [JSON.stringify(familia.atacado ?? [])]);
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;
  const precoBase = base.length > 0 ? Math.min(...base.map((v) => v.precoPublicacao ?? v.preco)) : 0;
  const ativo = faixas.length > 0;
  const erro = validarFaixas(faixas);
  const dirty = JSON.stringify(faixas) !== JSON.stringify(familia.atacado ?? []);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          aria-label="Preço de atacado"
          checked={ativo}
          onCheckedChange={(v) => {
            if (v) setFaixas(faixas.length ? faixas : [{ min_unidades: 5, desconto_pct: 5 }]);
            else { setFaixas([]); upd.mutate({ familiaId: familia.id, faixas: [] }); }
          }}
        />
        <span>Preço de atacado</span>
        {familia.atacado && familia.atacado.length > 0 && (
          <span className="text-muted-foreground">({familia.atacado.length} faixa(s) salva(s))</span>
        )}
      </div>
      {ativo && (
        <div className="pl-6">
          <AtacadoEditor faixas={faixas} precoBase={precoBase} onChange={setFaixas} />
          <Button
            type="button" size="sm" className="mt-1 h-7 text-xs"
            disabled={!!erro || !dirty || upd.isPending}
            onClick={() => upd.mutate({ familiaId: familia.id, faixas })}
          >
            {upd.isPending ? 'Salvando…' : dirty ? 'Salvar atacado' : '✓ Salvo'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function FamiliaRow({ familia, selecionada, expandida, onSelecionar, onExpandir, onIrParaCritica }: FamiliaRowProps) {
  const { data: capaUrl } = useImageUrl(familia.capaStoragePath ?? familia.fotoCapaPath);
  const reprocessar = useReprocessar(familia.loteId);
  const pub = familiaPublicavel(familia);
  const exigeCor = familiaExigeCor(familia);
  const publicado = familia.status === 'publicado';
  const emErro = familia.status === 'erro';
  // 1ª cor com pendência (sem foto/cor/preço): o selo de bloqueio leva direto a ela.
  const primeiraCritica = publicado
    ? undefined
    : familia.variacoes.find((v) => criticasVariacao(v, familia.operacao, { exigeCor }).length > 0);
  // Resumo do UPDATE na linha recolhida: quantas cores têm estoque alterado
  // (mesma regra do DiffEstoque). Dá o "o que será atualizado" sem precisar expandir.
  const coresComEstoqueAlterado = variacoesEstoqueAlterado(familia).length;
  // Cores novas que de fato exigem ação (sem ml_variation_id e com estoque): precisam
  // de foto. Estoque 0 dorme e não conta. Sinaliza na linha sem precisar expandir.
  const novasComFoto = coresNovasComEstoque(familia).length;
  // CREATE: cores que vieram desmarcadas por não terem foto (estoque > 0). Avisa na
  // linha o que ficou de fora da publicação. No UPDATE o selo "cores novas" já cobre.
  const coresSemFoto = familia.operacao === 'CREATE' ? coresSemFotoExcluidas(familia) : [];
  const semFotoFora = coresSemFoto.length;
  const removidas = familia.mudancaEstrutural?.removidas.length ?? 0;
  // Acento lateral por status, para escanear a lista sem ler cada pill.
  // Prioridade: erro > precisa-ação > publicado > editado pelo operador > nenhum.
  // CREATE/UPDATE não pintam o acento (já têm pill própria) p/ evitar "carnaval".
  const precisaAcao =
    familiaIncompleta(familia) || novasComFoto > 0 || semFotoFora > 0 || (exigeCor && familia.variacoesSemCor > 0);
  const acentoStatus = emErro
    ? 'border-l-destructive'
    : precisaAcao
      ? 'border-l-warning'
      : publicado
        ? 'border-l-success'
        : familia.editadoPeloOperador
          ? 'border-l-primary'
          : 'border-l-transparent';
  // Preço exibido no cabeçalho = preço de venda real (publicação) das cores incluídas,
  // não o da planilha (no UPDATE eles diferem: planilha vs. preço já publicado).
  const incluidasPub = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const basePub = incluidasPub.length > 0 ? incluidasPub : familia.variacoes;
  const precosPub = basePub.map((v) => v.precoPublicacao ?? v.preco);
  const precoVendaMin = precosPub.length > 0 ? Math.min(...precosPub) : 0;
  const precoVendaMax = precosPub.length > 0 ? Math.max(...precosPub) : 0;
  return (
    <div
      className={cn('border-b border-l-2', acentoStatus)}
    >
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expandida}
      aria-label={expandida ? 'Recolher família' : 'Expandir família'}
      onClick={(e) => {
        // Ignora cliques que nasceram em controles interativos da linha
        // (checkbox de seleção, link "publicado ↗") para não expandir sem querer.
        if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
        onExpandir(familia.id);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onExpandir(familia.id);
        }
      }}
      className="grid cursor-pointer select-none grid-cols-[24px_40px_1fr_32px] sm:grid-cols-[24px_40px_1fr_80px_140px_40px] items-start sm:items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/50"
    >
      <Checkbox
        aria-label="Selecionar família"
        checked={selecionada}
        disabled={!pub.ok}
        onCheckedChange={(v) => onSelecionar(familia.id, v === true)}
      />
      {capaUrl ? (
        <img
          src={capaUrl}
          alt={familia.titulo}
          className="h-8 w-8 rounded border object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="h-8 w-8 rounded bg-muted"
          style={
            familia.variacoes[0]
              ? { backgroundColor: familia.variacoes[0].corHex }
              : undefined
          }
        />
      )}
      <div className="min-w-0">
        <div className="font-medium truncate">{familia.titulo}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
          <span>PAI {familia.codigoPai} · {familia.variacoes.length} cores</span>
          <span className="sm:hidden font-medium text-foreground flex items-center gap-1 border rounded px-1.5 py-0.5">
            {familia.operacao} · R$ {formatarBRL(precoVendaMin)}
          </span>
          {emErro && (
            <>
              <StatusPill tone="danger" title={familia.erroMensagem ?? undefined}>
                ⚠ erro{familia.erroMensagem ? `: ${familia.erroMensagem}` : ''}
              </StatusPill>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={reprocessar.isPending}
                onClick={() =>
                  reprocessar.mutate(
                    { familiaId: familia.id },
                    {
                      onSuccess: (r) =>
                        toast.success(
                          r.reenviadas > 0
                            ? 'Família reenviada para processamento'
                            : 'Nada para reenviar (já não estava em erro)',
                        ),
                      onError: (e) =>
                        toast.error('Falha ao reenviar', {
                          description: e instanceof Error ? e.message : String(e),
                        }),
                    },
                  )
                }
              >
                <RotateCw className={cn('mr-1 h-3 w-3', reprocessar.isPending && 'animate-spin')} />
                {reprocessar.isPending ? 'Reenviando…' : 'Reenviar'}
              </Button>
            </>
          )}
          {!publicado && familia.operacao === 'UPDATE' && (
            <StatusPill tone="info">
              {coresComEstoqueAlterado > 0
                ? `Estoque atualizado: ${coresComEstoqueAlterado} cor(es)`
                : 'sem mudança de estoque'}
            </StatusPill>
          )}
          {exigeCor && familia.variacoesSemCor > 0 && (
            <StatusPill tone="danger">
              ⚠ {familia.variacoesSemCor} sem cor
            </StatusPill>
          )}
          {familiaIncompleta(familia) && (
            primeiraCritica && onIrParaCritica ? (
              <button
                type="button"
                onClick={() => onIrParaCritica(familia.id, primeiraCritica.codigo)}
                title={`${pub.motivos.join('\n')}\n\nClique para ir até a cor com pendência`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusPill tone="warning" className="cursor-pointer hover:bg-warning/20">
                  🔒 {pub.motivos[0]}{pub.motivos.length > 1 ? ` (+${pub.motivos.length - 1})` : ''}
                </StatusPill>
              </button>
            ) : (
              <StatusPill
                tone="warning"
                title={pub.motivos.join('\n')}
              >
                🔒 {pub.motivos[0]}{pub.motivos.length > 1 ? ` (+${pub.motivos.length - 1})` : ''}
              </StatusPill>
            )
          )}
          {publicado && (
            familia.mlPermalink ? (
              <a
                href={familia.mlPermalink}
                target="_blank"
                rel="noreferrer"
                aria-label={familia.operacao === 'UPDATE' ? 'Abrir anúncio atualizado no Mercado Livre' : 'Abrir anúncio publicado no Mercado Livre'}
                className="rounded-full underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusPill tone="success" className="hover:bg-success/20">
                  {familia.operacao === 'UPDATE' ? '✓ atualizado ↗' : '✓ publicado ↗'}
                </StatusPill>
              </a>
            ) : (
              <StatusPill tone="success">
                {familia.operacao === 'UPDATE' ? '✓ atualizado' : '✓ publicado'}
              </StatusPill>
            )
          )}
          {publicado && familia.atacado && familia.atacado.length > 0 && (
            <StatusPill
              tone={familia.atacadoStatus === 'erro' ? 'danger' : 'success'}
              title={familia.atacadoStatus === 'erro' ? (familia.atacadoErro ?? 'Falha no atacado') : 'Preço de atacado aplicado'}
            >
              {familia.atacadoStatus === 'erro' ? 'atacado ⚠' : 'atacado ✓'}
            </StatusPill>
          )}
          {novasComFoto > 0 && (
            <StatusPill tone="warning" title="Cores novas que precisam de foto antes de publicar">
              📷 {novasComFoto} cor(es) nova(s)
            </StatusPill>
          )}
          {semFotoFora > 0 && (
            onIrParaCritica ? (
              <button
                type="button"
                onClick={() => onIrParaCritica(familia.id, coresSemFoto[0].codigo)}
                title="Clique para ir até a 1ª cor sem foto"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusPill tone="warning" className="cursor-pointer hover:bg-warning/20">
                  📷 {semFotoFora} sem foto
                </StatusPill>
              </button>
            ) : (
              <StatusPill tone="warning">
                📷 {semFotoFora} sem foto
              </StatusPill>
            )
          )}
          {removidas > 0 && (
            <StatusPill tone="warning" title={`${removidas} cor(es) da planilha sumiram (mantidas no anúncio)`}>
              ⚠ {removidas} cor(es) removida(s)
            </StatusPill>
          )}
        </div>
      </div>
      <div className="hidden sm:flex">
        <StatusPill tone={familia.operacao === 'CREATE' ? 'info' : 'neutral'}>
          {familia.operacao}
        </StatusPill>
      </div>
      <div className="hidden sm:flex items-center gap-1">
        <span className="tabular-nums">
          R$ {formatarBRL(precoVendaMin)}
          {precoVendaMin !== precoVendaMax && `-${formatarBRL(precoVendaMax)}`}
        </span>
        {familia.precoAbaixo20pc && (
          <AlertTriangle
            className="h-4 w-4 text-destructive"
            aria-label="Preço abaixo de 20% do seu preço da planilha"
          />
        )}
      </div>
      <span className="justify-self-center text-muted-foreground" aria-hidden="true">
        {expandida ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </span>
    </div>
      <div className="px-4 pb-2 pl-8 sm:pl-[100px] space-y-1">
        <DescontoControle familia={familia} />
        <AtacadoControle familia={familia} />
      </div>
    </div>
  );
}

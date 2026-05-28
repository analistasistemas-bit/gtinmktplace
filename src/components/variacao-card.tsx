import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { BotaoTrocarFoto } from '@/components/botao-trocar-foto';
import { BadgeCorOrigem } from '@/components/badge-cor-origem';
import { useImageUrl } from '@/hooks/useImageUrl';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK } from '@/lib/queries';
import type { Variacao } from '@/lib/tipos-dominio';

interface VariacaoCardProps {
  variacao: Variacao;
  loteId: string;
  statusPreco?: SaveStatus;
  statusCor?: SaveStatus;
  statusGtin?: SaveStatus;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
  onMudarGtin: (codigo: string, novoGtin: string) => void;
  onSalvarPreco?: (codigo: string) => void;
  onSalvarCor?: (codigo: string) => void;
  onSalvarGtin?: (codigo: string) => void;
}

export function VariacaoCard({
  variacao,
  loteId,
  statusPreco,
  statusCor,
  statusGtin,
  onMudarPreco,
  onMudarCor,
  onMudarGtin,
  onSalvarPreco,
  onSalvarCor,
  onSalvarGtin,
}: VariacaoCardProps) {
  const { data: imgUrl } = useImageUrl(variacao.fotoPath);
  const qc = useQueryClient();
  const [trocaStatus, setTrocaStatus] = useState<SaveStatus>(undefined);

  async function lidarTrocaFoto(arquivo: File) {
    const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpeg';
    const renomeado = new File([arquivo], `${variacao.codigo}.${ext}`, { type: arquivo.type });
    setTrocaStatus('salvando');
    try {
      await uploadImagensLote(loteId, [renomeado]);
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      setTrocaStatus('salvo');
      setTimeout(() => setTrocaStatus(undefined), 2000);
    } catch {
      setTrocaStatus('erro');
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-md bg-background p-2 text-sm">
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={variacao.cor || variacao.codigo}
          className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="mt-0.5 h-8 w-8 shrink-0 rounded border"
          style={{ backgroundColor: variacao.corHex }}
          aria-label={variacao.cor ? `Cor ${variacao.cor}` : 'Sem imagem'}
        />
      )}
      <BotaoTrocarFoto onArquivo={lidarTrocaFoto} desabilitado={trocaStatus === 'salvando'} />
      <div className="flex flex-1 flex-col gap-1">
        {/* Linha 1: cor */}
        <div className="flex items-center gap-2">
          <Input
            value={variacao.cor}
            onChange={(e) => onMudarCor(variacao.codigo, e.target.value)}
            onBlur={() => onSalvarCor?.(variacao.codigo)}
            className="h-7 flex-1"
          />
          <BadgeCorOrigem origem={variacao.cor ? variacao.corOrigem : null} />
          <div className="min-w-[60px]">
            <StatusInline status={statusCor} />
          </div>
        </div>
        {/* Linha 2: EAN/GTIN */}
        <div className="flex items-center gap-2">
          <Input
            value={variacao.gtin ?? ''}
            onChange={(e) => onMudarGtin(variacao.codigo, e.target.value)}
            onBlur={() => onSalvarGtin?.(variacao.codigo)}
            placeholder="EAN/GTIN"
            className="h-6 flex-1 border-muted bg-muted/40 text-xs text-muted-foreground placeholder:text-muted-foreground/60"
          />
          <div className="min-w-[60px]">
            <StatusInline status={statusGtin} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 pt-0.5">
        <Input
          type="number"
          step="0.01"
          value={variacao.preco}
          onChange={(e) => onMudarPreco(variacao.codigo, parseFloat(e.target.value) || 0)}
          onBlur={() => onSalvarPreco?.(variacao.codigo)}
          className="h-7 w-24"
        />
        <div className="min-w-[60px]">
          <StatusInline status={statusPreco ?? trocaStatus} />
        </div>
      </div>
      <div className="flex w-20 flex-col items-end leading-tight pt-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Estoque
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {new Intl.NumberFormat('pt-BR').format(variacao.estoque)}
        </span>
      </div>
    </div>
  );
}

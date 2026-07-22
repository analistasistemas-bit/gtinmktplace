import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { BotaoTrocarFoto } from '@/components/botao-trocar-foto';
import { BadgeCorOrigem } from '@/components/badge-cor-origem';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useImageUrl, invalidarImagem } from '@/hooks/useImageUrl';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK } from '@/lib/queries';
import { fmtBRL } from '@/lib/formato';
import type { Variacao } from '@/lib/tipos-dominio';
import { SemaforoPreco } from '@/components/semaforo-preco';

interface VariacaoCardProps {
  variacao: Variacao;
  loteId: string;
  statusPreco?: SaveStatus;
  statusCor?: SaveStatus;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
  onSalvarPreco?: (codigo: string) => void;
  onSalvarCor?: (codigo: string) => void;
  categoriaMlId: string | null;
  /** Alíquota de imposto por origem (ADR-0055) — mesma usada no card "Análise para publicação",
   *  para o semáforo desta linha não divergir do badge do topo. */
  aliquotaPct: number;
  /** Críticas da variação (ex.: "sem cor", "sem foto", "sem preço") — liga cada campo
   *  ao bloco de crítica correspondente (`#criticas-${codigo}`) via aria-describedby. */
  criticas?: string[];
}

export function VariacaoCard({
  variacao,
  loteId,
  statusPreco,
  statusCor,
  onMudarPreco,
  onMudarCor,
  onSalvarPreco,
  onSalvarCor,
  categoriaMlId,
  aliquotaPct,
  criticas = [],
}: VariacaoCardProps) {
  const { data: imgUrl } = useImageUrl(variacao.fotoPath);
  const qc = useQueryClient();
  const [trocaStatus, setTrocaStatus] = useState<SaveStatus>(undefined);
  const [fotoAberta, setFotoAberta] = useState(false);
  const criticaId = criticas.length > 0 ? `criticas-${variacao.codigo}` : undefined;

  const precoExterno = variacao.precoPublicacao ?? variacao.preco;
  const [valorStr, setValorStr] = useState(() => precoExterno.toString().replace('.', ','));

  useEffect(() => {
    setValorStr(precoExterno.toString().replace('.', ','));
  }, [precoExterno]);

  async function lidarTrocaFoto(arquivo: File) {
    const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpeg';
    const renomeado = new File([arquivo], `${variacao.codigo}.${ext}`, { type: arquivo.type });
    setTrocaStatus('salvando');
    try {
      await uploadImagensLote(loteId, [renomeado]);
      // Mesmo path do arquivo antigo: sem invalidar, a URL guardada continua servindo a foto
      // velha do cache do navegador, mesmo após F5 (ADR-0081).
      invalidarImagem(qc, variacao.fotoPath);
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      setTrocaStatus('salvo');
      setTimeout(() => setTrocaStatus(undefined), 2000);
    } catch {
      setTrocaStatus('erro');
    }
  }

  return (
    // Linha 1 (foto, cor/GTIN, preço+mín.líquido, estoque) tem largura previsível, então
    // a coluna cor/GTIN (flex-1 + piso de 150px) nunca colapsa. O semáforo tem largura
    // variável (pior com o selo "frete por sua conta") — antes espremia cor/GTIN a ~0;
    // agora fica sozinho na 3ª linha, de largura livre.
    <div className="rounded-md bg-background p-2 text-sm">
      {/* flex-wrap: no mobile, preço + estoque quebram para a 2ª linha (a soma das colunas
          shrink-0 + cor/GTIN min-150 não cabe em ~374px e antes estourava para ~555px, deixando
          arrastar a página no iOS). No desktop cabe tudo numa linha só (não quebra). */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {imgUrl ? (
          <button
            type="button"
            onClick={() => setFotoAberta(true)}
            aria-label="Ampliar foto da variação"
          >
            <img
              src={imgUrl}
              alt={variacao.cor || variacao.codigo}
              className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
              loading="lazy"
            />
          </button>
        ) : (
          <div
            className="mt-0.5 h-8 w-8 shrink-0 rounded border"
            style={{ backgroundColor: variacao.corHex }}
            aria-label={variacao.cor ? `Cor ${variacao.cor}` : 'Sem imagem'}
          />
        )}
        <BotaoTrocarFoto
          onArquivo={lidarTrocaFoto}
          desabilitado={trocaStatus === 'salvando'}
          describedBy={criticas.includes('sem foto') ? criticaId : undefined}
        />
        {/* cor + GTIN num grid 1fr/auto: as duas linhas compartilham as colunas, então
            os dois inputs ficam exatamente com a mesma largura (o badge da cor ocupa a
            coluna `auto`, presente também na linha do GTIN). */}
        <div className="grid min-w-[150px] flex-1 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
          <Input
            value={variacao.cor}
            onChange={(e) => onMudarCor(variacao.codigo, e.target.value)}
            onBlur={() => onSalvarCor?.(variacao.codigo)}
            aria-describedby={criticas.includes('sem cor') ? criticaId : undefined}
            className="h-7"
          />
          <div className="flex items-center gap-1 whitespace-nowrap">
            {/* Alerta "sem cor" (⚠️) só para cor que vai ao ML agora: estoque 0 dorme
                até repor e não exige cor. Com cor, o badge de origem é informativo. */}
            {(variacao.cor || variacao.estoque > 0) && (
              <BadgeCorOrigem origem={variacao.cor ? variacao.corOrigem : null} />
            )}
            <StatusInline status={statusCor} />
          </div>
          {/* EAN/GTIN é só exibição (vem da planilha; não editável na Revisão) */}
          <span className="truncate pl-0.5 text-xs text-muted-foreground">
            EAN: <span className="font-medium tabular-nums text-foreground">{variacao.gtin ?? 'não informado'}</span>
          </span>
          <span />
        </div>
        {/* preço + "mín. líquido" logo abaixo */}
        <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
          <div className="flex items-center gap-1">
            <Input
              type="text"
              inputMode="decimal"
              value={valorStr}
              onChange={(e) => {
                const val = e.target.value;
                if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                  setValorStr(val);
                  const parsed = parseFloat(val.replace(',', '.'));
                  if (!isNaN(parsed) && parsed > 0) {
                    onMudarPreco(variacao.codigo, parsed);
                  }
                }
              }}
              onBlur={() => {
                const parsed = parseFloat(valorStr.replace(',', '.'));
                if (!isNaN(parsed) && parsed > 0) {
                  onMudarPreco(variacao.codigo, parsed);
                  setValorStr(parsed.toString().replace('.', ','));
                } else {
                  setValorStr(precoExterno.toString().replace('.', ','));
                }
                onSalvarPreco?.(variacao.codigo);
              }}
              aria-describedby={criticas.includes('sem preço') ? criticaId : undefined}
              className="h-7 w-24"
            />
            <div className="min-w-0 shrink-0 whitespace-nowrap">
              <StatusInline status={statusPreco ?? trocaStatus} />
            </div>
          </div>
          <span className="pl-0.5 text-[11px] text-muted-foreground">
            mín. líquido: <span className="font-semibold text-foreground">{fmtBRL(variacao.preco)}</span>
          </span>
        </div>
        <div className="flex min-w-16 shrink-0 flex-col items-end leading-tight pt-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Estoque
          </span>
          {variacao.estoqueAnterior != null && variacao.estoqueAnterior !== variacao.estoque ? (
            // Reposição: mostra antes → depois para deixar claro que é só atualização de estoque.
            <span className="text-sm font-semibold tabular-nums">
              <span className="font-normal text-muted-foreground">
                {new Intl.NumberFormat('pt-BR').format(variacao.estoqueAnterior)} →{' '}
              </span>
              {new Intl.NumberFormat('pt-BR').format(variacao.estoque)}
            </span>
          ) : (
            <span className="text-sm font-semibold tabular-nums">
              {new Intl.NumberFormat('pt-BR').format(variacao.estoque)}
            </span>
          )}
        </div>
      </div>
      {/* 3ª linha: apenas o semáforo (Vale a pena / frete), largura livre */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11">
        <SemaforoPreco
          preco={variacao.precoPublicacao ?? variacao.preco}
          piso={variacao.preco}
          custo={variacao.custo}
          categoriaMlId={categoriaMlId}
          dimensoes={{
            alturaCm: variacao.alturaCm,
            larguraCm: variacao.larguraCm,
            comprimentoCm: variacao.comprimentoCm,
            pesoGramas: variacao.pesoGramas,
          }}
          aliquotaPct={aliquotaPct}
        />
      </div>
      <Dialog open={fotoAberta} onOpenChange={setFotoAberta}>
        <DialogContent>
          <DialogTitle className="sr-only">
            Foto ampliada — {variacao.cor || variacao.codigo}
          </DialogTitle>
          {imgUrl && (
            <img
              src={imgUrl}
              alt={variacao.cor || variacao.codigo}
              className="max-h-[80vh] w-auto object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

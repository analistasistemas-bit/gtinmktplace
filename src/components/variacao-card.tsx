import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { StatusPill } from '@/components/ui/status-pill';
import { BotaoTrocarFoto } from '@/components/botao-trocar-foto';
import { BadgeCorOrigem } from '@/components/badge-cor-origem';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useImageUrl, invalidarImagem } from '@/hooks/useImageUrl';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK } from '@/lib/queries';
import { fmtBRL } from '@/lib/formato';
import { gtinInvalido } from '@/lib/gtin';
import type { Variacao } from '@/lib/tipos-dominio';
import { SemaforoPreco } from '@/components/semaforo-preco';

interface VariacaoCardProps {
  variacao: Variacao;
  loteId: string;
  statusPreco?: SaveStatus;
  statusCor?: SaveStatus;
  statusGtin?: SaveStatus;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
  onSalvarPreco?: (codigo: string) => void;
  onSalvarCor?: (codigo: string) => void;
  /** Salva no blur; null = campo vazio (publica como "sem código universal"). */
  onSalvarGtin?: (codigo: string, gtin: string | null) => void;
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
  statusGtin,
  onMudarPreco,
  onMudarCor,
  onSalvarPreco,
  onSalvarCor,
  onSalvarGtin,
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

  const [gtinStr, setGtinStr] = useState(variacao.gtin ?? '');
  useEffect(() => {
    setGtinStr(variacao.gtin ?? '');
  }, [variacao.gtin]);
  const gtinRuim = gtinInvalido(gtinStr);

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
            className="mt-0.5 shrink-0"
          >
            <img
              src={imgUrl}
              alt={variacao.cor || variacao.codigo}
              className="h-8 w-8 rounded object-cover"
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
          {/* EAN/GTIN vem da planilha, mas é editável aqui: importado costuma trazer código do
              fornecedor na coluna GTIN, e o ML recusa a publicação inteira ("Product Identifier
              [GTIN] contains values with invalid format", lote #46). Apagar o campo publica como
              "sem código universal" — não precisa mexer na planilha nem re-ingerir. */}
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 pl-0.5 text-xs text-muted-foreground">EAN</span>
            <Input
              value={gtinStr}
              onChange={(e) => setGtinStr(e.target.value)}
              onBlur={() => onSalvarGtin?.(variacao.codigo, gtinStr.trim() || null)}
              placeholder="sem código"
              aria-label={`GTIN da variação ${variacao.cor || variacao.codigo}`}
              aria-invalid={gtinRuim}
              className={`h-6 flex-1 text-xs tabular-nums ${gtinRuim ? 'border-destructive' : ''}`}
            />
          </div>
          <div className="flex items-center gap-1 whitespace-nowrap">
            <StatusInline status={statusGtin} />
          </div>
          {gtinRuim && (
            <span className="col-span-2 pl-0.5 text-[11px] text-destructive">
              EAN inválido (dígito verificador não confere) — o ML recusa. Apague o campo para
              publicar como &quot;sem código universal&quot;.
            </span>
          )}
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
          {/* Rotulagem só (dono do produto) — "preço não gravado" não é bug de dado: o input
              mostra `precoPublicacao ?? preco` (motor de precificação, ADR-0020/0055/0065), e
              o operador não tinha como saber que o número ali é uma SUGESTÃO da IA, não o que
              ele digitou. Não mexe em `precoExterno`/`onMudarPreco`/`SemaforoPreco`, só texto.
              StatusPill tone="info" + Sparkles: mesmo padrão do chip "Sugerida por IA" do card
              de Categoria (card-categoria.tsx:150-153), a poucos cm daqui na mesma tela — dois
              selos de "isto veio da IA" com estilos diferentes o operador não lia como a mesma
              classe de informação. Texto curto ("sugerido pela IA", não "preço sugerido pela
              IA"): a coluna é `shrink-0` de largura apertada (input de 96px) numa linha que já
              estourou uma vez em mobile ~374px (ver comentário da linha 78 acima). */}
          {variacao.precoPublicacao != null && variacao.precoPublicacao !== variacao.preco && (
            <StatusPill
              tone="info"
              // Os dois números NÃO são a mesma grandeza e o texto precisa dizer isso: `preco` é
              // o mínimo LÍQUIDO que o vendedor quer receber (`sugerir.ts:49` — líquido após
              // comissão, frete e imposto ≥ piso) e `precoPublicacao` é o preço de venda bruto.
              // Apresentá-los como "informei X, a IA subiu para Y" faria o operador ler Y como o
              // que ele recebe.
              title={`Preço de venda sugerido pela IA com base na concorrência: ${fmtBRL(variacao.precoPublicacao)}. Você pediu no mínimo ${fmtBRL(variacao.preco)} líquidos por venda (já descontados comissão, frete e imposto) — o semáforo abaixo avisa se este preço entrega isso. Edite o campo para usar outro valor.`}
            >
              <Sparkles className="h-3 w-3" /> sugerido pela IA
            </StatusPill>
          )}
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
        {/* max-w-sm padrão do Dialog (384px) é pequeno demais pro objetivo desta tela: o
            operador precisa ver a foto GRANDE pra desempatar cor ambígua do Vision. */}
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle className="sr-only">
            Foto ampliada — {variacao.cor || variacao.codigo}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Foto da variação em tamanho grande, para conferir a cor.
          </DialogDescription>
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

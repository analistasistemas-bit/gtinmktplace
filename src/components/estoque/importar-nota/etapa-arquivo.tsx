// ADR-0181 — etapa 1: arquivo XML, dados da nota e avisos.
import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fmtBRL } from '@/lib/formato';
import { aceitarDivergencia, type EstadoImportacao } from './estado';

export interface Recusa { mensagem: string; jaImportada: boolean; chave: string }

export function EtapaArquivo({ e, setE, recusa, erroLeitura, lendo, onArquivo, onVerNota }: {
  e: EstadoImportacao | null;
  setE: (e: EstadoImportacao) => void;
  recusa: Recusa | null;
  erroLeitura: string | null;
  lendo: boolean;
  onArquivo: (file: File) => void;
  onVerNota?: (chave: string) => void;
}) {
  const [rejeicao, setRejeicao] = useState<string | null>(null);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] },
    multiple: false,
    maxSize: 1024 * 1024,
    disabled: lendo,
    onDrop: (files) => { setRejeicao(null); if (files[0]) onArquivo(files[0]); },
    onDropRejected: (rej) => {
      const codes = rej[0]?.errors.map((x) => x.code) ?? [];
      setRejeicao(codes.includes('file-too-large') ? 'O arquivo passa de 1 MB.'
        : codes.includes('file-invalid-type') ? 'Envie um arquivo .xml.'
        : codes.includes('too-many-files') ? 'Envie um arquivo por vez.' : 'Arquivo recusado.');
    },
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm ${isDragActive ? 'bg-muted' : 'bg-muted/30'}`}
      >
        <input {...getInputProps({ 'data-testid': 'nfe-input' } as object)} />
        {lendo ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
        <span>{lendo ? 'Lendo a nota…' : 'Arraste o XML da nota de compra ou clique para escolher (até 1 MB)'}</span>
      </div>

      {rejeicao && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{rejeicao}</p>}

      {erroLeitura && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{erroLeitura}</p>}

      {recusa && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{recusa.mensagem}</span>
          {recusa.jaImportada && (
            <Button size="sm" variant="outline" disabled={!onVerNota} onClick={() => onVerNota?.(recusa.chave)}>Ver nota</Button>
          )}
        </div>
      )}

      {e && !recusa && (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm md:grid-cols-5">
            <div><dt className="text-xs text-muted-foreground">Fornecedor</dt><dd className="font-medium">{e.nota.emitenteNome}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Nota / série</dt><dd className="font-medium">{e.nota.numero} / {e.nota.serie}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Emissão</dt><dd className="font-medium">{new Date(e.nota.emitidaEm).toLocaleDateString('pt-BR')}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Total</dt><dd className="font-medium">{fmtBRL(e.nota.totais.vNF)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Itens</dt><dd className="font-medium">{e.nota.itens.length}</dd></div>
          </dl>

          {!e.nota.assinada && (
            <p role="status" className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              Cópia sem assinatura digital — confira com o XML original quando possível.
            </p>
          )}

          {e.avisoTotal && (
            <div className="space-y-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              <p>{e.avisoTotal}</p>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={e.aceitarDivergencia}
                  onCheckedChange={(v) => setE(aceitarDivergencia(e, v === true))}
                />
                Conferi: o total da nota difere em {fmtBRL(Math.abs(e.divergenciaTotal))}
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

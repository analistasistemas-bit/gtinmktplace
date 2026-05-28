import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FamiliaRow } from '@/components/familia-row';
import { FamiliaExpanded } from '@/components/familia-expanded';
import { DropZoneImagensExistente } from '@/components/drop-zone-imagens-existente';
import { useFamilias } from '@/hooks/useFamilias';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { QK } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos';

export function filtrarFamilias(familias: Familia[], filtro: FiltroOp, busca: string): Familia[] {
  const buscaLower = busca.trim().toLowerCase();
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (!buscaLower) return true;
    return (
      f.titulo.toLowerCase().includes(buscaLower) ||
      f.codigoPai.includes(buscaLower) ||
      f.variacoes.some((v) => v.codigo.toLowerCase().includes(buscaLower))
    );
  });
}

export default function Revisao() {
  const { loteId } = useParams();
  const { data: familias = [], isLoading, error } = useFamilias(loteId);
  const [filtro, setFiltro] = useState<FiltroOp>('todos');
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const qc = useQueryClient();

  const visiveis = useMemo(() => filtrarFamilias(familias, filtro, busca), [familias, filtro, busca]);

  async function lidarArquivosDrop(arquivos: File[]) {
    if (!loteId) return;
    const TAMANHO_CHUNK = 5;
    const acumulado = {
      ok: 0,
      ja_tinha: 0,
      sem_match: 0,
      capas_ok: 0,
      capas_sem_match: 0,
      erros: [] as Array<{ arquivo: string; motivo: string }>,
    };
    setUploadStatus(null);
    setProgresso({ feito: 0, total: arquivos.length });
    try {
      for (let i = 0; i < arquivos.length; i += TAMANHO_CHUNK) {
        const chunk = arquivos.slice(i, i + TAMANHO_CHUNK);
        const r = await uploadImagensLote(loteId, chunk);
        acumulado.ok += r.ok;
        acumulado.ja_tinha += r.ja_tinha;
        acumulado.sem_match += r.sem_match;
        acumulado.capas_ok += r.capas_ok;
        acumulado.capas_sem_match += r.capas_sem_match;
        acumulado.erros.push(...r.erros);
        setProgresso({
          feito: Math.min(i + TAMANHO_CHUNK, arquivos.length),
          total: arquivos.length,
        });
      }
      const partes = [
        `${acumulado.ok} cor(es) nova(s)`,
        `${acumulado.ja_tinha} cor(es) substituída(s)`,
        `${acumulado.sem_match} cor(es) sem match`,
        `${acumulado.capas_ok} capa(s)`,
        `${acumulado.capas_sem_match} capa(s) sem match`,
      ];
      if (acumulado.erros.length) partes.push(`${acumulado.erros.length} erro(s)`);
      setUploadStatus(`✓ ${partes.join(' · ')}`);
      qc.invalidateQueries({ queryKey: QK.familias(loteId) });
      if (acumulado.erros.length) console.error('Erros no upload:', acumulado.erros);
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (e) {
      setUploadStatus(`✗ ${(e as Error).message}`);
      setTimeout(() => setUploadStatus(null), 6000);
    } finally {
      setProgresso(null);
    }
  }

  function toggleSelecao(id: string, valor: boolean) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (valor) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const counts = {
    todos: familias.length,
    CREATE: familias.filter((f) => f.operacao === 'CREATE').length,
    UPDATE: familias.filter((f) => f.operacao === 'UPDATE').length,
    avisos: familias.filter((f) => f.precoAbaixo20pc).length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-background p-3 text-sm">
        <Input
          placeholder="Buscar por código ou nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
        />
        {(['todos', 'CREATE', 'UPDATE', 'avisos'] as FiltroOp[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={
              filtro === f
                ? 'rounded-md bg-accent px-3 py-1 font-medium'
                : 'rounded-md px-3 py-1 text-muted-foreground hover:bg-accent/50'
            }
          >
            {f === 'todos'
              ? `Todos (${counts.todos})`
              : f === 'avisos'
              ? `⚠ Avisos (${counts.avisos})`
              : `${f} (${counts[f]})`}
          </button>
        ))}
      </div>
      {filtro === 'avisos' && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          Famílias com preço sugerido <strong>abaixo de 20%</strong> do preço da sua planilha.
          Reveja antes de aprovar para não vender no prejuízo.
        </div>
      )}
      {loteId && (
        <div className="border-b bg-background px-3 py-2">
          <DropZoneImagensExistente onArquivos={lidarArquivosDrop} />
          {progresso && (
            <div className="mt-2 space-y-1">
              <Progress value={(progresso.feito / Math.max(progresso.total, 1)) * 100} />
              <div className="text-xs text-muted-foreground">
                Processando {progresso.feito} de {progresso.total} imagem(ns)…
              </div>
            </div>
          )}
          {uploadStatus && !progresso && (
            <div className="mt-2 text-xs text-muted-foreground">{uploadStatus}</div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando famílias...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-destructive">
            Erro ao carregar famílias: {(error as Error).message}
          </div>
        ) : (
          <>
            {visiveis.map((familia) => (
              <div key={familia.id}>
                <FamiliaRow
                  familia={familia}
                  selecionada={selecionadas.has(familia.id)}
                  expandida={expandidas.has(familia.id)}
                  onSelecionar={toggleSelecao}
                  onExpandir={toggleExpansao}
                />
                {expandidas.has(familia.id) && <FamiliaExpanded familia={familia} />}
              </div>
            ))}
            {visiveis.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma família encontrada com esses filtros.
              </div>
            )}
          </>
        )}
      </div>
      {selecionadas.size > 0 && (
        <div className="flex items-center justify-between border-t bg-background px-4 py-3">
          <div className="text-sm text-muted-foreground">
            {selecionadas.size} selecionada(s) de {visiveis.length}
          </div>
          <div className="flex gap-2">
            {/* Mutations reais entram no M3; por ora só limpam seleção. */}
            <Button variant="outline" onClick={() => setSelecionadas(new Set())}>
              Rejeitar
            </Button>
            <Button onClick={() => setSelecionadas(new Set())}>
              Aprovar selecionada{selecionadas.size > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

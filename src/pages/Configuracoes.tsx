import { useState, useEffect } from 'react';
import { useSearchParams, Navigate, Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useDescontoPct, useSalvarDescontoPct,
  useDescontoConcorrenciaPct, useSalvarDescontoConcorrenciaPct,
  useAliquotas, useSalvarAliquotas,
  useReancoraLiderAtiva, useSalvarReancoraLiderAtiva,
  useModeloTexto, useSalvarModeloTexto, useModeloImagem, useSalvarModeloImagem,
} from '@/hooks/useConfiguracoes';
import { MODELOS_TEXTO, MODELOS_IMAGEM } from '@/lib/ai-modelos';
import { useProfile } from '@/hooks/useProfile';
import { ConfigTelegram } from '@/components/config-telegram';

export default function Configuracoes() {
  const [searchParams] = useSearchParams();

  const { data: descontoPct } = useDescontoPct();
  const salvar = useSalvarDescontoPct();
  const [pctInput, setPctInput] = useState('15');

  useEffect(() => {
    if (descontoPct != null) setPctInput(String(descontoPct));
  }, [descontoPct]);

  const { data: descontoConcorrenciaPct } = useDescontoConcorrenciaPct();
  const salvarDescontoConcorrencia = useSalvarDescontoConcorrenciaPct();
  const [descontoConcInput, setDescontoConcInput] = useState('5');

  useEffect(() => {
    if (descontoConcorrenciaPct != null) setDescontoConcInput(String(descontoConcorrenciaPct));
  }, [descontoConcorrenciaPct]);

  const { data: reancoraLiderAtiva } = useReancoraLiderAtiva();
  const salvarReancoraLiderAtiva = useSalvarReancoraLiderAtiva();

  const { isAdmin } = useProfile();
  const { data: modeloTexto } = useModeloTexto();
  const salvarModeloTexto = useSalvarModeloTexto();
  const { data: modeloImagem } = useModeloImagem();
  const salvarModeloImagem = useSalvarModeloImagem();

  const { data: aliquotas } = useAliquotas();
  const salvarAliquotas = useSalvarAliquotas();
  const [nacionalInput, setNacionalInput] = useState('8');
  const [importadoInput, setImportadoInput] = useState('16');

  useEffect(() => {
    if (aliquotas != null) {
      setNacionalInput(String(aliquotas.nacional));
      setImportadoInput(String(aliquotas.importado));
    }
  }, [aliquotas]);

  // OAuth do ML retorna para /configuracoes (URL fixa na edge) — o card agora mora em /canais.
  if (searchParams.get('ml_conectado') || searchParams.get('ml_erro')) {
    return <Navigate to={{ pathname: '/canais', search: searchParams.toString() }} replace />;
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Configurações" />

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Canais conectados</h2>
              <p className="text-xs text-muted-foreground">Mercado Livre e próximos marketplaces agora ficam no menu Canais.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/canais">Gerenciar canais</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Modelo de IA</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Modelo usado para gerar título, descrição, categoria e atributos dos anúncios (via OpenRouter).
          </p>

          <div className="mb-3 flex items-center gap-2">
            <span className="w-16 text-sm">Texto</span>
            <Select
              value={modeloTexto ?? MODELOS_TEXTO[0].slug}
              onValueChange={(v) => salvarModeloTexto.mutate(v)}
              disabled={!isAdmin}
            >
              <SelectTrigger aria-label="Modelo de texto" className="h-8 w-[300px] text-sm" title={!isAdmin ? 'Somente administradores podem trocar o modelo' : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELOS_TEXTO.map((m) => (
                  <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {salvarModeloTexto.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarModeloTexto.isSuccess && !salvarModeloTexto.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="w-16 text-sm">Imagem</span>
            <Select
              value={modeloImagem ?? undefined}
              onValueChange={(v) => salvarModeloImagem.mutate(v)}
              disabled={!isAdmin}
            >
              <SelectTrigger aria-label="Modelo de imagem" className="h-8 w-[300px] text-sm" title={!isAdmin ? 'Somente administradores podem trocar o modelo' : undefined}>
                <SelectValue placeholder="Selecione um modelo" />
              </SelectTrigger>
              <SelectContent>
                {MODELOS_IMAGEM.map((m) => (
                  <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {salvarModeloImagem.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarModeloImagem.isSuccess && !salvarModeloImagem.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Modelo de imagem ainda não é usado por nenhuma feature — fica reservado para quando a geração de imagem for implementada.
          </p>
        </Card>

        <ConfigTelegram />

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Desconto sobre concorrência</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Quando há concorrente, o preço sugerido fica esse percentual abaixo do menor preço encontrado (ADR-0059). Padrão 5%.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={99}
              step={1}
              className="h-8 w-20 text-sm"
              value={descontoConcInput}
              onChange={(e) => setDescontoConcInput(e.target.value)}
              onBlur={() => {
                const n = Number(descontoConcInput);
                if (n >= 0 && n < 100) salvarDescontoConcorrencia.mutate(n);
              }}
            />
            <span className="text-sm">%</span>
            {salvarDescontoConcorrencia.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarDescontoConcorrencia.isSuccess && !salvarDescontoConcorrencia.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ancorar preço no piso dos MercadoLíderes quando der prejuízo</h2>
            <Switch
              checked={reancoraLiderAtiva ?? false}
              onCheckedChange={(v) => salvarReancoraLiderAtiva.mutate(v)}
              aria-label="Ancorar preço no piso dos MercadoLíderes quando der prejuízo"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Quando um produto dá prejuízo no import, usa o menor preço entre os concorrentes
            MercadoLíder em vez do menor preço global (ADR-0065).
          </p>
          {salvarReancoraLiderAtiva.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
          {salvarReancoraLiderAtiva.isSuccess && !salvarReancoraLiderAtiva.isPending && (
            <span className="text-xs text-success">✓ Salvo</span>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Estratégia de preço</h2>
          <RadioGroup defaultValue="condicional" className="flex flex-col gap-2">
            <label htmlFor="r1" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="proprio" id="r1" />
              <div>
                <div className="font-medium">Próprio sempre</div>
                <div className="text-xs text-muted-foreground">Manter o preço da planilha em todos os casos</div>
              </div>
            </label>
            <label htmlFor="r2" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="competitivo" id="r2" />
              <div>
                <div className="font-medium">Competitivo sempre</div>
                <div className="text-xs text-muted-foreground">Alinhar com mediana do mercado em todos os casos</div>
              </div>
            </label>
            <label htmlFor="r3" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="condicional" id="r3" />
              <div>
                <div className="font-medium">Condicional (recomendado)</div>
                <div className="text-xs text-muted-foreground">
                  PRÓPRIO quando sem concorrência; COMPETITIVO quando há concorrência (ADR-0008)
                </div>
              </div>
            </label>
          </RadioGroup>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Desconto de marketing</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Preço cheio riscado (selo "% OFF"). Sugestão 15%. O liga/desliga é por produto, na Revisão.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={99}
              step={1}
              className="h-8 w-20 text-sm"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              onBlur={() => {
                const n = Number(pctInput);
                if (n >= 0 && n < 100) salvar.mutate(n);
              }}
            />
            <span className="text-sm">%</span>
            {salvar.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvar.isSuccess && !salvar.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Imposto por origem</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Alíquota aplicada conforme a origem do produto (nacional ou importado).
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm">Nacional</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="h-8 w-20 text-sm"
                value={nacionalInput}
                onChange={(e) => setNacionalInput(e.target.value)}
                onBlur={() => {
                  const n = Number(nacionalInput);
                  if (n >= 0 && n <= 100) salvarAliquotas.mutate({ nacional: n, importado: Number(importadoInput) });
                }}
              />
              <span className="text-sm">%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Importado</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="h-8 w-20 text-sm"
                value={importadoInput}
                onChange={(e) => setImportadoInput(e.target.value)}
                onBlur={() => {
                  const n = Number(importadoInput);
                  if (n >= 0 && n <= 100) salvarAliquotas.mutate({ nacional: Number(nacionalInput), importado: n });
                }}
              />
              <span className="text-sm">%</span>
            </div>
            {salvarAliquotas.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarAliquotas.isSuccess && !salvarAliquotas.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

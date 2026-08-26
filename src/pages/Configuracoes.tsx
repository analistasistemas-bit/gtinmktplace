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
  useMostrarLucroDashboard, useSalvarMostrarLucroDashboard,
  useModeloTexto, useSalvarModeloTexto, useModeloImagem, useSalvarModeloImagem,
  useEmpresaFiscal, useSalvarEmpresaFiscal,
} from '@/hooks/useConfiguracoes';
import { MODELOS_TEXTO, MODELOS_IMAGEM } from '@/lib/ai-modelos';
import { validarCnpj } from '@/lib/fiscal';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/useProfile';
import { ConfigTelegram } from '@/components/config-telegram';

// ADR-0135 — campo de texto do card "Empresa": estado local (buffer até o blur) + patch
// individual no blur, mesmo padrão do card de alíquotas.
function CampoEmpresa({ id, rotulo, valor, onSalvar, disabled, placeholder, erro, largura = 'w-full' }: {
  id: string; rotulo: string; valor: string; disabled: boolean;
  onSalvar: (v: string) => void; placeholder?: string; erro?: string | null; largura?: string;
}) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">{rotulo}</label>
      <Input id={id} className={cn('h-8 text-sm', largura)} value={v} placeholder={placeholder}
        disabled={disabled} onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== valor) onSalvar(v); }} />
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

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

  const { data: mostrarLucroDashboard } = useMostrarLucroDashboard();
  const salvarMostrarLucroDashboard = useSalvarMostrarLucroDashboard();

  const { isAdmin } = useProfile();
  const { data: modeloTexto } = useModeloTexto();
  const salvarModeloTexto = useSalvarModeloTexto();
  const { data: modeloImagem } = useModeloImagem();
  const salvarModeloImagem = useSalvarModeloImagem();

  const { data: aliquotas } = useAliquotas();
  const salvarAliquotas = useSalvarAliquotas();
  const [nacionalInput, setNacionalInput] = useState('8');
  const [importadoInput, setImportadoInput] = useState('16');
  const [ufEmpresaInput, setUfEmpresaInput] = useState('');
  const [internaInput, setInternaInput] = useState('');
  const [erroInterna, setErroInterna] = useState<string | null>(null);

  useEffect(() => {
    if (aliquotas != null) {
      setNacionalInput(String(aliquotas.nacional));
      setImportadoInput(String(aliquotas.importado));
      setUfEmpresaInput(aliquotas.ufEmpresa ?? '');
      setInternaInput(aliquotas.internaPct != null ? String(aliquotas.internaPct) : '');
    }
  }, [aliquotas]);

  // Campo vazio/inválido nunca vira 0 (imposto por origem não pode defaultar em silêncio,
  // ADR-0055) — null aqui significa "não salvar isto", não "salvar zero".
  const pctValido = (raw: string): number | null => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };

  // ADR-0112: UF e percentual andam juntos. Meia-configuração não salva e mostra o motivo —
  // gravar só um dos dois aplicaria imposto parcial em silêncio.
  const salvarInterna = (uf: string, pctRaw: string) => {
    const u = uf.trim().toUpperCase();
    const p = pctRaw.trim() === '' ? null : pctValido(pctRaw);
    if (u === '' && p === null) {
      setErroInterna(null);
    } else if (u === '' || p === null) {
      setErroInterna('Preencha a UF e o percentual — ou deixe os dois em branco.');
      return;
    } else if (!/^[A-Z]{2}$/.test(u)) {
      setErroInterna('UF inválida (use a sigla de 2 letras, ex.: PE).');
      return;
    } else {
      setErroInterna(null);
    }
    salvarAliquotas.mutate({
      nacional: pctValido(nacionalInput) ?? aliquotas?.nacional ?? 8,
      importado: pctValido(importadoInput) ?? aliquotas?.importado ?? 16,
      ufEmpresa: u === '' ? null : u,
      internaPct: u === '' ? null : p,
    });
  };

  const { data: empresa } = useEmpresaFiscal();
  const salvarEmpresa = useSalvarEmpresaFiscal();
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [erroIbge, setErroIbge] = useState<string | null>(null);
  const [erroUf, setErroUf] = useState<string | null>(null);
  const [emissaoInput, setEmissaoInput] = useState('');

  useEffect(() => {
    setEmissaoInput(empresa?.emissao_a_partir_de ?? '');
  }, [empresa?.emissao_a_partir_de]);

  // Um patch por campo (spec do card) — texto simples nunca precisa de validação própria.
  const salvarCampoEmpresa = (campo: keyof NonNullable<typeof empresa>) => (v: string) =>
    salvarEmpresa.mutate({ [campo]: v.trim() === '' ? null : v.trim() });

  const salvarCnpj = (v: string) => {
    const digitos = v.replace(/\D/g, '');
    if (digitos === '') { setErroCnpj(null); salvarEmpresa.mutate({ cnpj: null }); return; }
    if (!validarCnpj(digitos)) { setErroCnpj('CNPJ inválido (dígito verificador não confere).'); return; }
    setErroCnpj(null);
    salvarEmpresa.mutate({ cnpj: digitos });
  };

  const salvarIbge = (v: string) => {
    const t = v.trim();
    if (t === '') { setErroIbge(null); salvarEmpresa.mutate({ municipio_ibge: null }); return; }
    if (!/^\d{7}$/.test(t)) { setErroIbge('Código IBGE inválido (7 dígitos).'); return; }
    setErroIbge(null);
    salvarEmpresa.mutate({ municipio_ibge: t });
  };

  const salvarUf = (v: string) => {
    const u = v.trim().toUpperCase();
    if (u === '') { setErroUf(null); salvarEmpresa.mutate({ uf: null }); return; }
    if (!/^[A-Z]{2}$/.test(u)) { setErroUf('UF inválida (2 letras, ex.: PE).'); return; }
    setErroUf(null);
    salvarEmpresa.mutate({ uf: u });
  };

  // OAuth do ML retorna para /configuracoes (URL fixa na edge) — o card agora mora em /canais.
  // `ml_claim` entrou com o ADR-0091. Sem ele nesta lista, o retorno do OAuth renderiza
  // Configurações e nunca chega ao /canais, que é quem confirma a conexão: fluxo morto sem erro.
  if (searchParams.get('ml_conectado') || searchParams.get('ml_erro') || searchParams.get('ml_claim')) {
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
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Mostrar lucro no card do Dashboard</h2>
            <Switch
              checked={mostrarLucroDashboard ?? false}
              onCheckedChange={(v) => salvarMostrarLucroDashboard.mutate(v)}
              aria-label="Mostrar lucro no card do Dashboard"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Quando desligado (padrão), o card "Líquido no faturamento" do Dashboard não mostra o
            valor de lucro do período.
          </p>
          {salvarMostrarLucroDashboard.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
          {salvarMostrarLucroDashboard.isSuccess && !salvarMostrarLucroDashboard.isPending && (
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
          {aliquotas && !aliquotas.confirmada && (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
              <p className="text-xs font-medium text-warning">Alíquotas não confirmadas</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Confirme as alíquotas antes de publicar — enquanto não confirmar, a publicação falha
                (o sistema não aplica 8%/16% em silêncio, ADR-0055).
              </p>
              {isAdmin ? (
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={salvarAliquotas.isPending}
                  onClick={() => salvarAliquotas.mutate({
                    nacional: pctValido(nacionalInput) ?? aliquotas.nacional,
                    importado: pctValido(importadoInput) ?? aliquotas.importado,
                    // Sem repassar, o upsert gravaria null e apagaria a alíquota interna (ADR-0112).
                    ufEmpresa: aliquotas.ufEmpresa,
                    internaPct: aliquotas.internaPct,
                  })}
                >
                  Confirmar alíquotas
                </Button>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Somente um administrador pode confirmar as alíquotas.</p>
              )}
            </div>
          )}
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
                disabled={!isAdmin}
                onChange={(e) => setNacionalInput(e.target.value)}
                onBlur={() => {
                  const n = pctValido(nacionalInput);
                  if (n === null) { setNacionalInput(String(aliquotas?.nacional ?? 8)); return; }
                  const importado = pctValido(importadoInput) ?? aliquotas?.importado ?? 16;
                  salvarAliquotas.mutate({
                    nacional: n, importado,
                    ufEmpresa: aliquotas?.ufEmpresa ?? null, internaPct: aliquotas?.internaPct ?? null,
                  });
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
                disabled={!isAdmin}
                onChange={(e) => setImportadoInput(e.target.value)}
                onBlur={() => {
                  const n = pctValido(importadoInput);
                  if (n === null) { setImportadoInput(String(aliquotas?.importado ?? 16)); return; }
                  const nacional = pctValido(nacionalInput) ?? aliquotas?.nacional ?? 8;
                  salvarAliquotas.mutate({
                    nacional, importado: n,
                    ufEmpresa: aliquotas?.ufEmpresa ?? null, internaPct: aliquotas?.internaPct ?? null,
                  });
                }}
              />
              <span className="text-sm">%</span>
            </div>
            {salvarAliquotas.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarAliquotas.isSuccess && !salvarAliquotas.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>

          <div className="mt-4 border-t pt-3">
            <h3 className="text-sm font-medium">Venda dentro do estado</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Pedidos entregues nesta UF usam esta alíquota, no lugar de nacional/importado.
              Em branco, vale sempre a alíquota por origem.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm">UF da empresa</span>
                <Input
                  className="h-8 w-20 text-sm uppercase"
                  maxLength={2}
                  placeholder="PE"
                  value={ufEmpresaInput}
                  disabled={!isAdmin}
                  onChange={(e) => setUfEmpresaInput(e.target.value.toUpperCase())}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Alíquota</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  className="h-8 w-20 text-sm"
                  value={internaInput}
                  disabled={!isAdmin}
                  onChange={(e) => setInternaInput(e.target.value)}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
                <span className="text-sm">%</span>
              </div>
              {salvarAliquotas.isSuccess && !salvarAliquotas.isPending && !erroInterna && (
                <span className="text-xs text-success">✓ Salvo</span>
              )}
            </div>
            {erroInterna && <p className="mt-2 text-xs text-destructive">{erroInterna}</p>}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Empresa</h2>
            {salvarEmpresa.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarEmpresa.isSuccess && !salvarEmpresa.isPending && !erroCnpj && !erroIbge && !erroUf && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Emissão fiscal exige organização PJ — quem marca é o administrador da plataforma.
          </p>

          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Identidade</h3>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoEmpresa id="cnpj" rotulo="CNPJ" valor={empresa?.cnpj ?? ''} disabled={!isAdmin}
              placeholder="00.000.000/0000-00" erro={erroCnpj} onSalvar={salvarCnpj} />
            <CampoEmpresa id="razao_social" rotulo="Razão social" valor={empresa?.razao_social ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('razao_social')} />
            <CampoEmpresa id="nome_fantasia" rotulo="Nome fantasia" valor={empresa?.nome_fantasia ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('nome_fantasia')} />
            <CampoEmpresa id="inscricao_estadual" rotulo="Inscrição estadual"
              valor={empresa?.inscricao_estadual ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('inscricao_estadual')} />
            <div className="flex flex-col gap-1">
              <label htmlFor="regime_tributario" className="text-xs font-medium">Regime tributário</label>
              <Select value={empresa?.regime_tributario ?? undefined} disabled={!isAdmin}
                onValueChange={(v) => salvarEmpresa.mutate({ regime_tributario: v })}>
                <SelectTrigger id="regime_tributario" aria-label="Regime tributário" className="h-8 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simples">Simples Nacional</SelectItem>
                  <SelectItem value="normal">Regime Normal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Endereço</h3>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoEmpresa id="cep" rotulo="CEP" valor={empresa?.cep ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('cep')} />
            <CampoEmpresa id="logradouro" rotulo="Logradouro" valor={empresa?.logradouro ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('logradouro')} />
            <CampoEmpresa id="numero" rotulo="Número" valor={empresa?.numero ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('numero')} />
            <CampoEmpresa id="complemento" rotulo="Complemento" valor={empresa?.complemento ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('complemento')} />
            <CampoEmpresa id="bairro" rotulo="Bairro" valor={empresa?.bairro ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('bairro')} />
            <CampoEmpresa id="municipio" rotulo="Município" valor={empresa?.municipio ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('municipio')} />
            <CampoEmpresa id="municipio_ibge" rotulo="Código IBGE do município"
              valor={empresa?.municipio_ibge ?? ''} disabled={!isAdmin} placeholder="2611606"
              erro={erroIbge} onSalvar={salvarIbge} />
            <CampoEmpresa id="uf" rotulo="UF" valor={empresa?.uf ?? ''} disabled={!isAdmin}
              placeholder="PE" largura="w-20" erro={erroUf} onSalvar={salvarUf} />
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Operação fiscal</h3>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoEmpresa id="natureza_operacao" rotulo="Natureza da operação"
              valor={empresa?.natureza_operacao ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('natureza_operacao')} />
            <CampoEmpresa id="cfop_dentro_uf" rotulo="CFOP dentro da UF"
              valor={empresa?.cfop_dentro_uf ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('cfop_dentro_uf')} />
            <CampoEmpresa id="cfop_fora_uf_nao_contribuinte" rotulo="CFOP fora da UF (não contribuinte)"
              valor={empresa?.cfop_fora_uf_nao_contribuinte ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('cfop_fora_uf_nao_contribuinte')} />
            <CampoEmpresa id="cfop_fora_uf_contribuinte" rotulo="CFOP fora da UF (contribuinte, opcional)"
              valor={empresa?.cfop_fora_uf_contribuinte ?? ''} disabled={!isAdmin}
              onSalvar={salvarCampoEmpresa('cfop_fora_uf_contribuinte')} />
            <CampoEmpresa id="cst_pis" rotulo="CST de PIS" valor={empresa?.cst_pis ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('cst_pis')} />
            <CampoEmpresa id="cst_cofins" rotulo="CST de COFINS" valor={empresa?.cst_cofins ?? ''}
              disabled={!isAdmin} onSalvar={salvarCampoEmpresa('cst_cofins')} />
            <div className="flex flex-col gap-1">
              <label htmlFor="origin_type" className="text-xs font-medium">Papel da empresa</label>
              <Select value={empresa?.origin_type ?? undefined} disabled={!isAdmin}
                onValueChange={(v) => salvarEmpresa.mutate({ origin_type: v })}>
                <SelectTrigger id="origin_type" aria-label="Papel da empresa" className="h-8 text-sm">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manufacturer">Fabricante</SelectItem>
                  <SelectItem value="reseller">Revendedor</SelectItem>
                  <SelectItem value="imported">Importador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Emissão</h3>
          <div className="mb-4 flex flex-col gap-1">
            <label htmlFor="emissao_a_partir_de" className="text-xs font-medium">Emitir a partir de</label>
            <Input id="emissao_a_partir_de" type="date" className="h-8 w-40 text-sm"
              value={emissaoInput} disabled={!isAdmin}
              onChange={(e) => setEmissaoInput(e.target.value)}
              onBlur={() => {
                if (emissaoInput === (empresa?.emissao_a_partir_de ?? '')) return;
                salvarEmpresa.mutate({ emissao_a_partir_de: emissaoInput === '' ? null : emissaoInput });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Vendas anteriores a esta data nunca entram no fluxo fiscal.
            </p>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground">
              No painel do Mercado Livre (Preferências de venda → Emissor de NF-e): ativar o
              Faturador, enviar o certificado A1 e configurar a série. O PubliAI verifica a
              prontidão pelo próprio ML (semáforo nos Publicados).
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

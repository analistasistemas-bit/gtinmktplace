# Plano — Emissão de NF-e 55 (v1 Simples Nacional)

**ADR:** [0114](../../decisions/0114-emissao-de-nf-e-modelo-55.md) · **Data:** 2026-08-12
**Recorte:** Simples Nacional · logísticas com `invoice_pending` · NF-e 55 de venda
**Fora:** Regime Normal, Full/Flex/Turbo/ME1, NFS-e, devolução, CC-e, NF-e de remessa

---

## Fase 0 — Provar as premissas antes de escrever código de produção

**Nada da Fase 1 em diante vale se estes quatro pontos falharem.** São horas, não dias, e evitam
construir sobre o endpoint errado — que é exatamente o erro que a revisão adversarial pegou.

| # | Provar | Como | Se falhar |
|---|---|---|---|
| 0.1 | `POST /shipments/{id}/invoice_data` destrava `invoice_pending` e libera a etiqueta | conta real do cliente, 1 pedido `drop_off`, **XML autorizado em produção** | replaneja o D-4 inteiro |
| 0.2 | anexo em `/packs/{id}/fiscal_documents` **não** destrava | mesmo pedido, ordem invertida | o D-4 simplifica |
| 0.3 | lista de logísticas com `invoice_pending` | 1 pedido de cada tipo que a org usa | muda o D-15 |
| 0.4 | Focus reaproveita número após rejeição definitiva | sandbox Focus + rejeição forçada (NCM inválido) | entra inutilização no escopo |

Extra barato: `GET /orders/billing-info/{site_id}/{id}` num pedido real, para ver a forma do
retorno e o estado `PROCESSING` de perto.

⚠️ **O 0.1 tem um pré-requisito que não é software.** O ML recusa XML de homologação (D-4), então
provar que o endpoint destrava exige **uma nota real, autorizada em produção, no CNPJ do cliente** —
emitida por fora do PubliAI (contador, portal, emissor avulso), sobre um pedido real dele. Combinar
isso com o cliente **antes** de agendar a Fase 0; é a única dependência externa do plano inteiro e
descobri-la no meio do caminho para o projeto.

**Saída da fase:** um documento curto com print de cada resposta. Sem ele, não começa a Fase 1.

---

## Fase 1 — Fundação: schema, config e trava de habilitação

Ainda não emite nada. Entrega a casa dos dados e as travas.

### 1.1 Migration `nfe_config_e_notas`

```sql
-- configuracoes JÁ É org-scoped (PK org_id, ADR-0086/migration 20260722085311).
alter table public.configuracoes
  add column if not exists nfe_cnpj              text,
  add column if not exists nfe_ie                text,
  add column if not exists nfe_regime            text,      -- v1: só 'simples_nacional'
  add column if not exists nfe_serie             smallint,  -- check 1..889 (ver nota abaixo)
  add column if not exists nfe_cfop_interno      text,      -- ex.: 5102
  add column if not exists nfe_cfop_interestadual text,     -- ex.: 6108 (NÃO 6102)
  add column if not exists nfe_cfop_contribuinte text,      -- opcional, ex.: 6102
  add column if not exists nfe_cst_pis           text,
  add column if not exists nfe_cst_cofins        text,
  add column if not exists nfe_natureza_operacao text,
  add column if not exists nfe_endereco          jsonb,
  add column if not exists nfe_ambiente          text not null default 'homologacao',
  add column if not exists nfe_cert_validade     date,
  add column if not exists nfe_cert_enviado_em   timestamptz;

alter table public.familias
  add column if not exists ncm       text,
  add column if not exists csosn     text,
  add column if not exists orig_nfe  smallint,   -- check 0..8
  add column if not exists cest      text;

create table public.notas_fiscais (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  shipment_id    bigint not null,
  ref            text not null,
  status         text not null,          -- reservada|processando|autorizada|rejeitada|cancelada
  chave          text,
  numero         integer,
  serie          smallint,
  protocolo      text,
  erro           text,                   -- mensagem CRUA da SEFAZ, sem tradução (D-9)
  erro_definitivo boolean,
  xml_path       text,
  importada_no_ml_em timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index notas_fiscais_org_shipment_uniq on public.notas_fiscais (org_id, shipment_id);
```

⚠️ **O `check` de 1..889 vive nas duas colunas** (`configuracoes.nfe_serie` e
`notas_fiscais.serie`). Só na config, dá para cadastrar válido e persistir inválido se alguma
escrita futura não passar pela tela.

RLS `org_id = (select current_org_id())`, igual às demais tabelas de domínio (ADR-0027).
Bucket novo `notas-fiscais` no Storage, RLS por org — hoje só existe `imagens`.

⚠️ **`notas_fiscais` entra em `scripts/verificar-isolamento-tenant.ts`** (mesma exigência que
`estoque_movimentos` teve no ADR-0094).

### 1.2 Trava de habilitação (`exigirModulo` + pré-checagem)

O gate já existe: `exigirModulo(admin, orgId, 'fiscal')` em `_shared/produto/modulo.ts` — e **fecha
por padrão** em erro de leitura. Reusar, não reescrever.

O que é novo é a **pré-checagem antes de ligar** o módulo em `/admin`, que bloqueia ou avisa:

1. **`ambiente = producao`** — em `homologacao` o módulo **não liga** (D-13). Sem esta trava, venda
   real chega, o XML de homologação é recusado pelo ML, `invoice_pending` não sai e **o despacho
   trava** num cliente que não tem outro emissor.
2. regime da org — **Regime Normal bloqueia** (D-14), com o motivo escrito
3. série definida e dentro de 1–889 — sem ela, não liga (D-8)
4. **quantas vendas dos últimos 90 dias ficariam sem nota** por logística fora do escopo (D-15) —
   este é aviso, não bloqueio: o operador vê o número e decide

Os três primeiros são bloqueio real, não texto de alerta.

**Onboarding fiscal ≠ módulo ligado.** A aba de config fiscal aparece quando o super-admin inicia o
onboarding (`nfe_ambiente` preenchido, nascendo em `homologacao`) — é onde o certificado sobe e o
contador preenche. O módulo em `modulos_habilitados` significa **emissão automática ligada**, e só
depois da promoção. Sequência única: onboarding → config → sintéticas → contador aprova → promoção
→ módulo.

### 1.3 UI de config fiscal

Nova aba em `/configuracoes`, visível só com o módulo ligado. Upload do `.pfx` + senha em
**passthrough** (D-6): a edge recebe, repassa à Focus, **não persiste** — grava só CNPJ, validade e
data de envio.

⚠️ O `.pfx` e a senha **não podem aparecer em log**. Vale um teste que falha se aparecerem.

**Testes da fase:** série fora de 1–889 recusada **nas duas colunas** · Regime Normal não liga ·
**org em `homologacao` não liga** · org sem módulo recebe 403 na edge · certificado e senha não
persistidos nem logados em lugar nenhum.

---

## Fase 2 — Campos fiscais por família

`ncm`, `csosn`, `orig_nfe` obrigatórios; `cest` opcional (D-10).

- Cadastro manual e Revisão ganham os campos.
- **Trava LOUD:** família sem os três não emite — falha com o campo faltando **nomeado**, no
  espírito do ADR-0107. Aparece como pendência na Revisão, junto das que já existem.
- Import em massa por planilha **não entra na v1** — o cliente tem poucos produtos e o contador
  preenche uma vez. Entra se o volume pedir.
- Troca de regime na config **desabilita a emissão e lista as famílias afetadas**; nunca converte
  sozinha (D-10).

---

## Fase 3 — A porta e o adaptador Focus

```
supabase/functions/_shared/fiscal/
  porta.ts        # interface TransmissorFiscal + tipos (nada de Focus aqui)
  focus.ts        # adaptador
  payload.ts      # monta NotaFiscalPayload a partir de venda + família + config
  fake.ts         # adaptador de teste
```

O `fake.ts` é o que permite testar as Fases 4 e 5 sem tocar na SEFAZ — mesmo padrão do conector
fake que o ADR-0094 usou para provar o push de estoque.

**`payload.ts` é o coração e o lugar mais fácil de errar.** Ele monta:

- destinatário: buscado sob demanda via `GET /orders/billing-info/{site_id}/{id}` (D-11), **nunca
  persistido**; `PROCESSING` → falha **transitória**, com retry
- itens: união dos itens dos pedidos **do envio** (D-7)
- CFOP: compara UF do emitente com `ml_vendas.uf` → interno / interestadual; se o destinatário tem
  IE e o slot `nfe_cfop_contribuinte` está preenchido, usa ele
- **grupo de pagamento/intermediador** (NT 2020.006 / NT 2025.001): `tpIntegra`, CNPJ do
  intermediador, `tBand`, `cAut`, lidos dos `payments` do pedido — **sem isso 100% das notas do ML
  rejeitam**
- `serie` explícita, **`numero` em branco** (a Focus numera, D-8)

**Testes:** tabela de casos por UF (interno/interestadual/contribuinte) · pagamento cartão e PIX ·
`billing_info` em `PROCESSING` · família sem NCM.

---

## Fase 4 — Worker `emitir-nfe`

Gatilho em `sync-venda`: envio em `ready_to_ship` + `invoice_pending` + logística coberta →
enfileira no QStash. **Falha de emissão nunca falha a venda** (D-4, mesma regra do estoque).

Sequência dentro do worker:

```
1. INSERT em notas_fiscais (org_id, shipment_id) status='reservada'
     conflito? → lê o status
       terminal      → nada a fazer, sai
       NÃO-terminal  → consulta a ref na Focus e RETOMA   ← D-7 camada 2
2. monta payload
3. emitir(ref, payload)
4. autorizada  → grava chave/numero/protocolo, baixa XML → Storage
   rejeitada    → classifica transitória vs definitiva (D-9)
5. POST /shipments/{id}/invoice_data       ← é ESTE que destrava
6. (opcional) anexo em /packs/{id}/fiscal_documents, para o comprador
```

⚠️ **O passo 1 é o que mais errei no design.** "Conflito → para" deixa o pedido travado em
`invoice_pending` para sempre **sem acionar o alerta**, porque não é rejeição definitiva. Tem que
retomar.

⚠️ **Org em `homologacao` não emite venda real** (D-13): grava pendente com o motivo e notifica. O
ML recusa XML de homologação — tentar seria travar o pedido.

`logistic_type` **não é lido em lugar nenhum hoje**; passa a ser lido do shipment.

**Testes:** replay do QStash não duplica · worker morto entre INSERT e Focus → retoma · logística
fora do escopo marca e não emite · org em homologação não emite venda real · falha da Focus não
derruba `sync-venda`.

---

## Fase 5 — Operar (Bloco B)

1. **Rejeição na UI** — badge "nota pendente" + seção de pendências **na tela de vendas que já
   existe**, sem tela nova (D-9). Mensagem **crua** da SEFAZ. Botão "emitir agora".
2. **Notificação** — categoria nova `fiscal`. ⚠️ **Dois arquivos, não um:**
   `_shared/notificacoes/categorias.ts` **e** `src/lib/notificacoes-categorias.ts` — o próprio
   código avisa que o Deno não compartilha módulo com o front.
3. **Cancelamento** — pendura no gancho que já existe em `sync-venda` (`cancelled` + envio
   pré-despacho). Fora da janela: **"cancelamento extemporâneo ou devolução"**, nunca só
   "devolução" (D-12). Parcial segue a regra do D-12.
4. **Vencimento de certificado** — job diário lendo `nfe_cert_validade`, alerta em 30/15/7 dias via
   `notificarCategoria`. Reusa o schedule QStash, sem infraestrutura nova.
5. **Painel em `/admin`** — rejeições definitivas de todas as orgs, **só leitura, zero push** (D-9).

**Emissão sintética de homologação:** ação explícita que monta um payload de venda de teste e emite,
sem passar pelo webhook. É o que torna a Fase 6 possível.

---

## Fase 6 — Homologação e promoção

**O módulo ainda está desligado durante toda esta fase** (D-13). É o que garante que nenhuma venda
real fique parada esperando promoção.

1. Emissões sintéticas até autorizar na SEFAZ de homologação com o certificado real
2. Contador do cliente confere uma nota completa (DANFE + XML)
3. Super-admin promove a org para `producao`
4. **Só então** liga o módulo `fiscal`
5. Primeira venda real: acompanhar até **a etiqueta liberar** — não até o HTTP 200

---

## Ordem, dependências e esforço

```
Fase 0 ──> Fase 1 ──> Fase 2 ──┐
                     └─ Fase 3 ─┴──> Fase 4 ──> Fase 5 ──> Fase 6
```

Fases 2 e 3 são paralelizáveis. Estimativa para quem conhece o repo: **Fase 0** meio dia ·
**1** 2–3 dias · **2** 1–2 dias · **3** 3–4 dias (o `payload.ts` domina) · **4** 2–3 dias ·
**5** 2–3 dias · **6** depende do contador. **~2 a 3 semanas**, sem contar espera externa.

## Riscos

| Risco | Mitigação |
|---|---|
| Fase 0 derruba a premissa do endpoint | por isso ela é a Fase 0 |
| `payload.ts` errado → rejeição em massa | homologação com nota conferida pelo contador antes de promover |
| Focus fora do ar trava despacho | dependência aceita no ADR; a porta permite trocar |
| **04/01/2027: IBS/CBS alcança o Simples** | a v1 tem prazo de validade conhecido — entra no roadmap agora, não em dezembro |

## Gate final

`pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build` verdes ·
`supabase db lint` sem erro de schema · `verificar-isolamento-tenant.ts` cobrindo `notas_fiscais` ·
`docs/` (`modelo-de-dados.md`, `edge-functions.md`, `arquitetura.md`, `glossario.md`,
`project-status.md`, `TASKS.md`) e `obsidian-vault/` no mesmo commit · Graphify re-ingerido ·
os 14 itens do critério de saída do ADR verificados um a um.

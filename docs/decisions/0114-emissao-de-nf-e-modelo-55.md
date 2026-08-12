# ADR-0114 — Emissão de NF-e modelo 55 no PubliAI

**Data:** 2026-08-12
**Status:** aceito (design fechado em sessão de grilling com Diego) — **implementação pendente**
**Revoga parcialmente:** o descarte de NF-e da seção 11 da spec
`docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`, citado no
[ADR-0094](0094-estoque-unico-cadastro-manual.md) como alternativa rejeitada.
**Relacionado:** [0024](0024-camada-de-abstracao-de-canais.md) (porta de canal), [0055](0055-imposto-por-origem-nacional-importado.md) / [0107](0107-origem-obrigatoria-na-planilha.md) (origem e imposto), [0085](0085-notificacao-in-app.md) (notificação), [0086](0086-configuracao-org-scoped.md) (config por org), [0094](0094-estoque-unico-cadastro-manual.md) (módulo gated), [0105](0105-revinculo-de-familia-dissolvida-pelo-ml-em-user-products.md) (webhooks de venda)

## Contexto

Em 2026-07-28 a emissão de NF-e foi descartada com racional documentado: é commodity, é passivo
fiscal, é manutenção perpétua da reforma tributária e não multiplica nada do que o PubliAI
construiu.

O que mudou: existe demanda concreta de **cliente sem ERP**, que hoje não tem por onde emitir a
nota das vendas feitas pelo PubliAI. O primeiro cliente projeta **500 notas/mês**.

O descarte de julho continua correto na sua premissa central — **o PubliAI não deve virar motor
fiscal**. Este ADR mantém a premissa e restringe o escopo ao que o descarte não cobria: **disparar,
transportar e guardar** a nota, sem **decidir** nada fiscal.

O ponto de partida da discussão foi o **UniNFe** (Unimake). Ele foi avaliado e descartado — ver D-3.

## Decisões

### D-1 — Escopo: NF-e modelo 55, só

Mercadoria. NFS-e (serviço) fica fora: o modelo de domínio do PubliAI (família, variação, SKU,
estoque) não comporta serviço e nenhum cliente vende serviço.

### D-2 — O PubliAI transmite, não calcula

Emitir NF-e são duas etapas. **(A) decidir o que vai escrito** — `NCM`, `CFOP`, `CST`/`CSOSN`,
`orig`, base, alíquota, DIFAL. **(B) assinar, transmitir e receber o protocolo.** Nenhum software
de transmissão (nem UniNFe, nem SaaS) faz a etapa A; ela é decisão do contador.

Os parâmetros fiscais são **cadastrados pelo cliente**. O PubliAI não infere, não deduz e **não tem
default silencioso para nenhum deles** — mesma trava LOUD do `ORIGEM` (ADR-0107) e da confirmação
de alíquotas (ADR-0086). Nota rejeitada por dado fiscal errado é dado errado do cliente.

⚠️ **Colisão de nome:** `familias.origem` (`NACIONAL`/`IMPORTADO`, base da alíquota de markup,
ADR-0055/0107) **não é** o campo `orig` da NF-e (0 a 8). São conceitos distintos com nome parecido;
reaproveitar um como o outro emite nota errada.

### D-3 — Transmissão via SaaS (Focus NFe), atrás de uma porta

Alternativas avaliadas, no volume de 500 notas/mês:

| Opção | Infra | Quem monta o XML 4.00 | Certificado | Custo/mês |
|---|---|---|---|---|
| **Focus NFe (API)** | nenhuma | provider | provider | ~R$ 130 (Solo R$ 89,90 + 400 × R$ 0,10) |
| Serviço .NET com `Unimake.DFe` no Render | container Linux | **nós** | **nós** | ~R$ 40 |
| UniNFe | **VM Windows** | nós | nós | ~R$ 200 + VM |

**UniNFe está descartado.** É aplicativo Windows (.NET Framework, serviço do Windows, certificado
no repositório do Windows) e **não roda no Render**, que só executa container Linux. Quem é
multiplataforma é a biblioteca `Unimake.DFe`, não o aplicativo — e ela é a opção do meio da tabela.
O UniNFe seria essa mesma opção numa VM mais cara, sem entregar nada a mais.

**O serviço .NET próprio também não entra na v1.** Economizaria ~R$ 90/mês em troca de manter um
serviço C# num codebase 100% TypeScript/Deno, montar o layout NF-e 4.00 campo a campo e acompanhar
cada Nota Técnica (inclusive os grupos IBS/CBS da reforma tributária). Só empata perto de
**4.000 notas/mês** (Focus Growth, R$ 548, CNPJ ilimitado) — 8× o volume atual.

A escolha fica isolada atrás de uma porta, no mesmo padrão da abstração de canais (ADR-0024):

```ts
export interface TransmissorFiscal {
  emitir(ref: string, nota: NotaFiscalPayload): Promise<{ chave: string; protocolo: string }>;
  consultar(ref: string): Promise<StatusNota>;
  cancelar(ref: string, motivo: string): Promise<void>;
  baixarDanfe(ref: string): Promise<Uint8Array>;
}
```

Trocar de provider, ou migrar para `Unimake.DFe` se o volume justificar, é escrever um adaptador.

> **Registro:** a **Nuvem Fiscal**, apontada como a mais forte em multi-empresa na spec de julho,
> **encerrou em 31/07/2026**. Não é alternativa. Preços da Focus conferidos em 2026-08-12.

### D-4 — Gatilho: `ready_to_ship` + `invoice_pending`, nunca no Full

O próprio ML sinaliza a hora: o envio entra em `ready_to_ship` com sub-status **`invoice_pending`**
("a NF-e ainda não foi importada"). **Sem a nota, o despacho fica travado.**

Não em `paid`: cancelamento do comprador dias depois deixaria nota autorizada fora da janela de
cancelamento (24h na regra geral), obrigando nota de devolução.

**Skip duro quando `logistic.type === 'fulfillment'` (Full)** — nesse fluxo o ML já emite pelo
Faturador, e emitir junto gera **nota duplicada**. Em **ME1** o envio do XML ao ML é opcional;
**Flex, Turbo e Drop Off** exigem.

O sinal de push já existe: `ml-webhook` já assina o tópico **`shipments`** e o roteia para
`sync-venda` com `shipping_id` (`ml-webhook/index.ts:16`). Nenhuma assinatura nova de webhook.

Emissão assíncrona (QStash). **Falha de emissão nunca falha a venda** — mesma regra da baixa de
estoque (ADR-0094, critério 6). Botão manual "emitir agora" existe só como retentativa.

Ciclo completo:

```
webhook shipment → ready_to_ship + invoice_pending
  → emitir na Focus (série do PubliAI, ref = publiai-{org}-{ml_order_id})
  → AUTORIZADA → POST do XML no pack do ML
  → invoice_pending some → etiqueta libera → despacha
```

### D-5 — Custo repassado, módulo gated

Módulo nasce desligado por org (`modulos_habilitados`, mesmo mecanismo do módulo de estoque,
ADR-0094): super-admin liga em `/admin`, org sem o módulo não vê a tela **e** a edge recusa a
chamada. O custo é repassado ao cliente como módulo pago, não absorvido pela DALUDI.

### D-6 — Certificado A1: passthrough, sem custódia

O `.pfx` e a senha atravessam a edge a caminho do provider e **não são persistidos** — nem no
Storage, nem em coluna, nem em log. Guarda-se apenas metadados: CNPJ, **validade** e data de envio.

Alternativa rejeitada: guardar o `.pfx`. Vazamento permitiria emitir nota no CNPJ do cliente.

O A1 vale 1 ano; vencido, para de emitir e ninguém percebe até uma venda travar. A validade
alimenta alerta em **30/15/7 dias** pelo `notificarCategoria` existente (ADR-0085).

### D-7 — A unidade da nota é o **pack**, não o pedido

Um carrinho com N itens do mesmo vendedor gera **N pedidos → 1 pack → 1 envio**, e o ML aceita
uma nota cobrindo mais de um número de venda. Chavear a nota no pedido emitiria **N notas para um
único envio**, e o upload do XML no ML é por **pack** — não haveria onde pendurar as outras.

A unidade é o pack, com fallback para o pedido quando não há pack. O padrão
`pedido.pack_id ?? pedido.id` **já existe no código** (`_shared/faturamento/io.ts:302`, rateio de
frete) e `ml_vendas.pack_id` já é persistido (`sync-venda/index.ts:111`) — mesma âncora, domínio
novo. Os itens da nota são a **união dos itens de todos os pedidos do pack**.

Três camadas contra nota duplicada:

1. **Reserva no banco antes da chamada** — `unique (org_id, pack_ref)` em `notas_fiscais`, linha
   inserida *antes* de falar com o provider. Mesmo padrão da saga de User Products (ADR-0088).
   Retentativa do QStash bate no índice e para. Esta camada sozinha já garante a unicidade.
2. **`ref` idempotente no provider** — `publiai-{org}-{pack_id ?? ml_order_id}`, estável e
   reconstruível sem consultar nada. Reforço, não a garantia.
3. **Série dedicada** — ver D-8.

### D-8 — Série dedicada ao PubliAI, obrigatória

A NF-e é numerada sequencialmente **por (CNPJ, modelo, série)**, com contadores independentes por
série. A série usada pelo PubliAI é **exclusiva dele**: nada mais no CNPJ emite nela.

O cliente segue emitindo normalmente em outras séries fora do PubliAI — é para isso que série
existe. O que quebra é o inverso: emitir avulso **na** série do PubliAI defasa o contador do
provider e a próxima nota rejeita por duplicidade.

Qual número usar é decisão do contador (há faixas reservadas na legislação); o PubliAI só recebe e
usa. **Sem série definida, o módulo não liga** — trava LOUD.

**Quem conta:** a Focus mantém o contador quando o campo `numero` vai em branco no payload. O
PubliAI envia a **série** explicitamente (a dedicada) e **omite o número** — assim a série é nossa
por decisão e a sequência é do provider por operação. Consequência: o PubliAI não precisa de
contador próprio, nem de reserva de número, nem de inutilização de número não usado após rejeição
definitiva.

Efeito colateral bem-vindo: como cancelamento e buraco de sequência são apurados por série, a
série do PubliAI vira trilha limpa e auditável de tudo que foi vendido pelo marketplace.

### D-9 — Rejeição: transitória tenta de novo, definitiva para e avisa o cliente

| Tipo | Exemplo | Tratamento |
|---|---|---|
| Transitória | SEFAZ fora do ar, timeout | retry com backoff, silencioso |
| Definitiva | `NCM inválido`, `CPF do destinatário inválido`, IE irregular | para; alguém corrige o cadastro |

Mesma distinção que `classificarErroML` já faz para o ML, domínio novo.

Para a definitiva: **nada de tela nova** (badge "nota pendente" + seção de pendências na tela de
vendas que já existe); **mensagem crua da SEFAZ, sem tradução** — "Rejeição 778: NCM inválido" é o
que o contador precisa ler; notificação via `notificarCategoria` (ADR-0085); e **o PubliAI não
tenta consertar** — corrigiu o cadastro, clica em "emitir agora".

**O alerta vai para o cliente, não para a DALUDI.** Rejeição de NCM pingando no Telegram do Diego
transforma a DALUDI em suporte contábil de graça — exatamente o risco que motivou o descarte de
julho. Para calibrar sem virar plantão, existe um **painel só-leitura em `/admin`** com as
rejeições definitivas de todas as orgs, **sem push**.

### D-10 — Campos fiscais: família e organização, nunca variação

**Por organização** (config fiscal, no onboarding): CNPJ · Inscrição Estadual · regime tributário ·
endereço do emitente · **série** · **par de CFOP** (um para dentro da UF, outro para fora).

O par de CFOP preserva o D-2: **escolher** entre os dois é mecânico (compara UF do emitente com
`ml_vendas.uf`); **quais** são os dois é decisão fiscal que o contador escreve (`5102`/`6102`, ou
`5405`/`6404` com ST).

**Por família** (produto): `ncm` · `cst_csosn` · `orig_nfe` (0 a 8) · `cest` (opcional, só com ST).

Família e não variação: variações se distinguem por **cor**, e cor não muda NCM nem CST. Em
variação seria o mesmo dado N vezes, com N chances de divergir. Override por variação só se um dia
aparecer família de NCM misto — não antes.

**Família sem `ncm`, `cst_csosn` ou `orig_nfe` não emite**: falha LOUD com o campo faltando
nomeado, exibida como pendência na Revisão junto das que já existem.

### D-11 — Dados do comprador: buscados sob demanda, nunca persistidos em coluna

`ml_vendas` hoje tem `comprador_nome`, `cidade` e `uf`. A NF-e exige CPF/CNPJ e endereço completo
(logradouro, número, bairro, CEP), que o ML entrega em
[`billing_info`](https://developers.mercadolivre.com.br/pt_br/faturamento).

Esses dados são buscados **na hora de emitir** e **não viram coluna**. Persistir criaria uma base
de CPF e endereço de consumidor final — LGPD, RLS, retenção e risco de vazamento — sem necessidade.

O que se guarda é o **XML autorizado**, que já contém tudo e é o documento legal (obrigação de
guarda de 5 anos do emitente). Tabela `notas_fiscais`: `venda_id`, `ref`, `chave`, `numero`,
`serie`, `protocolo`, `status`, `erro`, `xml_path` (Supabase Storage por org, com RLS).
**Nenhuma coluna de CPF, nome ou endereço.**

### D-12 — Cancelamento automático; devolução e CC-e ficam de fora

**Cancelamento (24h, mercadoria não circulou): automático.** `sync-venda` já detecta `cancelled`
com envio pré-despacho (`pending`/`handling`/`ready_to_ship`) e já estorna estoque nesse ponto —
o cancelamento da nota pendura no mesmo gancho, com justificativa fixa. Fora da janela ou
pós-despacho: marca "exige devolução", notifica, **não emite nada**.

**Devolução (NF-e de entrada, CFOP 1202/2202): fora do escopo, declarado.** É emissão nova com
regras próprias; o contador do cliente emite. Coerente com o corte que o ADR-0094 já fez
("devolução não é tocada") e com o D-2. `ml_devolucoes`/`sync-devolucao` detectam e sinalizam.

**Carta de Correção (CC-e): fora.** Ninguém pediu. A porta `TransmissorFiscal` tem onde encaixar
quando aparecer demanda.

### D-13 — Nasce em homologação; produção é promoção manual do super-admin

Campo `ambiente` por org (`homologacao` | `producao`), **nascendo em `homologacao`**. O cliente
sobe o certificado real desde o dia 1, mas as notas saem marcadas "SEM VALOR FISCAL" e não geram
obrigação fiscal. O super-admin promove para produção só depois de ver notas autorizadas de
verdade em homologação. Risco de nota errada valer: zero.

## Escopo da v1

**Bloco A — emitir:** config fiscal por org + certificado passthrough + série · campos fiscais por
família na Revisão e no cadastro · porta `TransmissorFiscal` + adaptador Focus · worker
`emitir-nfe` no webhook `ready_to_ship`/`invoice_pending` com skip de Full · POST do XML no pack
do ML · `notas_fiscais` + XML no Storage + badge de pendência na tela de vendas.

**Bloco B — operar (entra junto):** cancelamento automático pré-despacho · alerta de vencimento de
certificado · painel de rejeições em `/admin`.

## Critério de saída

1. Venda real: `invoice_pending` → nota autorizada → XML no ML → `invoice_pending` some → etiqueta
   libera
2. Replay do webhook pelo QStash **não** emite segunda nota
3. **Carrinho com N itens (1 pack, N pedidos) gera 1 nota com N itens**, não N notas
4. Pedido Full não gera nota nenhuma
5. Família sem `ncm` falha LOUD com o campo faltando nomeado
6. Org sem o módulo: tela some **e** a edge devolve 403
7. Certificado vencendo em 30 dias dispara notificação
8. Cancelamento pré-despacho cancela a nota; pós-despacho apenas marca e notifica
9. Nenhuma coluna com CPF, nome ou endereço de comprador em nenhuma tabela
10. Gate padrão: `pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build`
   verdes; `docs/` e `obsidian-vault/` atualizados no mesmo commit; Graphify re-ingerido

## Consequências

**A favor.** Destrava o cliente sem ERP, que hoje não tem por onde emitir. Zero infra nova (tudo
cabe em Edge Function + QStash já existentes). O risco fiscal fica com quem tem competência para
carregá-lo — contador do cliente decide, provider transmite, DALUDI nem guarda certificado.

**Contra.** Um provider externo entra no caminho crítico do despacho: Focus fora do ar =
`invoice_pending` que não sai = pedido parado. É o mesmo perfil de dependência que o ML já é, e a
porta `TransmissorFiscal` permite trocar, mas não elimina.

O risco central do descarte de julho — "vira suporte contábil" — é mitigado, não eliminado: o D-2
e o D-9 empurram toda decisão e todo erro fiscal para o cliente, mas a primeira ligação ainda vai
chegar no Diego. O painel só-leitura do D-9 existe para medir esse volume antes que ele vire hábito.

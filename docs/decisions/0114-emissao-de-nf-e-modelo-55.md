# ADR-0114 — Emissão de NF-e modelo 55 no PubliAI

**Data:** 2026-08-12
**Status:** **EM REVISÃO** — design fechado em sessão de grilling com o Diego e depois submetido a
revisão adversarial, que encontrou erros de fato e lacunas. As correções factuais estão aplicadas;
**três decisões continuam abertas** (ver seção "Decisões abertas") e **bloqueiam a implementação**.
Não planejar nem codar sobre este ADR até elas fecharem.
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

⚠️ **O plano Solo é 1 CNPJ, e cada org do PubliAI é um CNPJ emitente.** A conta de R$ 130 vale para
o primeiro cliente; a segunda org já não cabe. Degrau real, que precifica o módulo do D-5:

| Orgs com o módulo | Plano | Mensal |
|---|---|---|
| 1 | Solo | R$ 89,90 (100 notas) + R$ 0,10/excedente |
| 2 a 3 | Start | R$ 113,90 (100 notas por CNPJ) + R$ 0,10/excedente |
| 4+ | Growth | R$ 548,00 (4.000 notas, CNPJ ilimitado) + R$ 0,12/excedente |

O break-even de 4.000 notas/mês contra o serviço .NET próprio também é por conta inteira, não por
cliente — com 4 orgs a 500 notas o Growth já está em uso e a conta muda.

> **Registro:** a **Nuvem Fiscal**, apontada como a mais forte em multi-empresa na spec de julho,
> **encerrou em 31/07/2026**. Não é alternativa. Preços da Focus conferidos em 2026-08-12.

### D-4 — Gatilho: `ready_to_ship` + `invoice_pending`; Full depende de adesão ao Faturador

O ML sinaliza a hora: o envio entra em `ready_to_ship` com sub-status **`invoice_pending`** ("a
NF-e ainda não foi importada"). **Sem a nota, o despacho fica travado.**

Não em `paid`: cancelamento do comprador dias depois deixaria nota autorizada fora da janela de
cancelamento, obrigando cancelamento extemporâneo ou devolução (ver D-12).

⚠️ **`invoice_pending` não cobre todas as logísticas.** A documentação lista `drop_off`,
`xd_drop_off`, `cross_docking` e `xd_same_day`. **Flex (`self_service`), Turbo e ME1 seguem outro
fluxo** — e a obrigação fiscal de emitir não depende da logística. Um gatilho único deixaria o
cliente sem nota justamente nessas vendas. Ver **Decisão aberta 2**.

⚠️ **Full não é skip automático.** A adesão ao Faturador do ML é **opt-in** do vendedor; sem ela, o
ML não emite e um skip por `logistic.type` deixaria o cliente com **zero notas** — exatamente o
perfil "sem ERP" que motiva este ADR. O critério de saída não pode consagrar isso como correto.
Ver **Decisão aberta 1**.

O sinal de push já existe: `ml-webhook` já assina o tópico **`shipments`** e o roteia para
`sync-venda` com `shipping_id` (`ml-webhook/index.ts:16`). Nenhuma assinatura nova de webhook.
**Mas `logistic_type` não é lido em lugar nenhum hoje** — passa a ser lido do shipment.

Emissão assíncrona (QStash). **Falha de emissão nunca falha a venda** — mesma regra da baixa de
estoque (ADR-0094, critério 6). Botão manual "emitir agora" existe só como retentativa.

**Anexar ≠ importar.** São dois recursos distintos do ML e confundi-los trava o pedido:

| Recurso | Endpoint | Efeito |
|---|---|---|
| **Importar** | `POST /shipments/{shipment_id}/invoice_data/?siteId=MLB` | **destrava `invoice_pending` e libera a etiqueta** |
| Anexar | `POST /packs/{pack_id}/fiscal_documents` | só disponibiliza o documento ao comprador |

Ciclo completo:

```
webhook shipment → ready_to_ship + invoice_pending
  → emitir na Focus (série do PubliAI, ref = publiai-{org}-{pack_id ?? order_id})
  → AUTORIZADA → POST /shipments/{id}/invoice_data   ← é este que destrava
  → invoice_pending some → etiqueta libera → despacha
  → (opcional) anexar no pack, para o comprador ver
```

**O ML recusa XML gerado em homologação da SEFAZ.** Consequência direta sobre o D-13.

**Faltam no payload dados que não são cadastro nem decisão do contador** e que o worker precisa
buscar por venda: o grupo de **pagamento e intermediador** (NT 2020.006 e NT 2025.001 — `tpIntegra`,
CNPJ do intermediador, `tBand`, `cAut`). Toda venda do ML é intermediada e paga por cartão ou PIX;
sem esse grupo a nota rejeita. Entra no Bloco A como responsabilidade do worker `emitir-nfe`.

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

### D-7 — A unidade da nota é o **envio (shipment)**, não o pedido

Um carrinho com N itens do mesmo vendedor gera **N pedidos → 1 pack → 1 envio**, e o ML aceita uma
nota cobrindo mais de um número de venda. Chavear a nota no pedido emitiria **N notas para um único
envio**.

A âncora é o **shipment**, não o pack: é nele que a nota é importada
(`POST /shipments/{id}/invoice_data`, D-4) e é ele que carrega o `logistic_type` que decide o
roteamento. Pack e envio são 1↔0..1 na prática, então o resultado costuma coincidir — mas quando
divergirem (ver Decisão aberta 3), quem manda é o envio. Os itens da nota são a **união dos itens
dos pedidos daquele envio**.

O padrão `pedido.pack_id ?? pedido.id` **já existe no código**
(`_shared/faturamento/io.ts:302`, atualização do snapshot de status em `ml_mensagens`) e
`ml_vendas.pack_id` é persistido em `_shared/faturamento/venda.ts:313` (coluna criada em
`supabase/migrations/20260622193345_faturamento_vendas.sql:10`).

Três camadas contra nota duplicada:

1. **Reserva no banco antes da chamada** — `unique (org_id, shipment_id)` em `notas_fiscais`, linha
   inserida *antes* de falar com o provider. Mesmo padrão da saga de User Products (ADR-0088).
2. **Conflito no índice não para: retoma.** Se a primeira execução morrer entre o `INSERT` e a
   resposta da Focus, "parar no conflito" deixaria o pedido travado em `invoice_pending` para
   sempre, **sem rejeição definitiva que acionasse o D-9** — ninguém seria avisado. A retentativa
   lê o status da linha; se não for terminal, **consulta a `ref` na Focus e continua de onde
   parou**. É para isso que a `ref` idempotente existe.
3. **`ref` idempotente no provider** — `publiai-{org}-{shipment_id}`, estável e reconstruível sem
   consultar nada.

E a **série dedicada** (D-8) como quarta cerca.

### D-8 — Série dedicada ao PubliAI, obrigatória

A NF-e é numerada sequencialmente **por (CNPJ, modelo, série)**, com contadores independentes por
série. A série usada pelo PubliAI é **exclusiva dele**: nada mais no CNPJ emite nela.

O cliente segue emitindo normalmente em outras séries fora do PubliAI — é para isso que série
existe. O que quebra é o inverso: emitir avulso **na** série do PubliAI defasa o contador do
provider e a próxima nota rejeita por duplicidade.

Qual número usar é decisão do contador; o PubliAI só recebe e usa. **Sem série definida, o módulo
não liga** — trava LOUD. A trava valida a faixa: **1 a 889** é livre; **890–899** é NF-e avulsa do
fisco e **900–999** é contingência SCAN — série fora de 1–889 é recusada no cadastro.

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
`ml_vendas.uf`); **quais** são os dois é decisão fiscal que o contador escreve.

⚠️ O exemplo correto é **`5102`/`6108`**, não `5102`/`6102`: **6102 é venda interestadual a
contribuinte** de ICMS (PJ com IE, que toma crédito); a venda típica do ML é a **consumidor final
não contribuinte**, que é **6108**. Com ST, `5405`/`6404`. E o par não basta sozinho: um mesmo
emitente pode precisar de 6108 (PF) e 6102 (PJ com IE) na mesma UF, então existe um **terceiro
slot opcional** para interestadual a contribuinte, escolhido quando o destinatário tem IE.

**Por família** (produto): `ncm` · `cst_csosn` · `orig_nfe` (0 a 8) · `cest` (opcional, só com ST) ·
**CST de PIS** · **CST de COFINS** (campos próprios, distintos do CST de ICMS) · **natureza da
operação**. Para o Simples Nacional a carga é pequena (CSOSN 102 + PIS/COFINS 49/99); para Regime
Normal faltariam ainda alíquotas de ICMS e o grupo `ICMSUFDest` do DIFAL — motivo pelo qual a
**Decisão aberta 1** propõe restringir a v1 ao Simples.

**Regime tributário não é imutável.** Org que migra de Simples para Regime Normal (ou o inverso)
invalida o `cst_csosn` de **todas** as suas famílias de uma vez. A troca de regime na config
**invalida os códigos e exige recadastro**, com as famílias afetadas listadas — nunca converte
sozinha.

Família e não variação: variações se distinguem por **cor**, e cor não muda NCM nem CST. Em
variação seria o mesmo dado N vezes, com N chances de divergir. Override por variação só se um dia
aparecer família de NCM misto — não antes.

**Família sem `ncm`, `cst_csosn` ou `orig_nfe` não emite**: falha LOUD com o campo faltando
nomeado, exibida como pendência na Revisão junto das que já existem.

### D-11 — Dados do comprador: buscados sob demanda, nunca persistidos em coluna

`ml_vendas` hoje tem `comprador_nome`, `cidade` e `uf`. A NF-e exige CPF/CNPJ e endereço completo
(logradouro, número, bairro, CEP), que o ML entrega em `billing_info`.

⚠️ **O endpoint legado `/orders/{order_id}/billing_info` foi depreciado.** O caminho atual é ler
`buyer.billing_info.id` do `/orders` e consultar
`GET /orders/billing-info/{site_id}/{billing_info_id}`. E os campos podem vir **nulos enquanto o
documento está em `PROCESSING`** — esse caso é falha **transitória** (D-9), com retry; tratá-lo
como definitivo geraria "CPF do destinatário inválido" para um dado que existia e só não estava
pronto.

Esses dados são buscados **na hora de emitir** e **não viram coluna**. Persistir criaria uma base
de CPF e endereço de consumidor final — LGPD, RLS, retenção e risco de vazamento — sem necessidade.

O que se guarda é o **XML autorizado**, que já contém tudo e é o documento legal (obrigação de
guarda de 5 anos do emitente). Tabela `notas_fiscais`: `venda_id`, `ref`, `chave`, `numero`,
`serie`, `protocolo`, `status`, `erro`, `xml_path` (Supabase Storage por org, com RLS).
**Nenhuma coluna de CPF, nome ou endereço.**

### D-12 — Cancelamento automático; devolução e CC-e ficam de fora

**Cancelamento (24h, mercadoria não circulou): automático.** `sync-venda` já detecta `cancelled`
com envio pré-despacho (`pending`/`handling`/`ready_to_ship`) e já estorna estoque nesse ponto —
o cancelamento da nota pendura no mesmo gancho, com justificativa fixa.

⚠️ **Fora das 24h mas ainda pré-despacho, o rótulo não é "devolução".** Existe o **cancelamento
extemporâneo** (prazos por UF — 480h em SP, 30 dias no RJ, 168h em MG — com multa reduzida), e ele
é justamente para mercadoria que **não circulou**. Devolução pressupõe circulação; mandar o
contador emitir nota de entrada de mercadoria parada no estoque é o instrumento errado. A nota é
marcada **"exige cancelamento extemporâneo ou devolução — decisão do contador"**. O PubliAI
continua não emitindo nada; muda só a mensagem.

**Cancelamento parcial de pack.** O gancho de cancelamento é por pedido e a nota é por envio:
cancelar 1 pedido de um envio com N deixa a nota cobrindo item que não será vendido. Regra:
**pré-emissão** → emite só o restante; **pós-emissão dentro da janela** → cancela e reemite sem o
item; **pós-etiqueta impressa** → o ML não aceita alterar a nota, então marca "exige ação do
contador" e notifica.

**Devolução (NF-e de entrada, CFOP 1202/2202): fora do escopo, declarado.** É emissão nova com
regras próprias; o contador do cliente emite. Coerente com o corte que o ADR-0094 já fez
("devolução não é tocada") e com o D-2. `ml_devolucoes`/`sync-devolucao` detectam e sinalizam.

**Carta de Correção (CC-e): fora.** Ninguém pediu. A porta `TransmissorFiscal` tem onde encaixar
quando aparecer demanda.

**NF-e de remessa para o Full: fora.** Quem usa Full precisa emitir nota de remessa ao mandar
mercadoria para o centro de distribuição do ML. Não é venda, não tem gatilho no fluxo de pedido e
não cabe no desenho deste ADR. Fica declarado para que ninguém descubra a lacuna depois de vender
o módulo para um cliente Full.

### D-13 — Nasce em homologação; produção é promoção manual do super-admin

Campo `ambiente` por org (`homologacao` | `producao`), **nascendo em `homologacao`**. O cliente
sobe o certificado real desde o dia 1, mas as notas saem marcadas "SEM VALOR FISCAL" e não geram
obrigação fiscal. O super-admin promove para produção só depois de ver notas autorizadas de
verdade em homologação.

⚠️ **A homologação não pode pendurar em venda real.** O ML **recusa XML gerado em homologação da
SEFAZ**: enquanto a org estiver em `homologacao`, o XML não sobe, `invoice_pending` não some e a
etiqueta não libera — o cliente ficaria com pedidos reais parados e sem outro emissor. Logo:

- A homologação roda com **emissões sintéticas** (payload de venda de teste, disparado por ação
  explícita, **fora do fluxo do webhook**). Não espera venda real acontecer.
- **Venda real que chega com a org em `homologacao` não é emitida**: fica pendente com o motivo
  explícito ("org ainda em homologação") e notifica. Nunca tenta e falha em silêncio.
- Só faz sentido habilitar o módulo para uma org que já tem como emitir enquanto homologa, ou
  aceitar que a promoção aconteça antes da primeira venda. **A trava de habilitação é o lugar de
  dizer isso ao operador.**

## Decisões abertas — bloqueiam a implementação

Levantadas em revisão adversarial do design fechado. Cada uma muda o escopo ou o schema; nenhuma
pode ser resolvida por default.

### Aberta 1 — a v1 é só Simples Nacional?

A NT 2025.002 tornou os grupos **IBS/CBS obrigatórios sob pena de rejeição desde 03/08/2026 para
Lucro Presumido e Lucro Real**. Hoje é 2026-08-12: já está valendo. **Simples Nacional e MEI só
entram em 04/01/2027.**

O dado (CST de IBS/CBS + `cClassTrib` por item) é etapa A — decisão do contador, não cálculo nosso —
e não existe no D-10. Cliente de Regime Normal teria a primeira nota rejeitada no dia 1.

**Recomendado: v1 restrita ao Simples Nacional**, declarada no ADR, com trava na habilitação
(org de Regime Normal não liga o módulo). Ganha ~5 meses de folga, reduz o D-10 à carga que o
Simples exige (CSOSN 102 + PIS/COFINS 49/99, sem alíquotas de ICMS nem `ICMSUFDest`) e evita
desenhar o DIFAL — que para o Simples é **inexigível** (ADI 5469/Tema 1093). O prazo de 04/01/2027
entra como data no roadmap, não como surpresa.

### Aberta 2 — Flex, Turbo e ME1 entram na v1?

`invoice_pending` cobre `drop_off`, `xd_drop_off`, `cross_docking` e `xd_same_day`. Flex, Turbo e
ME1 seguem outro fluxo — mas a obrigação de emitir não muda. Com um gatilho só, essas vendas
**nunca disparam o worker**.

**Recomendado: v1 cobre só as logísticas com `invoice_pending`**, com **trava LOUD na habilitação**
(org que usa Flex/Turbo/ME1 vê a lista do que ficará sem nota antes de ligar o módulo). Segundo
gatilho entra depois, medido. O que não pode existir é org habilitada achando que está coberta.

### Aberta 3 — como o Full é tratado, já que o Faturador é opt-in?

Skip por `logistic.type` deixa zero nota para quem não aderiu. Emitir sempre gera duplicata para
quem aderiu.

**Recomendado: perguntar no onboarding** ("esta org aderiu ao Faturador do ML?") e gravar na config
fiscal. Aderiu → skip no Full. Não aderiu → emite também no Full. **Nunca decidir por
`logistic_type` sozinho.** Se der para confirmar a adesão pela API do ML, melhor — vira verificação
em vez de declaração.

## Escopo da v1

**Bloco A — emitir:** config fiscal por org + certificado passthrough + série · campos fiscais por
família na Revisão e no cadastro · porta `TransmissorFiscal` + adaptador Focus · worker
`emitir-nfe` no webhook `ready_to_ship`/`invoice_pending` com skip de Full · POST do XML no pack
do ML · `notas_fiscais` + XML no Storage + badge de pendência na tela de vendas.

**Bloco B — operar (entra junto):** cancelamento automático pré-despacho · alerta de vencimento de
certificado · painel de rejeições em `/admin`.

## Critério de saída

1. Venda real: `invoice_pending` → nota autorizada → `POST /shipments/{id}/invoice_data` →
   `invoice_pending` some → **etiqueta libera de fato** (o teste é a etiqueta, não o HTTP 200)
2. Replay do webhook pelo QStash **não** emite segunda nota
3. Worker morto entre o `INSERT` e a resposta da Focus: a retentativa **retoma e conclui** —
   nenhum pedido fica travado em `invoice_pending` sem ninguém ser avisado
4. **Carrinho com N itens (1 envio, N pedidos) gera 1 nota com N itens**, não N notas
5. Pedido Full: emite ou não conforme a adesão ao Faturador declarada na org (Aberta 3) — e o
   comportamento é verificado nos **dois** estados
6. Venda de logística não coberta não some em silêncio: aparece como "fora do escopo do módulo"
7. Grupo de pagamento/intermediador presente no XML (nota de venda paga por cartão e por PIX,
   ambas autorizadas)
8. Família sem `ncm` falha LOUD com o campo faltando nomeado
9. Org sem o módulo: tela some **e** a edge devolve 403
10. Org em `homologacao`: emissão sintética autoriza na SEFAZ; venda real **não** é emitida e
    notifica o motivo
11. Certificado vencendo em 30 dias dispara notificação
12. Cancelamento pré-despacho cancela a nota; fora da janela marca "cancelamento extemporâneo ou
    devolução"; cancelamento parcial segue a regra do D-12
13. Nenhuma coluna com CPF, nome ou endereço de comprador em nenhuma tabela
14. Gate padrão: `pnpm test` + `npx tsc --noEmit` + `deno check` + `pnpm lint` + `pnpm build`
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

**E o segundo risco da spec de julho — "manutenção fiscal perpétua" — se confirmou na primeira
semana de vida deste ADR.** A NT 2025.002 mudou de versão várias vezes em 2026, ativando e
desativando rejeições de IBS/CBS, e a obrigação alcança o Simples em 04/01/2027. Escolher a Focus
transfere o *layout*; não transfere o *dado* nem o *prazo*. Isso não invalida a decisão — invalida
tratá-la como entrega que acaba.

## A verificar antes de codar

Levantado na revisão adversarial, sem fonte que feche:

1. **Confirmar em conta real** que `POST /shipments/{id}/invoice_data` destrava `invoice_pending` e
   que o anexo por pack **não** destrava. Toda a v1 depende disso.
2. **Confirmar a lista de logísticas** com `invoice_pending` (Aberta 2) contra um pedido real de
   cada tipo.
3. **Pack misto Full + não-Full**: existe? Se um `pack_id` puder juntar item do CD com item do
   vendedor, a regra "itens do envio" (D-7) precisa ser testada nesse caso. Só um pedido real tira
   a dúvida.
4. **Focus reaproveita o número após rejeição definitiva?** O D-8 descarta inutilização com base
   nisso, sem documento que confirme.

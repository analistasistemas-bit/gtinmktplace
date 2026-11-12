# ADR-0201 — Galeria da cor por IA: gerada e aplicada em Publicados

- **Status:** proposto (desenho fechado em sessão de perguntas; falta medição de modelos; plano escrito e aprovado em `docs/superpowers/plans/2026-11-08-galeria-da-cor.md`, v23)
- **Data:** 2026-11-08
- **Alterado por:** ADR-0203 (itens §2, §3, §9, §10 e §12 substituídos; o restante segue valendo)
- **Decisores:** Diego
- **Refina:** ADR-0200 (gerador de imagem e modelo por organização), ADR-0074 (modelo de IA por organização), ADR-0060 (ação em anúncio no ar restrita a admin)
- **Glossário:** `CONTEXT.md`, seção "Imagens do anúncio por IA"

## Contexto

Clientes pedem as sete imagens de anúncio (capa, contexto de uso, quebra de objeção, benefícios, especificações,
como usar, detalhes) que hoje Diego produz fora do PubliAI com um agente de IA, a partir da foto do produto e da
descrição do anúncio. O cliente que pedir paga por imagem.

## Decisão

1. **Galeria por cor.** Cada cor da família tem a sua galeria de até sete imagens; a mesma escolha de missões vale
   para todas as cores. Sugestão: as sete até 3 cores, as quatro primeiras acima disso; o operador ajusta e vê o total
   de imagens e o custo antes de confirmar.
2. **Um roteiro por família.** A IA escreve o roteiro (missão, cenário, headline, subheadline e fatos de cada imagem);
   o operador revisa e edita antes de qualquer imagem. Cada galeria sai do roteiro com a foto da própria cor como
   referência e o nome da cor nos textos. O roteiro não é cobrado do cliente.
3. **Fatos só dos dados da família.** A leitura da etiqueta pela IA só confere. Divergência trava a geração, mostra o
   recorte da etiqueta com o valor dela como sugestão (regra "obedeça o rótulo") e a escolha corrige os dados da
   família. A capa (imagem 1) nunca recebe texto, selo ou headline.
4. **Só em Publicados.** A galeria nasce para anúncio já publicado; a Revisão não muda e a publicação nunca espera
   imagem. Gerar, aprovar e aplicar são passos separados: aprovar só guarda; aplicar é comando explícito.
5. **Aplicar** substitui as fotos da cor (padrão; a capa gerada vira a primeira foto) ou adiciona depois das atuais.
   O limite de fotos da categoria é conferido antes do envio; as fotos anteriores ficam guardadas para reverter.
   Anúncio com cores no mesmo item recebe todas as variações no envio (o ML apaga as omitidas); User Products recebe
   um envio por item. Anúncio de catálogo fica fora.
6. **Cobrança:** toda imagem gerada com sucesso e exibida é faturável, inclusive cada nova geração; falha técnica do
   provedor não cobra. Um preço por imagem por organização (`image_unit_cents`), independente do modelo.
7. **Modelo:** o admin da plataforma escolhe provedor e modelo por organização (Nano Banana via OpenRouter ou modelos
   da Higgsfield). Cada modelo entra por um cadastro curto (endpoint, campo de referência, máximo de referências,
   parâmetros fixos, custo) e só é liberado após uma geração real; só entram modelos que aceitam foto de referência.
   Liberados na medição de 08/11 (3 produtos reais × 3 missões): **Nano Banana 2.1 (padrão)**, **Grok Imagine 2** e
   **Qwen Image 3 Edit** (Higgsfield). Fora: Marketing Studio (apagou texto de etiqueta), Ideogram 4 e Soul 2 i2i
   (trocaram o produto).
8. **Permissão:** gerar e aprovar, qualquer usuário da organização com o módulo `imagem_ia`; aplicar e reverter, só
   admin da organização.
9. **Texto composto pelo sistema:** o modelo gera a cena sem texto de marketing; o PubliAI escreve headline,
   benefícios, especificações e legendas por cima, com layout fixo por missão. Elimina erro de letra (no uso real,
   cerca de 1 em cada 7 imagens geradas com texto vinha com defeito) e gerações pagas só para corrigir texto.
10. **Verificação por visão só alerta:** toda imagem é conferida e recebe alertas (cor, produto, texto na cena),
    mas nada é escondido nem gerado de novo sozinho; o operador decide e a imagem exibida é faturável. Esconder
    reprovadas foi descartado: a verificação do kit reprovou imagem boa no teste de 08/11.
11. **Moda sem texto sobreposto:** nas categorias de Moda do ML (partes de cima e de baixo, vestidos e macacões,
    roupa íntima e de praia e afins) a galeria não leva texto em nenhuma imagem — as páginas oficiais do ML proíbem
    textos acrescentados e medidas na imagem. As missões viram fotos nos planos que o ML pede (frente, costas, corpo
    inteiro, em uso, detalhe do tecido); benefícios e ficha técnica ficam fora (já estão nos atributos). Demais
    categorias seguem com texto composto. Lista de categorias de Moda fixa em código, revisada quando o ML mudar.
12. **Fato confirmado vem de pessoa:** planilha e atributos editados pelo operador. Título, descrição e atributos
    escritos por IA aparecem como "sugerido" e só viram fato com um clique do operador (registrado por família).
    Aceitar tudo o que está no anúncio publicado foi descartado: a IA confirmaria a própria invenção.
13. **Retenção:** arquivos (Storage, bucket `imagens`, nunca no banco) de imagens aprovadas ou aplicadas ficam
    para sempre (reaplicar, reverter, auditar cobrança); não aprovadas são apagadas após 30 dias. A linha no banco,
    com custo e histórico, é preservada.
    **Anotação (2026-11-11): a regra dos 30 dias está ADIADA.** A retenção implementada (`galeria-retencao`) apaga só
    órfãos que nenhuma linha cita (cena órfã de posse perdida e final não citado, com mais de 1 dia). Apagar cena citada
    quebraria a exibição (`galeria_confirmar_exibicao` exige `cena_path`). Implementar exige status "expirada" na linha e
    decisão sobre `cena_path`. Decisão do Diego pendente.

## Alternativas descartadas

- **Gerar na Revisão, antes do CREATE** (sugerida também pelos revisores externos): atrasaria a publicação em dezenas
  de minutos por família e cobraria galeria de produto que talvez nunca venda. Pode voltar como fatia futura
  reaproveitando a mesma galeria.
- **Galeria única por família:** o comprador que escolhe outra cor veria imagens de uma cor só.
- **Cobrar só a imagem aprovada:** a Daludi absorveria cada geração descartada, sem teto.
- **Rótulo vence sozinho:** um erro de leitura da IA alteraria o anúncio sem revisão humana.

## Consequências

- O gatilho de cobrança atual (`platform_image_deliveries`, preso a `kit_variacao_imagens`) precisa aceitar uma
  segunda origem de imagem.
- Geração em segundo plano: uma família de 10 cores leva dezenas de minutos; não cabe numa chamada de edge.
- O gerador não entrega 1200×1540 exato: a imagem é recortada ao centro na proporção (capa com preenchimento branco)
  antes do envio.
- Envio das fotos por upload direto (`POST /pictures` multipart), que no uso real processa na hora; o envio por URL
  já ficou preso em processamento.
- Pendentes antes do plano: medição real de fidelidade e texto em português (Nano Banana × modelos Higgsfield) e
  conferência dos limites de fotos por categoria.

## Adendo técnico

Decisões de implementação registradas pelo plano `docs/superpowers/plans/2026-11-08-galeria-da-cor.md` (v23, aprovado), com os riscos aceitos.

- **(a) Composição no navegador.** As edges têm 2 s de CPU, então a composição final não roda em worker. O arquivo final vem do navegador do operador da própria org; o servidor valida formato, dimensões e peso e guarda o hash. Risco aceito: o servidor não refaz a composição.
- **(b) Fila na linha e despachante.** O estado vive na linha como fila de trabalho; `galeria-despachante` (1 min) é o único retomador. Cada worker executa uma fase com claim e lease e não encadeia mensagens. A Higgsfield é consultada pelo despachante, com prazo de 12 min. Risco aceito: queda durante uma chamada paga permite no máximo 1 nova submissão (custo da Daludi; o cliente é cobrado uma vez).
- **(c) Cobrança na exibição confirmada.** O navegador confirma a exibição pela RPC atômica `galeria_confirmar_exibicao`, ao preço confirmado no pedido; a RPC chama `galeria_registrar_entrega` por imagem.
- **(d) Aplicar como saga.** Saga persistida com manifesto imutável e portão de aborto, na fila `publish-ml-${familias.user_id}`.
- **(e) Recortes sem gerador.** Os recortes não passam pelo gerador de imagem.
- **(f) Relógio das retomadas.** É o agendamento de 1 min do `galeria-despachante` no QStash; o `pg_cron` de (i) é só a rede de segurança em SQL e não publica no QStash.
- **(g) Trava de escrita por MLB.** `ml_item_travas` é compartilhada entre a galeria e os escritores comuns (`update-familia-ml`, `publicar-split-ml`), porque a fila `publish-ml-${user_id}` não serializa por anúncio desde a E7. Job adiado acorda fora da fila serial; o adiamento fica persistido em `ml_escritas_adiadas` e o despachante o retoma.
- **(h) Identidade da galeria = anúncio/partição.** A chave é `anuncio_externo_id`, resolvido no servidor a partir do `ml_item_id` da linha clicada em Publicados; nenhum ou mais de um anúncio → 409 `anuncio_ambiguo`. A família é só a versão dos dados: a vigente é a de maior `publicado_em` não nulo entre as famílias do `codigo_pai` que contêm SKU vivo deste anúncio/partição. Trabalho novo exige a vigente (`familia_nao_vigente` caso contrário); operações históricas (listar, `confirmar_exibicao`, consultar aplicação e `reverter`) aceitam qualquer família do mesmo anúncio.
- **(i) Relógio no banco como rede de segurança.** Um `pg_cron` (só SQL) encerra aplicação `em_andamento|abortando|revertendo` com `ciclo_ate` vencido (3 h por ciclo) e nenhum item com lease vigente: grava `reversao_incompleta` e solta as travas com a quarentena de 15 min desde o último PUT; nenhum PUT depois do estado terminal. Imagem órfã (`pendente|submetendo|gerando` com `criado_em + 60 min < now()` e lease nulo ou vencido) vai a `falhou` (`expirada`), sem nova chamada. Escrita adiada órfã (`adiado_desde + 260 min`, `assumida_ate` nulo ou vencido e nenhuma trava `escritor` vigente) vira `erro` só sobre família ainda `publicando`, com o lote recalculado por `lote_decidir_status` e a linha apagada, sem tocar `variacoes`. Risco aceito: a foto que ficar no anúncio aparece na tela como `reversao_incompleta`; soltar a trava é preferível a travá-lo para sempre.
- **(j) Cobrança por `galeria_registrar_entrega`.** Preço, `terms_id` e elegibilidade vêm congelados do pedido, sem `platform_resolve_terms`. O gatilho do kit (`platform_image_delivery_on_generated`) passa a chamar o helper `platform_imagem_competencia` (lock da org + laço de mês fechado) no lugar do trecho idêntico, uma cópia só; o resto do gatilho (preço do kit via `platform_resolve_terms`) não muda. A galeria usa o mesmo helper.

# ADR-0201 — Galeria da cor por IA: gerada e aplicada em Publicados

- **Status:** proposto (desenho fechado em sessão de perguntas; falta medição de modelos e plano)
- **Data:** 2026-11-08
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

# RELATÓRIO DESCRITIVO DO PROGRAMA DE COMPUTADOR

> **Natureza deste arquivo:** descrição técnica de apoio e registro interno da versão depositada. O relatório não substitui os campos do formulário e-Software e, de acordo com as orientações atuais do INPI, não é um anexo obrigatório do pedido eletrônico.

**Título do programa:** PubliAI - Sistema Inteligente de Automação e Geração de Anúncios para E-commerce
**Nome conhecido:** PubliAI
**Versão/marco técnico:** `0.0.1` `[CONFIRMAR A VERSÃO DEPOSITADA]`
**Titular:** `[RAZÃO SOCIAL / NOME DO TITULAR]`
**Data de criação/conclusão:** `[DD/MM/AAAA]`
**Data de publicação:** `[DD/MM/AAAA ou NÃO PUBLICADO]`

## 1. Título e objeto

O PubliAI é uma aplicação web destinada à ingestão, organização, análise e preparação de dados de produtos para geração, revisão e publicação de anúncios em marketplace, com integração operacional ao Mercado Livre.

A proteção pretendida recai sobre a expressão do programa de computador, especialmente o código-fonte e sua organização funcional implementada. A descrição não pretende reivindicar, como programa de computador autônomo, uma ideia de negócio, método comercial, fórmula, conteúdo de catálogo, marca, imagem ou modelo de inteligência artificial de terceiro.

## 2. Finalidade e aplicação

O programa transforma dados estruturados de produtos, especialmente planilhas, em registros de catálogo e anúncios revisáveis. A aplicação atende rotinas de comércio eletrônico e automação comercial, com foco em catálogos com variações de produto, estoque, imagens, preço e atributos.

As principais aplicações implementadas são:

- ingestão e validação de planilhas nos formatos suportados pelo sistema, incluindo XLSX e CSV;
- normalização de campos como código, nome, descrição, GTIN, custo, preço, estoque, unidade e atributos de variação;
- agrupamento de linhas em famílias e variações de produtos;
- geração assistida por inteligência artificial de títulos, descrições, termos e informações de anúncio, com validações determinísticas do resultado;
- análise visual de imagens de produto para apoio à identificação de cor, com possibilidade de revisão manual;
- consulta de categorias, atributos e dados operacionais do Mercado Livre;
- revisão, aprovação, exportação e publicação de anúncios;
- controle de estoque, preços, vendas, mensagens e status de anúncios publicados, conforme os módulos habilitados.

## 3. Plataforma e ambiente de execução

O programa utiliza uma arquitetura web distribuída composta por serviços gerenciados:

- **Frontend:** aplicação React 18 escrita em TypeScript, construída com Vite e Tailwind CSS, executada em navegadores web modernos.
- **Hospedagem do frontend:** publicação dos arquivos estáticos em infraestrutura Render.
- **Backend:** Supabase Edge Functions, executadas em ambiente Deno/TypeScript, responsáveis por autenticação complementar, regras de negócio, processamento assíncrono e integrações.
- **Persistência:** PostgreSQL gerenciado pelo Supabase, com autenticação, Storage para arquivos e políticas de segurança por linha (RLS) para isolamento lógico por organização.
- **Filas e processamento assíncrono:** Upstash QStash para enfileiramento, retries e execução de workers; Upstash Redis via API REST para cache, contadores e valores temporários.
- **Inteligência artificial:** chamadas por API compatível com OpenAI, roteadas pelo OpenRouter. Os modelos são configuráveis por organização ou variável de ambiente; na configuração padrão conferida em 02/08/2026, o modelo de texto é `openai/gpt-4.1-mini` e o de visão é `openai/gpt-4o`.
- **Integração externa:** API do Mercado Livre para categorias, catálogo, anúncios, estoque, mensagens, vendas e status de publicação.

## 4. Linguagens, bibliotecas e padrões técnicos

1. **TypeScript e JavaScript/ECMAScript:** frontend React, funções de borda, workers e lógica de integração.
2. **SQL e PL/pgSQL:** esquema do banco de dados, funções, triggers, políticas RLS e consultas de persistência.
3. **HTML5 e CSS3:** estrutura e apresentação da interface, com Tailwind CSS.
4. **Shell Script e arquivos de configuração:** automação de verificações, build e tarefas auxiliares.
5. **Bibliotecas e serviços relevantes:** React, Vite, Supabase JS, SheetJS/XLSX, jsPDF, Upstash QStash/Redis e cliente OpenAI compatível com OpenRouter.

As versões exatas das dependências e o conjunto de arquivos técnicos de referência devem ser preservados junto do arquivo cujo hash será informado no pedido.

## 5. Estrutura lógica e funcionalidades principais

```text
Usuário / navegador
        |
        v
Interface React + TypeScript
        |
        v
Supabase Auth / cliente Supabase
        |
        v
Supabase Edge Functions (Deno/TypeScript)
   |          |             |             |
   v          v             v             v
PostgreSQL  Storage       Upstash       APIs de IA
 + RLS      de arquivos    QStash/Redis  via OpenRouter
        |
        v
Integração com a API do Mercado Livre
```

### 5.1 Autenticação, organizações e segurança

O acesso é autenticado por usuário e associado a uma organização. O `org_id` é utilizado para delimitar dados e operações. O PostgreSQL aplica RLS e as funções de backend validam o contexto da organização antes de processar lotes, famílias, variações, estoque e conexões de marketplace.

### 5.2 Ingestão de planilhas e catálogo

O usuário envia um lote, o sistema lê a planilha, valida as colunas, normaliza os valores, verifica a origem dos produtos, agrupa as linhas por produto-pai e cria as famílias e variações correspondentes. As imagens associadas são identificadas pelos códigos definidos no lote.

### 5.3 IA para copy e visão

O módulo de copywriter constrói prompts estruturados, solicita resposta em formato JSON e normaliza os campos retornados. O título é composto por slots controlados e passa por validações de tamanho e conteúdo. O módulo de visão recebe a imagem do produto e devolve uma cor canônica; respostas duvidosas podem ser direcionadas para validação manual.

### 5.4 Revisão, publicação e operação

Após o processamento, o usuário revisa e aprova os dados. O sistema pode publicar ou atualizar anúncios, organizar a publicação em filas, sincronizar estoque e status, tratar mensagens e registrar resultados para consulta e auditoria.

## 6. Fluxo de execução resumido

1. O usuário autentica-se e seleciona a organização autorizada.
2. O usuário envia um lote de planilha e, quando aplicável, imagens relacionadas.
3. O frontend registra o lote e chama a função de ingestão; o backend valida o `org_id`, baixa a planilha do Storage e processa as linhas.
4. O sistema normaliza os registros, agrupa famílias e variações, preserva vínculos com anúncios anteriores e encaminha as famílias pendentes para o QStash.
5. As funções de processamento consultam categorias e dados do Mercado Livre e, quando necessário, usam os módulos de copy e visão via OpenRouter.
6. Os resultados são gravados no PostgreSQL com isolamento por organização e exibidos na tela de revisão.
7. O usuário corrige ou aprova as informações; o sistema gera exportações e/ou enfileira a publicação no Mercado Livre.
8. Workers assíncronos processam publicação, estoque, mensagens, vendas e reconciliações, com retries e registros de erro.

## 7. Dependências e conteúdo de terceiros

O sistema utiliza bibliotecas, APIs, serviços de nuvem, modelos de IA e conteúdos eventualmente fornecidos por terceiros. O titular deve manter os avisos de licença, contratos, autorizações, termos de uso e registros de configuração aplicáveis. O relatório descreve a implementação própria do PubliAI e não atribui ao titular a autoria de componentes de terceiros.

## 8. Identificação técnica para o pedido

- Arquivo/conjunto técnico mantido pelo titular: `[NOME EXATO DO ARQUIVO]`
- Algoritmo do resumo digital: `SHA-512`
- Hash informado: `0dbfb4e3d171220ccec0cc218d4d6f32fd57a9d60f96f9b2fd8d9142f92af527dd97d2e60ea82ed7d9e6444d8dc56a594ff47983ea1c7d636443a560a23abcca`
- Data da última conferência do hash: `20/08/2026`

O hash acima só deve ser usado se o arquivo técnico correspondente estiver preservado sem qualquer alteração.

`[CIDADE/UF]`, `[DD]` de `[MÊS]` de `[ANO]`.

__________________________________________________
`[NOME DO RESPONSÁVEL PELA REVISÃO TÉCNICA]`
`[CARGO / QUALIFICAÇÃO]`

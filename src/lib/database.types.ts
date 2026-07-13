export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anuncios_externos: {
        Row: {
          atualizado_em: string
          canal: Database["public"]["Enums"]["canal_externo"]
          codigo_pai: string
          criado_em: string
          erro_mensagem: string | null
          id: string
          item_externo_id: string | null
          metadados_canal: Json
          org_id: string
          particao: number
          permalink: string | null
          preco_override: number | null
          publicado_em: string | null
          qstash_message_id: string | null
          status: string
          titulo: string | null
          user_id: string
          variacoes_externas: Json
        }
        Insert: {
          atualizado_em?: string
          canal: Database["public"]["Enums"]["canal_externo"]
          codigo_pai: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          item_externo_id?: string | null
          metadados_canal?: Json
          org_id: string
          particao?: number
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          qstash_message_id?: string | null
          status?: string
          titulo?: string | null
          user_id: string
          variacoes_externas?: Json
        }
        Update: {
          atualizado_em?: string
          canal?: Database["public"]["Enums"]["canal_externo"]
          codigo_pai?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          item_externo_id?: string | null
          metadados_canal?: Json
          org_id?: string
          particao?: number
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          qstash_message_id?: string | null
          status?: string
          titulo?: string | null
          user_id?: string
          variacoes_externas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_externos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          ai_model_imagem: string | null
          ai_model_texto: string | null
          aliquota_importado_pct: number
          aliquota_nacional_pct: number
          atualizado_em: string
          criado_em: string
          desconto_concorrencia_pct: number
          desconto_pct: number
          mp_access_token_secret_id: string | null
          org_id: string
          reancora_lider_ativa: boolean
          telegram_ativo: boolean
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          user_id: string
        }
        Insert: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_nacional_pct?: number
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mp_access_token_secret_id?: string | null
          org_id: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          user_id: string
        }
        Update: {
          ai_model_imagem?: string | null
          ai_model_texto?: string | null
          aliquota_importado_pct?: number
          aliquota_nacional_pct?: number
          atualizado_em?: string
          criado_em?: string
          desconto_concorrencia_pct?: number
          desconto_pct?: number
          mp_access_token_secret_id?: string | null
          org_id?: string
          reancora_lider_ativa?: boolean
          telegram_ativo?: boolean
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      familias: {
        Row: {
          analise_mercado: Json | null
          atacado: Json | null
          atacado_erro: string | null
          atacado_status: string | null
          atributos_editados_pelo_operador: boolean
          atributos_faltantes: Json | null
          atributos_ml: Json
          atualizado_em: string
          capa_ml_picture_id: string | null
          capa_storage_path: string | null
          capa2_ml_picture_id: string | null
          capa2_storage_path: string | null
          capa3_ml_picture_id: string | null
          capa3_storage_path: string | null
          categoria_ml_id: string | null
          categoria_nome: string | null
          codigo_pai: string
          concorrencia_categoria_id: string | null
          concorrencia_classe: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min: number | null
          concorrencia_vendedores: number
          criado_em: string
          custo_centavos: number | null
          desconto_pct: number | null
          descricao_editada_pelo_operador: boolean
          descricao_ml: string | null
          descricao_pai: string | null
          editado_em: string | null
          erro_mensagem: string | null
          estrategia_motivo: string | null
          estrategia_preco:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          exibir_com_desconto: boolean
          fornecedor: string | null
          frete_gratis: boolean
          id: string
          lote_id: string
          ml_item_id: string | null
          ml_permalink: string | null
          mudanca_estrutural: Json | null
          nome_pai: string
          observacao_operador: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem: Database["public"]["Enums"]["origem_produto"]
          preco_reancorado_lider: boolean
          publicado_em: string | null
          qstash_message_id: string | null
          sale_terms: Json
          shipping_mode: string
          status: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_editado_pelo_operador: boolean
          titulo_ml: string | null
          tokens_input: number | null
          tokens_output: number | null
          unidade: string | null
          user_id: string
          variacao_principal_codigo: string | null
        }
        Insert: {
          analise_mercado?: Json | null
          atacado?: Json | null
          atacado_erro?: string | null
          atacado_status?: string | null
          atributos_editados_pelo_operador?: boolean
          atributos_faltantes?: Json | null
          atributos_ml?: Json
          atualizado_em?: string
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          categoria_ml_id?: string | null
          categoria_nome?: string | null
          codigo_pai: string
          concorrencia_categoria_id?: string | null
          concorrencia_classe?: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem?: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min?: number | null
          concorrencia_vendedores?: number
          criado_em?: string
          custo_centavos?: number | null
          desconto_pct?: number | null
          descricao_editada_pelo_operador?: boolean
          descricao_ml?: string | null
          descricao_pai?: string | null
          editado_em?: string | null
          erro_mensagem?: string | null
          estrategia_motivo?: string | null
          estrategia_preco?:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          exibir_com_desconto?: boolean
          fornecedor?: string | null
          frete_gratis?: boolean
          id?: string
          lote_id: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          nome_pai: string
          observacao_operador?: string | null
          operacao: Database["public"]["Enums"]["operacao_ml"]
          org_id: string
          origem?: Database["public"]["Enums"]["origem_produto"]
          preco_reancorado_lider?: boolean
          publicado_em?: string | null
          qstash_message_id?: string | null
          sale_terms?: Json
          shipping_mode?: string
          status?: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento?: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem?: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_editado_pelo_operador?: boolean
          titulo_ml?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          unidade?: string | null
          user_id: string
          variacao_principal_codigo?: string | null
        }
        Update: {
          analise_mercado?: Json | null
          atacado?: Json | null
          atacado_erro?: string | null
          atacado_status?: string | null
          atributos_editados_pelo_operador?: boolean
          atributos_faltantes?: Json | null
          atributos_ml?: Json
          atualizado_em?: string
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          categoria_ml_id?: string | null
          categoria_nome?: string | null
          codigo_pai?: string
          concorrencia_categoria_id?: string | null
          concorrencia_classe?: Database["public"]["Enums"]["classe_concorrencia"]
          concorrencia_origem?: Database["public"]["Enums"]["origem_concorrencia"]
          concorrencia_preco_min?: number | null
          concorrencia_vendedores?: number
          criado_em?: string
          custo_centavos?: number | null
          desconto_pct?: number | null
          descricao_editada_pelo_operador?: boolean
          descricao_ml?: string | null
          descricao_pai?: string | null
          editado_em?: string | null
          erro_mensagem?: string | null
          estrategia_motivo?: string | null
          estrategia_preco?:
            | Database["public"]["Enums"]["estrategia_preco"]
            | null
          exibir_com_desconto?: boolean
          fornecedor?: string | null
          frete_gratis?: boolean
          id?: string
          lote_id?: string
          ml_item_id?: string | null
          ml_permalink?: string | null
          mudanca_estrutural?: Json | null
          nome_pai?: string
          observacao_operador?: string | null
          operacao?: Database["public"]["Enums"]["operacao_ml"]
          org_id?: string
          origem?: Database["public"]["Enums"]["origem_produto"]
          preco_reancorado_lider?: boolean
          publicado_em?: string | null
          qstash_message_id?: string | null
          sale_terms?: Json
          shipping_mode?: string
          status?: Database["public"]["Enums"]["familia_status"]
          tipo_aviamento?: Database["public"]["Enums"]["tipo_aviamento"] | null
          tipo_origem?: Database["public"]["Enums"]["tipo_origem"] | null
          titulo_editado_pelo_operador?: boolean
          titulo_ml?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          unidade?: string | null
          user_id?: string
          variacao_principal_codigo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "familias_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "familias_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes: {
        Row: {
          anomalias_planilha: Json
          atacado_default: Json | null
          atualizado_em: string
          criado_em: string
          erro_mensagem: string | null
          id: string
          imagens_paths: string[]
          numero: number
          numero_org: number | null
          org_id: string
          planilha_path: string | null
          status: Database["public"]["Enums"]["lote_status"]
          total_erros: number
          total_familias: number
          total_publicadas: number
          user_id: string
        }
        Insert: {
          anomalias_planilha?: Json
          atacado_default?: Json | null
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          numero_org?: number | null
          org_id: string
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id: string
        }
        Update: {
          anomalias_planilha?: Json
          atacado_default?: Json | null
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          numero_org?: number | null
          org_id?: string
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lotes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_connections: {
        Row: {
          access_token_secret_id: string | null
          atualizado_em: string
          auth_alerta_em: string | null
          canal: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id: string | null
          conta_label: string | null
          criado_em: string
          criado_por: string | null
          expires_at: string | null
          id: string
          org_id: string
          refresh_token_secret_id: string | null
          scope: string | null
          ultima_sincronizacao_ok_em: string | null
        }
        Insert: {
          access_token_secret_id?: string | null
          atualizado_em?: string
          auth_alerta_em?: string | null
          canal: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id?: string | null
          conta_label?: string | null
          criado_em?: string
          criado_por?: string | null
          expires_at?: string | null
          id?: string
          org_id: string
          refresh_token_secret_id?: string | null
          scope?: string | null
          ultima_sincronizacao_ok_em?: string | null
        }
        Update: {
          access_token_secret_id?: string | null
          atualizado_em?: string
          auth_alerta_em?: string | null
          canal?: Database["public"]["Enums"]["canal_externo"]
          conta_externa_id?: string | null
          conta_label?: string | null
          criado_em?: string
          criado_por?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string
          refresh_token_secret_id?: string | null
          scope?: string | null
          ultima_sincronizacao_ok_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_credentials: {
        Row: {
          access_token_secret_id: string
          atualizado_em: string
          criado_em: string
          expires_at: string
          ml_nickname: string | null
          ml_user_id: string
          org_id: string
          refresh_token_secret_id: string
          scope: string | null
          user_id: string
        }
        Insert: {
          access_token_secret_id: string
          atualizado_em?: string
          criado_em?: string
          expires_at: string
          ml_nickname?: string | null
          ml_user_id: string
          org_id: string
          refresh_token_secret_id: string
          scope?: string | null
          user_id: string
        }
        Update: {
          access_token_secret_id?: string
          atualizado_em?: string
          criado_em?: string
          expires_at?: string
          ml_nickname?: string | null
          ml_user_id?: string
          org_id?: string
          refresh_token_secret_id?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_credentials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_devolucoes: {
        Row: {
          aberto_em: string | null
          acoes_pendentes: Json | null
          atualizado_em: string
          claim_id: number
          criado_em: string
          id: string
          order_id: number | null
          org_id: string
          raw: Json | null
          reason_id: string | null
          reason_texto: string | null
          return_status: string | null
          return_status_money: string | null
          stage: string | null
          status: string | null
          type: string | null
          user_id: string
          valor_em_jogo: number | null
        }
        Insert: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          atualizado_em?: string
          claim_id: number
          criado_em?: string
          id?: string
          order_id?: number | null
          org_id: string
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_status?: string | null
          return_status_money?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id: string
          valor_em_jogo?: number | null
        }
        Update: {
          aberto_em?: string | null
          acoes_pendentes?: Json | null
          atualizado_em?: string
          claim_id?: number
          criado_em?: string
          id?: string
          order_id?: number | null
          org_id?: string
          raw?: Json | null
          reason_id?: string | null
          reason_texto?: string | null
          return_status?: string | null
          return_status_money?: string | null
          stage?: string | null
          status?: string | null
          type?: string | null
          user_id?: string
          valor_em_jogo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_devolucoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_mensagens: {
        Row: {
          atualizado_em: string
          data_ml: string | null
          direcao: string
          id: string
          item_titulo: string | null
          lida: boolean
          message_id: string
          order_id: string | null
          org_id: string | null
          pack_id: string
          raw: Json | null
          texto: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          data_ml?: string | null
          direcao: string
          id?: string
          item_titulo?: string | null
          lida?: boolean
          message_id: string
          order_id?: string | null
          org_id?: string | null
          pack_id: string
          raw?: Json | null
          texto?: string
          user_id: string
        }
        Update: {
          atualizado_em?: string
          data_ml?: string | null
          direcao?: string
          id?: string
          item_titulo?: string | null
          lida?: boolean
          message_id?: string
          order_id?: string | null
          org_id?: string | null
          pack_id?: string
          raw?: Json | null
          texto?: string
          user_id?: string
        }
        Relationships: []
      }
      ml_moderacao: {
        Row: {
          alertado_em: string | null
          atualizado_em: string
          detectado_em: string
          id: string
          ml_item_id: string
          motivo: string | null
          org_id: string
          resolvido_em: string | null
          status: string
          user_id: string
        }
        Insert: {
          alertado_em?: string | null
          atualizado_em?: string
          detectado_em?: string
          id?: string
          ml_item_id: string
          motivo?: string | null
          org_id: string
          resolvido_em?: string | null
          status: string
          user_id: string
        }
        Update: {
          alertado_em?: string | null
          atualizado_em?: string
          detectado_em?: string
          id?: string
          ml_item_id?: string
          motivo?: string | null
          org_id?: string
          resolvido_em?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_moderacao_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_perguntas: {
        Row: {
          atualizado_em: string
          comprador_id: number | null
          criada_em: string | null
          id: string
          item_id: string | null
          item_titulo: string | null
          org_id: string
          question_id: number
          raw: Json | null
          respondida_em: string | null
          resposta: string | null
          status: string
          texto: string
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          comprador_id?: number | null
          criada_em?: string | null
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          org_id: string
          question_id: number
          raw?: Json | null
          respondida_em?: string | null
          resposta?: string | null
          status: string
          texto?: string
          user_id: string
        }
        Update: {
          atualizado_em?: string
          comprador_id?: number | null
          criada_em?: string | null
          id?: string
          item_id?: string | null
          item_titulo?: string | null
          org_id?: string
          question_id?: number
          raw?: Json | null
          respondida_em?: string | null
          resposta?: string | null
          status?: string
          texto?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_perguntas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_vendas: {
        Row: {
          atualizado_em: string
          cidade: string | null
          comprador_id: number | null
          comprador_nick: string | null
          comprador_nome: string | null
          criado_em: string
          currency: string
          date_closed: string | null
          date_created: string | null
          estorno: number | null
          frete_vendedor: number | null
          id: string
          is_publiai: boolean
          liberacao_notificada_em: string | null
          liquido: number | null
          money_release_date: string | null
          order_id: number
          org_id: string
          pack_id: number | null
          paid_amount: number | null
          raw: Json | null
          sacado_em: string | null
          sacado_por: string | null
          sale_fee_total: number
          shipping_id: number | null
          shipping_logistic: string | null
          shipping_status: string | null
          shipping_substatus: string | null
          status: string
          status_detail: string | null
          tem_devolucao: boolean
          total_amount: number
          tracking_number: string | null
          uf: string | null
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          cidade?: string | null
          comprador_id?: number | null
          comprador_nick?: string | null
          comprador_nome?: string | null
          criado_em?: string
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
          liberacao_notificada_em?: string | null
          liquido?: number | null
          money_release_date?: string | null
          order_id: number
          org_id: string
          pack_id?: number | null
          paid_amount?: number | null
          raw?: Json | null
          sacado_em?: string | null
          sacado_por?: string | null
          sale_fee_total?: number
          shipping_id?: number | null
          shipping_logistic?: string | null
          shipping_status?: string | null
          shipping_substatus?: string | null
          status: string
          status_detail?: string | null
          tem_devolucao?: boolean
          total_amount?: number
          tracking_number?: string | null
          uf?: string | null
          user_id: string
        }
        Update: {
          atualizado_em?: string
          cidade?: string | null
          comprador_id?: number | null
          comprador_nick?: string | null
          comprador_nome?: string | null
          criado_em?: string
          currency?: string
          date_closed?: string | null
          date_created?: string | null
          estorno?: number | null
          frete_vendedor?: number | null
          id?: string
          is_publiai?: boolean
          liberacao_notificada_em?: string | null
          liquido?: number | null
          money_release_date?: string | null
          order_id?: number
          org_id?: string
          pack_id?: number | null
          paid_amount?: number | null
          raw?: Json | null
          sacado_em?: string | null
          sacado_por?: string | null
          sale_fee_total?: number
          shipping_id?: number | null
          shipping_logistic?: string | null
          shipping_status?: string | null
          shipping_substatus?: string | null
          status?: string
          status_detail?: string | null
          tem_devolucao?: boolean
          total_amount?: number
          tracking_number?: string | null
          uf?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_vendas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_vendas_sacado_por_fkey"
            columns: ["sacado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_vendas_itens: {
        Row: {
          codigo: string | null
          cor: string | null
          ean: string | null
          id: string
          is_publiai: boolean
          ml_item_id: string | null
          org_id: string
          quantity: number
          sale_fee: number
          titulo: string | null
          unit_price: number
          user_id: string
          variation_id: number | null
          venda_id: string
        }
        Insert: {
          codigo?: string | null
          cor?: string | null
          ean?: string | null
          id?: string
          is_publiai?: boolean
          ml_item_id?: string | null
          org_id: string
          quantity?: number
          sale_fee?: number
          titulo?: string | null
          unit_price?: number
          user_id: string
          variation_id?: number | null
          venda_id: string
        }
        Update: {
          codigo?: string | null
          cor?: string | null
          ean?: string | null
          id?: string
          is_publiai?: boolean
          ml_item_id?: string | null
          org_id?: string
          quantity?: number
          sale_fee?: number
          titulo?: string | null
          unit_price?: number
          user_id?: string
          variation_id?: number | null
          venda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_vendas_itens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_vendas_itens_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "ml_vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_webhook_eventos: {
        Row: {
          erro: string | null
          id: string
          org_id: string | null
          processado_em: string | null
          recebido_em: string
          resource: string
          topic: string
          user_id: string | null
        }
        Insert: {
          erro?: string | null
          id?: string
          org_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          resource: string
          topic: string
          user_id?: string | null
        }
        Update: {
          erro?: string | null
          id?: string
          org_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          resource?: string
          topic?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_webhook_eventos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          atualizado_em: string
          criado_em: string
          id: string
          lote_seq: number
          marca_padrao: string | null
          nome: string
          slug: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          lote_seq?: number
          marca_padrao?: string | null
          nome: string
          slug: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          lote_seq?: number
          marca_padrao?: string | null
          nome?: string
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          allowed_menus: string[]
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          is_super_admin: boolean
          nome: string
          org_id: string
          telegram_categorias: string[]
          telegram_chat_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_menus?: string[]
          created_at?: string
          email?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          is_super_admin?: boolean
          nome?: string
          org_id: string
          telegram_categorias?: string[]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_menus?: string[]
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          is_super_admin?: boolean
          nome?: string
          org_id?: string
          telegram_categorias?: string[]
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      variacoes: {
        Row: {
          altura_cm: number | null
          atualizado_em: string
          catalog_erro: string | null
          catalog_listing_id: string | null
          catalog_product_id: string | null
          catalog_status: string
          codigo: string
          comprimento_cm: number | null
          cor: string | null
          cor_editada_pelo_operador: boolean
          cor_hex: string | null
          cor_origem: Database["public"]["Enums"]["cor_origem"] | null
          criado_em: string
          custo: number | null
          estoque: number
          estoque_anterior: number | null
          excluida_da_publicacao: boolean
          familia_id: string
          gtin: string | null
          id: string
          imagem_path: string | null
          largura_cm: number | null
          ml_picture_id: string | null
          ml_variation_id: string | null
          nome: string | null
          org_id: string
          peso_gramas: number | null
          preco: number
          preco_editado_pelo_operador: boolean
          preco_publicacao: number | null
          user_id: string
        }
        Insert: {
          altura_cm?: number | null
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string
          codigo: string
          comprimento_cm?: number | null
          cor?: string | null
          cor_editada_pelo_operador?: boolean
          cor_hex?: string | null
          cor_origem?: Database["public"]["Enums"]["cor_origem"] | null
          criado_em?: string
          custo?: number | null
          estoque?: number
          estoque_anterior?: number | null
          excluida_da_publicacao?: boolean
          familia_id: string
          gtin?: string | null
          id?: string
          imagem_path?: string | null
          largura_cm?: number | null
          ml_picture_id?: string | null
          ml_variation_id?: string | null
          nome?: string | null
          org_id: string
          peso_gramas?: number | null
          preco: number
          preco_editado_pelo_operador?: boolean
          preco_publicacao?: number | null
          user_id: string
        }
        Update: {
          altura_cm?: number | null
          atualizado_em?: string
          catalog_erro?: string | null
          catalog_listing_id?: string | null
          catalog_product_id?: string | null
          catalog_status?: string
          codigo?: string
          comprimento_cm?: number | null
          cor?: string | null
          cor_editada_pelo_operador?: boolean
          cor_hex?: string | null
          cor_origem?: Database["public"]["Enums"]["cor_origem"] | null
          criado_em?: string
          custo?: number | null
          estoque?: number
          estoque_anterior?: number | null
          excluida_da_publicacao?: boolean
          familia_id?: string
          gtin?: string | null
          id?: string
          imagem_path?: string | null
          largura_cm?: number | null
          ml_picture_id?: string | null
          ml_variation_id?: string | null
          nome?: string | null
          org_id?: string
          peso_gramas?: number | null
          preco?: number
          preco_editado_pelo_operador?: boolean
          preco_publicacao?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variacoes_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variacoes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      contar_conversas_aguardando: { Args: never; Returns: number }
      current_org_id: { Args: never; Returns: string }
      delete_marketplace_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      delete_ml_credentials: { Args: { p_user_id: string }; Returns: undefined }
      desfazer_saque_ml_vendas: { Args: { p_ids: string[] }; Returns: number }
      get_connection_tokens: {
        Args: { p_connection_id: string }
        Returns: {
          access_token: string
          conta_externa_id: string
          expires_at: string
          refresh_token: string
        }[]
      }
      get_ml_tokens: {
        Args: { p_user_id: string }
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
        }[]
      }
      get_mp_token: { Args: { p_org_id: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      marcar_mensagens_lidas: { Args: { p_pack_id: string }; Returns: number }
      proximo_numero_lote: { Args: { p_org: string }; Returns: number }
      registrar_saque_ml_vendas: { Args: { p_ids: string[] }; Returns: number }
      telegram_config_status: {
        Args: never
        Returns: {
          ativo: boolean
          chat_id: string
          tem_token: boolean
        }[]
      }
      upsert_marketplace_connection: {
        Args: {
          p_access_token: string
          p_canal: Database["public"]["Enums"]["canal_externo"]
          p_conta_externa_id: string
          p_conta_label: string
          p_criado_por: string
          p_expires_at: string
          p_org_id: string
          p_refresh_token: string
          p_scope: string
        }
        Returns: string
      }
      upsert_ml_credentials: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_ml_nickname: string
          p_ml_user_id: string
          p_refresh_token: string
          p_scope: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      canal_externo: "mercado_livre"
      classe_concorrencia: "sem" | "moderada" | "alta"
      cor_origem: "descricao" | "vision" | "manual"
      estrategia_preco: "proprio" | "competitivo" | "manual"
      familia_status:
        | "pendente"
        | "processando"
        | "pronto"
        | "publicando"
        | "publicado"
        | "erro"
      lote_status:
        | "importando"
        | "processando"
        | "revisao"
        | "publicando"
        | "concluido"
        | "erro"
      operacao_ml: "CREATE" | "UPDATE"
      origem_concorrencia: "gtin" | "titulo" | "nenhuma"
      origem_produto: "nacional" | "importado"
      tipo_aviamento: "linha" | "botao" | "fita" | "outro" | "cola"
      tipo_origem: "regex" | "ia" | "manual" | "preditor" | "generico"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      canal_externo: ["mercado_livre"],
      classe_concorrencia: ["sem", "moderada", "alta"],
      cor_origem: ["descricao", "vision", "manual"],
      estrategia_preco: ["proprio", "competitivo", "manual"],
      familia_status: [
        "pendente",
        "processando",
        "pronto",
        "publicando",
        "publicado",
        "erro",
      ],
      lote_status: [
        "importando",
        "processando",
        "revisao",
        "publicando",
        "concluido",
        "erro",
      ],
      operacao_ml: ["CREATE", "UPDATE"],
      origem_concorrencia: ["gtin", "titulo", "nenhuma"],
      origem_produto: ["nacional", "importado"],
      tipo_aviamento: ["linha", "botao", "fita", "outro", "cola"],
      tipo_origem: ["regex", "ia", "manual", "preditor", "generico"],
    },
  },
} as const

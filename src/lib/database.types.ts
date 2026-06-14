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
          permalink: string | null
          preco_override: number | null
          publicado_em: string | null
          status: string
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
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          status?: string
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
          permalink?: string | null
          preco_override?: number | null
          publicado_em?: string | null
          status?: string
          user_id?: string
          variacoes_externas?: Json
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          atualizado_em: string
          criado_em: string
          desconto_pct: number
          user_id: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          desconto_pct?: number
          user_id: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          desconto_pct?: number
          user_id?: string
        }
        Relationships: []
      }
      familias: {
        Row: {
          analise_mercado: Json | null
          atributos_ml: Json
          atualizado_em: string
          capa_ml_picture_id: string | null
          capa_storage_path: string | null
          capa2_ml_picture_id: string | null
          capa2_storage_path: string | null
          capa3_ml_picture_id: string | null
          capa3_storage_path: string | null
          categoria_ml_id: string | null
          codigo_pai: string
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
          atributos_ml?: Json
          atualizado_em?: string
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          categoria_ml_id?: string | null
          codigo_pai: string
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
          atributos_ml?: Json
          atualizado_em?: string
          capa_ml_picture_id?: string | null
          capa_storage_path?: string | null
          capa2_ml_picture_id?: string | null
          capa2_storage_path?: string | null
          capa3_ml_picture_id?: string | null
          capa3_storage_path?: string | null
          categoria_ml_id?: string | null
          codigo_pai?: string
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
        ]
      }
      lotes: {
        Row: {
          anomalias_planilha: Json
          atualizado_em: string
          criado_em: string
          erro_mensagem: string | null
          id: string
          imagens_paths: string[]
          numero: number
          planilha_path: string | null
          status: Database["public"]["Enums"]["lote_status"]
          total_erros: number
          total_familias: number
          total_publicadas: number
          user_id: string
        }
        Insert: {
          anomalias_planilha?: Json
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id: string
        }
        Update: {
          anomalias_planilha?: Json
          atualizado_em?: string
          criado_em?: string
          erro_mensagem?: string | null
          id?: string
          imagens_paths?: string[]
          numero?: number
          planilha_path?: string | null
          status?: Database["public"]["Enums"]["lote_status"]
          total_erros?: number
          total_familias?: number
          total_publicadas?: number
          user_id?: string
        }
        Relationships: []
      }
      ml_credentials: {
        Row: {
          access_token_secret_id: string
          atualizado_em: string
          criado_em: string
          expires_at: string
          ml_nickname: string | null
          ml_user_id: string
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
          refresh_token_secret_id?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: []
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_ml_credentials: { Args: { p_user_id: string }; Returns: undefined }
      get_ml_tokens: {
        Args: { p_user_id: string }
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
        }[]
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
      tipo_aviamento: "linha" | "botao" | "fita" | "outro" | "cola"
      tipo_origem: "regex" | "ia" | "manual"
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
      tipo_aviamento: ["linha", "botao", "fita", "outro", "cola"],
      tipo_origem: ["regex", "ia", "manual"],
    },
  },
} as const

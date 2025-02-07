export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  ceitbapp: {
    Tables: {
      highlight: {
        Row: {
          click_url: string | null
          description: string | null
          id: string
          image_url: string
          position: number
          title: string | null
          ttl: string
        }
        Insert: {
          click_url?: string | null
          description?: string | null
          id?: string
          image_url: string
          position: number
          title?: string | null
          ttl: string
        }
        Update: {
          click_url?: string | null
          description?: string | null
          id?: string
          image_url?: string
          position?: number
          title?: string | null
          ttl?: string
        }
        Relationships: []
      }
      proposal: {
        Row: {
          author_id: string | null
          authorized: boolean
          created_at: string
          description: string | null
          files_url: string[] | null
          id: string
          status: Database["ceitbapp"]["Enums"]["proposal_status"]
          title: string
          topic: string | null
        }
        Insert: {
          author_id?: string | null
          authorized?: boolean
          created_at?: string
          description?: string | null
          files_url?: string[] | null
          id?: string
          status?: Database["ceitbapp"]["Enums"]["proposal_status"]
          title: string
          topic?: string | null
        }
        Update: {
          author_id?: string | null
          authorized?: boolean
          created_at?: string
          description?: string | null
          files_url?: string[] | null
          id?: string
          status?: Database["ceitbapp"]["Enums"]["proposal_status"]
          title?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      proposal_comment: {
        Row: {
          author_id: string
          comment: string
          created_at: string
          id: string
          proposal_id: string | null
        }
        Insert: {
          author_id: string
          comment: string
          created_at?: string
          id?: string
          proposal_id?: string | null
        }
        Update: {
          author_id?: string
          comment?: string
          created_at?: string
          id?: string
          proposal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_comment_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "proposal_comment_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_rejection: {
        Row: {
          created_at: string
          id: string
          mod_id: string
          proposal_id: string
          rejection_reason: string
        }
        Insert: {
          created_at?: string
          id?: string
          mod_id: string
          proposal_id: string
          rejection_reason: string
        }
        Update: {
          created_at?: string
          id?: string
          mod_id?: string
          proposal_id?: string
          rejection_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "rejection_mod_id_fkey"
            columns: ["mod_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rejection_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_reply: {
        Row: {
          author_id: string
          comment_id: string
          created_at: string
          id: string
          reply: string
        }
        Insert: {
          author_id: string
          comment_id: string
          created_at?: string
          id?: string
          reply: string
        }
        Update: {
          author_id?: string
          comment_id?: string
          created_at?: string
          id?: string
          reply?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_reply_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "proposal_reply_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "proposal_comment"
            referencedColumns: ["id"]
          },
        ]
      }
      study_group: {
        Row: {
          created_at: string
          description: string | null
          due_at: string | null
          group_link: string | null
          id: string
          locations: ("SDR" | "SDT" | "SDF" | "Online")[] | null
          owner: string | null
          subject_id: string | null
          title: string | null
          type: "TP/GRUPO" | "AHORA" | "GUÍAS" | "EXAMEN" | null
          user_ids: string[] | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          group_link?: string | null
          id?: string
          locations?: ("SDR" | "SDT" | "SDF" | "Online")[] | null
          owner?: string | null
          subject_id?: string | null
          title?: string | null
          type?: "TP/GRUPO" | "AHORA" | "GUÍAS" | "EXAMEN" | null
          user_ids?: string[] | null
        }
        Update: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          group_link?: string | null
          id?: string
          locations?: ("SDR" | "SDT" | "SDF" | "Online")[] | null
          owner?: string | null
          subject_id?: string | null
          title?: string | null
          type?: "TP/GRUPO" | "AHORA" | "GUÍAS" | "EXAMEN" | null
          user_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "study_group_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user: {
        Row: {
          discord: string | null
          events_notification: boolean
          instagram: string | null
          is_moderator: boolean | null
          linkedin: string | null
          polls_notification: boolean
          submissions_notifications: boolean
          user_id: string
        }
        Insert: {
          discord?: string | null
          events_notification?: boolean
          instagram?: string | null
          is_moderator?: boolean | null
          linkedin?: string | null
          polls_notification?: boolean
          submissions_notifications?: boolean
          user_id: string
        }
        Update: {
          discord?: string | null
          events_notification?: boolean
          instagram?: string | null
          is_moderator?: boolean | null
          linkedin?: string | null
          polls_notification?: boolean
          submissions_notifications?: boolean
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      proposal_status: "OPEN" | "DENIED" | "ACCEPTED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Proposal = {
  author_id: string | null;
  authorized: boolean;
  created_at: string;
  description: string | null;
  files_url: string[] | null;
  id: string;
  status: Database["ceitbapp"]["Enums"]["proposal_status"];
  title: string;
  topic: string | null;
};

export type ProposalComment = {
  author_id: string;
  comment: string;
  created_at: string;
  id: string;
  proposal_id: string | null;
};

export type ProposalRejection = {
  created_at: string;
  id: string;
  mod_id: string;
  proposal_id: string;
  rejection_reason: string;
};

export type ProposalReply = {
  author_id: string;
  comment_id: string;
  created_at: string;
  id: string;
  reply: string;
};

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

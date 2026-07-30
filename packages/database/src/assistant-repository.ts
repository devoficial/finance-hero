import { randomUUID } from "node:crypto";
import type { FinanceHeroDatabase } from "./encrypted-database";

export interface AssistantCitationRecord {
  id: string;
  title: string;
  publisher: string;
  sourceUrl: string | null;
  effectiveDate: string | null;
}

export interface AssistantToolTraceRecord {
  tool: string;
  label: string;
}

export interface AssistantMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: AssistantCitationRecord[];
  toolTrace: AssistantToolTraceRecord[];
  createdAt: string;
}

export interface AssistantConversationRecord {
  id: string;
  title: string;
  updatedAt: string;
  messages: AssistantMessageRecord[];
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  citationsJson: string;
  toolTraceJson: string;
  createdAt: string;
}

export interface KnowledgeRecord extends AssistantCitationRecord {
  content: string;
}

const DEFAULT_KNOWLEDGE: KnowledgeRecord[] = [
  {
    id: "knowledge-finance-hero-calculations",
    title: "Finance Hero calculation rules",
    publisher: "Finance Hero",
    sourceUrl: null,
    effectiveDate: "2026-07-30",
    content:
      "Cash balance is the latest bank-reconciled closing balance when available; otherwise it is calculated from carryover plus receipts minus tracked cash outflow. Regular expenses exclude debt payments and asset building. Net obligations equal active debt principal plus open personal payables minus open personal receivables. Forecasts are estimates, not guarantees.",
  },
  {
    id: "knowledge-finance-hero-safety",
    title: "Finance Hero assistant safety boundary",
    publisher: "Finance Hero",
    sourceUrl: null,
    effectiveDate: "2026-07-30",
    content:
      "The assistant is read-only. It may explain the encrypted local records but cannot post, edit, approve, clear, or delete financial data. Financial decisions should be verified against statements and official professional advice.",
  },
  {
    id: "knowledge-sebi-budgeting",
    title: "Financial goals and budgeting",
    publisher: "SEBI Investor",
    sourceUrl: "https://investor.sebi.gov.in/moneymatters-budandfinangoal.html",
    effectiveDate: null,
    content:
      "Budgeting documents income and expenses so spending, saving, debt repayment, and financial goals can be managed together. Financial goals should be specific, measurable, achievable, realistic, and time-bound.",
  },
  {
    id: "knowledge-sebi-investment-risk",
    title: "Factors to consider before investing",
    publisher: "SEBI Investor",
    sourceUrl: "https://investor.sebi.gov.in/investment-thingsbeforeinv.html",
    effectiveDate: null,
    content:
      "Investment choices should reflect the goal, time horizon, risk capacity, liquidity need, tax implications, and product knowledge. Returns are not guaranteed. Diversification and periodic rebalancing can reduce concentration risk but cannot eliminate market risk.",
  },
  {
    id: "knowledge-sebi-personal-finance",
    title: "Money matters: personal finance",
    publisher: "SEBI Investor",
    sourceUrl: "https://investor.sebi.gov.in/moneymatters.html",
    effectiveDate: null,
    content:
      "Personal finance planning covers saving, needs and wants, income and expense management, inflation, compounding, goals, budgeting, borrowing, insurance, retirement, and estate planning. Saving means setting aside part of income for future goals.",
  },
];

const SEARCH_STOP_WORDS = new Set([
  "about",
  "could",
  "current",
  "explain",
  "from",
  "have",
  "month",
  "please",
  "should",
  "this",
  "three",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

export class AssistantRepository {
  constructor(private readonly database: FinanceHeroDatabase) {
    this.seedKnowledge();
  }

  createConversation(firstMessage: string): string {
    const id = `assistant-conversation-${randomUUID()}`;
    const now = new Date().toISOString();
    const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 72);
    this.database.connection
      .prepare(`
        INSERT INTO assistant_conversations (id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(id, title || "Finance question", now, now);
    return id;
  }

  conversationExists(id: string): boolean {
    return Boolean(this.database.connection.prepare("SELECT 1 FROM assistant_conversations WHERE id = ?").get(id));
  }

  addMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    citations: AssistantCitationRecord[] = [],
    toolTrace: AssistantToolTraceRecord[] = [],
  ): AssistantMessageRecord {
    const message: AssistantMessageRecord = {
      id: `assistant-message-${randomUUID()}`,
      role,
      content,
      citations,
      toolTrace,
      createdAt: new Date().toISOString(),
    };
    const insert = this.database.connection.transaction(() => {
      this.database.connection
        .prepare(`
          INSERT INTO assistant_messages
            (id, conversation_id, role, content, citations_json, tool_trace_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          message.id,
          conversationId,
          message.role,
          message.content,
          JSON.stringify(message.citations),
          JSON.stringify(message.toolTrace),
          message.createdAt,
        );
      this.database.connection
        .prepare("UPDATE assistant_conversations SET updated_at = ? WHERE id = ?")
        .run(message.createdAt, conversationId);
    });
    insert.immediate();
    return message;
  }

  getConversation(id: string): AssistantConversationRecord | null {
    const conversation = this.database.connection
      .prepare("SELECT id, title, updated_at AS updatedAt FROM assistant_conversations WHERE id = ?")
      .get(id) as Omit<AssistantConversationRecord, "messages"> | undefined;
    if (!conversation) return null;
    const rows = this.database.connection
      .prepare(`
        SELECT id, role, content, citations_json AS citationsJson,
               tool_trace_json AS toolTraceJson, created_at AS createdAt
        FROM assistant_messages
        WHERE conversation_id = ?
        ORDER BY created_at, id
      `)
      .all(id) as MessageRow[];
    return {
      ...conversation,
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        citations: JSON.parse(row.citationsJson) as AssistantCitationRecord[],
        toolTrace: JSON.parse(row.toolTraceJson) as AssistantToolTraceRecord[],
        createdAt: row.createdAt,
      })),
    };
  }

  searchKnowledge(query: string, limit = 3): KnowledgeRecord[] {
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])]
      .filter((term) => !SEARCH_STOP_WORDS.has(term))
      .slice(0, 8);
    const rows = this.database.connection
      .prepare(`
        SELECT id, title, publisher, source_url AS sourceUrl,
               effective_date AS effectiveDate, content
        FROM assistant_knowledge
      `)
      .all() as KnowledgeRecord[];
    return rows
      .map((row) => ({
        row,
        score: terms.reduce((score, term) => {
          const haystack = `${row.title} ${row.content}`.toLowerCase();
          return score + (haystack.includes(term) ? 1 : 0);
        }, 0),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row }) => row);
  }

  private seedKnowledge(): void {
    const now = new Date().toISOString();
    const insert = this.database.connection.prepare(`
      INSERT INTO assistant_knowledge
        (id, title, publisher, source_url, effective_date, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        publisher = excluded.publisher,
        source_url = excluded.source_url,
        effective_date = excluded.effective_date,
        content = excluded.content,
        updated_at = excluded.updated_at
    `);
    const transaction = this.database.connection.transaction(() => {
      for (const document of DEFAULT_KNOWLEDGE) {
        insert.run(
          document.id,
          document.title,
          document.publisher,
          document.sourceUrl,
          document.effectiveDate,
          document.content,
          now,
          now,
        );
      }
    });
    transaction.immediate();
  }
}

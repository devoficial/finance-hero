import { z } from "zod";
import { monthSchema } from "./finance";

export const assistantPageContextSchema = z.object({
  page: z.enum(["home", "accounts", "expenses", "imports", "liabilities", "goals", "forecasts", "projects"]),
  month: monthSchema,
});

export const assistantChatRequestSchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(2_000),
  pageContext: assistantPageContextSchema,
});

export const assistantCitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  sourceUrl: z.string().url().nullable(),
  effectiveDate: z.string().nullable(),
});

export const assistantToolTraceSchema = z.object({
  tool: z.string(),
  label: z.string(),
});

export const assistantMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z.array(assistantCitationSchema),
  toolTrace: z.array(assistantToolTraceSchema),
  createdAt: z.string().datetime(),
});

export const assistantChatResponseSchema = z.object({
  conversationId: z.string(),
  message: assistantMessageSchema,
  model: z.string(),
  localOnly: z.literal(true),
});

export const assistantConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string().datetime(),
  messages: z.array(assistantMessageSchema),
});

export const assistantStatusResponseSchema = z.object({
  available: z.boolean(),
  model: z.string(),
  localOnly: z.literal(true),
  readOnly: z.literal(true),
  message: z.string(),
});

export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;
export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;
export type AssistantCitation = z.infer<typeof assistantCitationSchema>;
export type AssistantToolTrace = z.infer<typeof assistantToolTraceSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;
export type AssistantStatusResponse = z.infer<typeof assistantStatusResponseSchema>;

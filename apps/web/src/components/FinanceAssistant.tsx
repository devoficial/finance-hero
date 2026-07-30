import type { AssistantMessage, AssistantPageContext, AssistantStatusResponse } from "@finance-hero/contracts";
import { useEffect, useRef, useState } from "react";
import { askAssistant, getAssistantConversation } from "../lib/api";

interface FinanceAssistantProps {
  context: AssistantPageContext;
  status?: AssistantStatusResponse;
}

const CONVERSATION_KEY = "finance-hero-assistant-conversation";
const STARTERS = [
  "Can I safely increase my debt payment this month?",
  "Explain this month's cash position.",
  "Which liability is my snowball target?",
];

export function FinanceAssistant({ context, status }: FinanceAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(() => {
    return window.localStorage.getItem(CONVERSATION_KEY) ?? undefined;
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !conversationId || messages.length > 0) return;
    const controller = new AbortController();
    getAssistantConversation(conversationId, controller.signal)
      .then((conversation) => setMessages(conversation.messages))
      .catch(() => {
        window.localStorage.removeItem(CONVERSATION_KEY);
        setConversationId(undefined);
      });
    return () => controller.abort();
  }, [conversationId, messages.length, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || !status?.available) return;
    const optimistic: AssistantMessage = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: message,
      citations: [],
      toolTrace: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setSending(true);
    try {
      const response = await askAssistant({ conversationId, message, pageContext: context });
      window.localStorage.setItem(CONVERSATION_KEY, response.conversationId);
      setConversationId(response.conversationId);
      setMessages((current) => [...current, response.message]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local assistant could not answer.");
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    window.localStorage.removeItem(CONVERSATION_KEY);
    setConversationId(undefined);
    setMessages([]);
    setError(null);
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Open local finance assistant"
        className={`assistant-launcher ${open ? "is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>FH</span>
        Ask Finance Hero
      </button>
      {open && (
        <section aria-label="Local finance assistant" className="assistant-panel">
          <header className="assistant-header">
            <div>
              <p>LOCAL / READ-ONLY</p>
              <h2>Finance desk</h2>
            </div>
            <div className="assistant-header-actions">
              <button onClick={newConversation} type="button">
                New
              </button>
              <button aria-label="Close assistant" onClick={() => setOpen(false)} type="button">
                Close
              </button>
            </div>
          </header>

          <div className={`assistant-status ${status?.available ? "ready" : ""}`}>
            <span />
            <strong>{status?.available ? status.model : "Local model offline"}</strong>
            <small>{status?.message ?? "Checking Ollama..."}</small>
          </div>

          <div className="assistant-messages">
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>I can explain your local accounts, expenses, liabilities, goals and forecasts.</p>
                <div>
                  {STARTERS.map((starter) => (
                    <button disabled={!status?.available} key={starter} onClick={() => send(starter)} type="button">
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article className={`assistant-message ${message.role}`} key={message.id}>
                <span>{message.role === "assistant" ? "FINANCE HERO" : "YOU"}</span>
                <p>{message.content}</p>
                {message.toolTrace.length > 0 && (
                  <details>
                    <summary>{message.toolTrace.length} local data checks</summary>
                    {message.toolTrace.map((trace) => (
                      <small key={`${message.id}-${trace.tool}`}>{trace.label}</small>
                    ))}
                  </details>
                )}
                {message.citations.length > 0 && (
                  <div className="assistant-citations">
                    {message.citations.map((citation) =>
                      citation.sourceUrl ? (
                        <a href={citation.sourceUrl} key={citation.id} rel="noreferrer" target="_blank">
                          {citation.publisher}: {citation.title}
                        </a>
                      ) : (
                        <small key={citation.id}>
                          {citation.publisher}: {citation.title}
                        </small>
                      ),
                    )}
                  </div>
                )}
              </article>
            ))}
            {sending && <div className="assistant-thinking">Reasoning over encrypted local records...</div>}
            {error && <div className="assistant-error">{error}</div>}
            <div ref={endRef} />
          </div>

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              aria-label="Ask a finance question"
              disabled={!status?.available || sending}
              maxLength={2_000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              placeholder={
                status?.available ? "Ask about this page or your finances..." : "Start the local model first"
              }
              rows={2}
              value={draft}
            />
            <button disabled={!draft.trim() || !status?.available || sending} type="submit">
              Ask
            </button>
          </form>
          <footer>Private on this Mac. No cloud fallback. Answers never modify your records.</footer>
        </section>
      )}
    </>
  );
}

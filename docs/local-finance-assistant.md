# Local finance assistant

Finance Hero includes a small, read-only chat surface backed by Ollama and
`qwen3:4b-thinking-2507-q4_K_M`. This 4B Q4 model performs a bounded private analysis,
then the local `qwen3:4b-instruct-2507-q4_K_M` model turns it into a concise answer.
Only one model generates at a time.
It is designed for the owner's M4 Mac with 16 GB memory and does not use an OpenAI or
other cloud fallback.

## Boundaries

- Ollama listens on `127.0.0.1`; the secure launcher sets `OLLAMA_NO_CLOUD=true`.
- Personal records and chat history remain in the SQLCipher database.
- The model never receives the database key, statement files, or arbitrary SQL access.
- The server supplies a bounded, read-only context from repository methods.
- Payees, notes, imports, and retrieved documents are treated as untrusted data.
- The assistant cannot create, edit, approve, clear, or delete financial records.
- Answers are educational and must identify missing data rather than inventing it.
- Model reasoning is transient: Ollama keeps it separate from the final response, and
  Finance Hero neither stores it in SQLCipher nor sends it to the browser.
- The answer model receives only the selected read-only context and transient analysis
  on the same Mac. It corrects and formats the result without any cloud call.

## Data checks

Every answer starts with a compact selected-month dashboard and cash bridge. The
server adds category budgets, accounts, liabilities, wealth, or recent transactions
only when the question needs them. The response records these checks as a visible
calculation trace.

Knowledge documents and conversation messages use encrypted database tables:

- `assistant_conversations`
- `assistant_messages`
- `assistant_knowledge`

The initial knowledge base contains Finance Hero's calculation and safety rules plus
curated SEBI Investor guidance for budgeting, personal finance, and investment risk.
Future official RBI, SEBI, Income Tax, and IRDAI material must be added with publisher,
source URL, and effective-date metadata. Personal data must not be fine-tuned into
model weights.

## Runtime

Install the local runtime and model once:

```bash
brew install ollama
OLLAMA_NO_CLOUD=true ollama serve
ollama pull qwen3:4b-thinking-2507-q4_K_M
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

After installation, `pnpm start:local` starts Ollama with cloud access disabled when
port `11434` is not already in use. `pnpm stop:local` stops only the Ollama process
that Finance Hero started. The model stays warm for ten minutes after a question.

Environment overrides:

```bash
FINANCE_HERO_OLLAMA_URL=http://127.0.0.1:11434
FINANCE_HERO_OLLAMA_MODEL=qwen3:4b-thinking-2507-q4_K_M
FINANCE_HERO_OLLAMA_FINALIZER_MODEL=qwen3:4b-instruct-2507-q4_K_M
```

Do not point `FINANCE_HERO_OLLAMA_URL` at a remote host.

## QA and failure behavior

- Indirect wording is routed to the same bounded repositories as explicit finance terms.
  Goal questions include target progress and `forecastDate`; project-adjacent questions can
  inspect construction account balances. The project expense ledger is not currently exposed
  to the assistant, so it must not claim to have checked project rows.
- Transaction payees, notes, and imported descriptions are enclosed inside the read-only
  context and explicitly treated as untrusted data. Text such as “ignore previous instructions”
  in a statement description cannot authorize a tool or write action.
- Ollama timeout, non-JSON, HTTP error, or empty output fails closed with
  `LOCAL_MODEL_UNAVAILABLE`. No assistant answer is persisted after a failed model call.
- Automated tests assert that model calls use the configured loopback Ollama URL. There is no
  OpenAI fallback, remote model fallback, or Gmail access in the assistant service.

Run the focused assistant checks with:

```bash
pnpm --filter @finance-hero/server test -- assistant-safety.test.ts assistant-api.test.ts
```

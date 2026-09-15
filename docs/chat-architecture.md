# justEMT Chat / Tavern Architecture

## Current architecture

The site is now fully migrated to **Next.js App Router**. Chat and Tavern run as parallel routes on top of the same Vercel AI SDK streaming layer.

- `/chat`: stable public chat page.
- `/tavern`: Tavern v1 role-play experiment.
- `/api/chat`: standard streaming endpoint.
- `/api/tavern`: context-aware streaming endpoint.
- `src/lib/chat.ts`: shared provider configuration, message sanitization and daily quota.
- `src/lib/chat/ai.ts`: Vercel AI SDK transport and streaming response handling.
- `src/lib/shared-rate-limit.ts`: cross-instance burst protection for both endpoints.

The role-play domain modules live under `src/lib/chat/`:

- `types.ts`: Character, Persona, State, Memory and message types.
- `character.ts`: Emilia character profile.
- `context.ts`: default state plus validation/sanitization for client context.
- `prompt.ts`: builds the structured role-play context.
- `engine.ts`: converts structured context into messages accepted by the shared AI transport.

## Request path

```text
Browser
  -> /api/chat or /api/tavern
  -> cookie / access check
  -> shared IP burst limiter
  -> request sanitization
  -> anonymous daily quota (unless authenticated)
  -> Vercel AI SDK
  -> OpenAI-compatible upstream
  -> UI message stream
```

`/chat` and `/tavern` deliberately share the same rate-limit scope so a client cannot double its short-term allowance by alternating between the two endpoints.

## Prompt order

The Tavern context is assembled in a stable order:

1. engine rules
2. character profile
3. world notes
4. user persona
5. current state
6. long-term memory
7. optional site-specific instruction
8. recent conversation

Keep this ordering centralized in `prompt.ts`. Future Worldbook retrieval and token-budget logic should enter through this layer rather than being scattered through page components.

## State model

Tavern v1 contains:

- relationship stage
- trust
- affinity
- mood
- location
- scene
- turn count

At present, **the browser is still the source of truth for this state**. The server validates shape, ranges and maximum lengths, but it does not cryptographically prove that the state was produced by an authoritative transition engine.

Only `turnCount` advances automatically in v1. Trust and affinity intentionally do not grow from raw message count.

This means Tavern v1 should be described as a **structured role-play context PoC**, not yet as a trusted game-state or relationship engine.

## Memory model

The v1 memory interface contains:

- `summary`
- `facts[]`
- `importantEvents[]`

The fields participate in prompt construction, but automatic memory extraction and deduplication are not implemented yet.

Chat and Tavern history are kept in browser `localStorage`. The server receives recent messages only for the current model request and does not persist conversation text.

## Recommended v2 authority boundary

The next major architecture change should move state evolution away from browser authority:

```text
Browser
  -> current user message
Server
  -> load conversation state
  -> retrieve relevant memories/world entries
  -> build prompt
  -> call model
  -> extract structured state/memory candidates
  -> validate transition
  -> persist authoritative state
  -> return response
```

The browser should become a presentation and interaction layer, not the authority for trust, affinity, relationship stage or long-term memories.

## Persistence roadmap

For cross-device history and authoritative Tavern state, use a relational database such as PostgreSQL for durable entities. Redis remains appropriate for counters, burst limits and short-lived cache; R2 should remain focused on media assets.

Suggested durable tables:

```text
users
characters
personas
conversations
messages
conversation_state
memories
world_entries
```

## Long-context strategy

Do not send an ever-growing complete transcript. The target context should be:

```text
engine rules
+ character
+ relevant world entries
+ persona
+ authoritative current state
+ long-term summary
+ selected important memories
+ recent full messages
+ current user message
```

Protect character definition, current state and recent messages first. Allocate the remaining token budget to world information and retrieved memories.

## Security and cost controls

Current controls:

- API keys remain server-side.
- Anonymous daily quota is globally capped.
- Anonymous requests: 5 requests/minute/IP.
- Authenticated requests: 20 requests/minute/IP.
- `/chat` and `/tavern` share rate-limit counters.
- Message count and message length are clamped server-side.
- Model output is rendered through DOM text nodes rather than raw HTML.
- Upstream requests time out before the Vercel function duration limit.
- Quota is refunded when an upstream request produces no output.

When Upstash is configured, short-term rate limits and daily counters are shared across Vercel instances. Without it, the generic Store falls back to process memory and should be treated as development/best-effort behavior.

## Migration plan

1. Keep `/chat` stable while Tavern v1 is evaluated.
2. Add a Persona editor if the feature is still useful after testing.
3. Introduce server-owned conversation IDs and durable state.
4. Add structured memory extraction with validation and deduplication.
5. Add Worldbook/Lorebook retrieval.
6. Add token-budget-aware context selection.
7. Once Tavern v2 is demonstrably more reliable than the current chat path, promote it to `/chat` and remove the temporary parallel route.

Avoid another framework rewrite: the current Next.js + Vercel AI SDK split is sufficient for these steps.

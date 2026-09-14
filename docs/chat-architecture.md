# justEMT Tavern v1

## Architecture

The refactor keeps the existing Astro site and introduces a parallel role-play engine.

- `/chat`: current stable chat page.
- `/tavern`: Tavern v1 test page.
- `/api/chat`: current streaming model endpoint.
- `/api/tavern`: context adapter used by Tavern v1.

The new domain modules live under `src/lib/chat/`:

- `types.ts`: Character, Persona, State, Memory and message types.
- `character.ts`: Emilia character profile.
- `context.ts`: default state plus validation/sanitization for client context.
- `prompt.ts`: builds the role-play context in a stable order.
- `engine.ts`: compatibility adapter around the existing streaming client.

## Prompt order

The role-play context is assembled as:

1. engine rules
2. character profile
3. world notes
4. user persona
5. current state
6. long-term memory
7. optional site-specific instruction

Keep this order centralized in `prompt.ts`. Future Worldbook, retrieval and token-budget logic should be added there rather than scattered through page code.

## State

The v1 state model contains:

- relationship stage
- trust
- affinity
- mood
- location
- scene
- turn count

Only `turnCount` is advanced automatically in v1. Trust and affinity should not grow mechanically from message count; a later version should update them from meaningful events.

## Memory

The v1 memory model contains:

- `summary`
- `facts[]`
- `importantEvents[]`

The interface is active, but automatic memory extraction is intentionally deferred. A later version can periodically produce structured memory candidates, deduplicate them and persist only reliable items.

## Persistence roadmap

v1 keeps history and context in browser storage so the existing privacy behavior is preserved.

For cross-device conversations, use PostgreSQL for users, conversations, messages, personas, state and memories. Redis remains appropriate for counters, short-lived state and cache. Object storage should remain focused on media assets.

Suggested tables:

```text
users
characters
personas
conversations
messages
conversation_state
memories
```

## Long-context strategy

Do not send the entire conversation forever. The target context should eventually be:

```text
engine rules
+ character
+ relevant world entries
+ persona
+ current state
+ long-term summary
+ relevant important memories
+ recent full messages
+ current user message
```

Protect character, state and recent messages first; allocate the remaining context budget to world information and memories.

## Migration plan

1. Test `/tavern` online without changing `/chat`.
2. Move structured context support directly into the main chat endpoint.
3. Add a Persona editor.
4. Add structured summary and memory extraction.
5. Add PostgreSQL persistence for cross-device history.
6. Add Worldbook/Lorebook retrieval.
7. Promote Tavern Engine to `/chat` and remove the temporary compatibility layer.

The model transport can later be replaced by Vercel AI SDK without changing the Character, State, Memory or Prompt Builder modules.

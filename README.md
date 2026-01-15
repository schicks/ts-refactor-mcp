# TypeScript-Aware File Moves for AI Agents

## Problem

When AI coding agents move TypeScript files, imports break. The agent either:

1. **Naively moves the file** → broken imports everywhere → agent spends tokens fixing them one by one → often misses some → user left with broken build
2. **Tries to manually update imports** → slow, error-prone, misses re-exports and barrel files → still broken

Meanwhile, VS Code handles this perfectly. When you drag a file in the explorer, TypeScript's language server computes every import that needs updating and applies them atomically. But this capability is locked inside the editor — there's no way for an external agent to access it.

**This is the gap**: AI agents have filesystem access but no semantic understanding of TypeScript projects. The tooling exists, it's just not exposed.

---

## Appetite

**Small batch: 2 weeks**

This is a focused integration project, not a research problem. The underlying capability (`tsserver`'s `getEditsForFileRename`) already exists and is battle-tested. We're building a bridge, not inventing new technology.

---

## Solution

Build an MCP server that wraps a persistent `tsserver` instance and exposes file-move refactoring as tools that any MCP-compatible agent (Claude, Cursor, etc.) can call.

### Core Tools

**`moveFile`**
```
Input:  { projectRoot, oldPath, newPath, dryRun?: false }
Output: { applied: true, filesModified: 12, moved: { from, to } }
```

Moves the file and applies all import updates atomically. One tool call, zero broken imports, zero wasted tokens.

With `dryRun: true`, returns the edit plan without applying — useful if the agent wants to preview or confirm.

**`moveDirectory`**
```
Input:  { projectRoot, oldDir, newDir, dryRun?: false }
Output: { applied: true, filesModified: 47, filesMoved: 8 }
```

Same thing, but for entire directories. Handles all files recursively.

**`warmup`**
```
Input:  { projectRoot }
Output: { status: 'ready', filesIndexed: 1847 }
```

Pre-loads the project so subsequent operations are fast. Agent can call this at session start.

### Key Design Decisions

**Persistent tsserver process**

We keep `tsserver` running between requests. First request pays the startup cost (5-30s for large projects). Subsequent requests: 100ms-2s.

Without persistence, every file move would require a full project reload. That's the mistake existing solutions make.

**Use the project's own TypeScript**

We spawn `tsserver` from `node_modules/typescript`, not a global install. This ensures the refactoring logic matches the project's TypeScript version exactly.

**Atomic operations with dry-run escape hatch**

By default, the server applies all edits and moves the file in one call. This saves tokens and eliminates the chance of partial failures. For agents that want to preview changes first, `dryRun: true` returns the edit plan without applying.

**Automatic tsserver sync**

After applying edits, we notify `tsserver` that files changed. The project stays in sync without the agent needing to manage it.

**Exposed timing and status**

Every response includes how long the operation took. A `getStatus` tool lets agents check if the project is still loading. No black boxes.

---

## Rabbit Holes

### ❌ Don't build a full LSP bridge

It's tempting to expose all of `tsserver`'s capabilities — completions, diagnostics, go-to-definition. Resist this. Those features are already available through the editor. We're solving one specific problem: file moves that update imports.

If we scope-creep into "LSP for agents," we'll spend the whole cycle on protocol translation and never ship.

### ❌ Don't try to sync state bidirectionally

When the agent moves files outside our server, we can't perfectly track it. That's fine. We provide a `notifyFileMoved` hint, but we don't guarantee consistency. If things get out of sync, the agent can call `warmup` again.

Trying to build a perfect sync mechanism is a rabbit hole. `tsserver` already handles file watching internally — let it do its job.

### ❌ Don't support non-TypeScript projects

JavaScript-only projects without `tsconfig.json` have different (worse) inference behavior. We'd spend half the cycle on edge cases. Punt this to a future cycle.

---

## No-Gos

- **No partial application** — Either all edits succeed or none do; no half-broken states
- **No project creation** — We require an existing `tsconfig.json`
- **No monorepo magic** — One tsserver per tsconfig; agent handles coordination
- **No caching across restarts** — MCP server restart = cold start (acceptable)

---

## Fat Marker Sketch

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent                                │
│                          │                                  │
│    "Move src/auth/       │                                  │
│     login.ts to          │                                  │
│     src/features/auth/"  │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │   MCP Server          │                      │
│              │   (ts-refactor)       │                      │
│              │                       │                      │
│              │   moveFile()          │                      │
│              └───────────┬───────────┘                      │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │   tsserver            │                      │
│              │   (persistent)        │                      │
│              │                       │                      │
│              │   getEditsFor         │                      │
│              │   FileRename()        │                      │
│              └───────────┬───────────┘                      │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │   MCP Server applies: │                      │
│              │                       │                      │
│              │   1. Update 12 files  │                      │
│              │   2. Move login.ts    │                      │
│              │   3. Sync tsserver    │                      │
│              └───────────┬───────────┘                      │
│                          │                                  │
│                          ▼                                  │
│              { applied: true, filesModified: 12 }           │
│              ✓ One tool call, zero broken imports           │
└─────────────────────────────────────────────────────────────┘
```

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| tsserver startup too slow for UX | Medium | `warmup` tool + document expected latency |
| Large projects timeout | Low | Return partial results + timing info |
| tsserver crashes/hangs | Low | Process supervision + restart on failure |
| Edit application corrupts files | Low | Atomic writes + validate edits before applying |
| Agent wants to preview first | Low | `dryRun: true` flag returns plan without applying |

---

## Success Criteria

1. **Agent can move a file in a 1000+ file TypeScript project with zero broken imports**
2. **Second move in same session completes in <2 seconds**
3. **Works with Cursor, Claude Code, and any MCP-compatible client**

---

## Out of Scope (Future Cycles)

- Symbol renaming (rename a function across files)
- Extract to file (move a function to a new file)
- Auto-fix broken imports (after manual moves)
- JavaScript-only project support
- Multi-root workspaces

These are all valuable, but each is its own pitch. Ship the core, learn from usage, then expand.

---

## Work in Progress

### Scope 1: tsserver Client

**The job:** A TypeScript class that manages a tsserver process and exposes a clean async API.

**Interface:**
```typescript
class TsServerClient {
  constructor(projectRoot: string)
  async start(): Promise<void>
  async getEditsForFileRename(oldPath: string, newPath: string): Promise<FileEdit[]>
  async notifyFileChanged(path: string): Promise<void>
  dispose(): void
}
```

**Done when:** Unit tests pass against a real tsserver with a small fixture project. No MCP, no file writing — just the protocol layer.

---

### Scope 2: Edit Applier

**The job:** A module that takes a list of edits from tsserver and applies them to the filesystem atomically.

**Interface:**
```typescript
interface FileEdit {
  filePath: string
  textEdits: { start: Position, end: Position, newText: string }[]
}

async function applyEdits(edits: FileEdit[]): Promise<void>
async function moveFile(oldPath: string, newPath: string): Promise<void>
```

**Done when:** Unit tests pass — given a temp directory with files, applies edits correctly, handles edge cases (nested directories, file doesn't exist yet, etc.)

**Key decisions:**
- Apply edits in reverse order within a file (so positions don't shift)
- Create parent directories for newPath if needed
- All-or-nothing: validate all edits are applicable before writing any

---

### Scope 3: MCP Shell

**The job:** The MCP server definition — tool schemas, argument parsing, response formatting, npm package setup.

**Interface:**
```typescript
// Tools:
moveFile({ projectRoot, oldPath, newPath, dryRun? })
  -> { applied, filesModified, moved } | { edits, wouldMove }
```

**Done when:** MCP server starts, tool is registered, callable from MCP inspector with mock responses. Doesn't need real tsserver yet — can stub the internals.

---

### Integration Points

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Scope 1         │     │  Scope 2         │     │  Scope 3         │
│  tsserver Client │     │  Edit Applier    │     │  MCP Shell       │
│                  │     │                  │     │                  │
│  getEditsFor     │     │  applyEdits()    │     │  moveFile tool   │
│  FileRename()    │     │  moveFile()      │     │                  │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  Integration     │
                         │                  │
                         │  MCP tool calls  │
                         │  tsserver, gets  │
                         │  edits, applies  │
                         │  them            │
                         └──────────────────┘
```

Each scope has **no dependencies on the others** during development:

- Scope 1 tests against real tsserver with fixture files
- Scope 2 tests against a temp directory with pre-written files
- Scope 3 tests against mocked responses

Integration is wiring them together — a few hours once all three are green.

---

### Schedule

| Day 1-2 | Day 3-4 | Day 5 |
|---------|---------|-------|
| Scope 1: Spawn tsserver, parse responses | Scope 1: `getEditsForFileRename` working | Integration |
| Scope 2: `applyEdits` basics | Scope 2: Edge cases, atomicity | Integration |
| Scope 3: MCP boilerplate, tool schema | Scope 3: npm packaging, config examples | Ship |

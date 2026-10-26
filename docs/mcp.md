# CADCraft and AI agents (MCP)

CADCraft speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, and it
serves **one tool**: `run`, which executes **AutoLISP inside the open drawing**. Everything else —
drawing, reading back, measuring, rendering — is reached from that code as a function call, and the
model keeps the helpers it writes. The same one tool drives the in-app assistant
([assistant.md](assistant.md)); a capability is a command the code calls, so nothing here needs
glue when a command lands.

## Start it

```sh
# Headless: an in-process drawing session, no window.
cadcraft-cli mcp

# Bridged to the running app (watch the agent draw):
cadcraft --control 7979 &
cadcraft-cli mcp --connect 127.0.0.1:7979
```

An MCP client usually starts its servers when it starts, often before the app is open. With
`--lazy` the bridge starts anyway and reaches the app at the first tool call; until the app answers,
each call fails with a message saying how to open it. `--launch` also opens CADCraft (macOS) with
that control port at a call that finds nothing, and waits for it:

```json
{ "mcpServers": { "cadcraft": { "command": "cadcraft-cli", "args": ["mcp", "--connect", "127.0.0.1:7979", "--launch"] } } }
```

`--connect` needs the app's `HOST:PORT`. Without one (or with an unknown argument) `cadcraft-cli mcp`
exits with an error instead of falling back to a headless session, so a client meant for the app
never edits a separate drawing by mistake. If the app can't be reached, startup fails too.

Example client configuration (Claude Code / Claude Desktop):

```json
{ "mcpServers": { "cadcraft": { "command": "cadcraft-cli", "args": ["mcp"] } } }
```

## The tool

| Tool | What it does |
|---|---|
| `run {code, values?}` | Runs AutoLISP in the open drawing and returns what it printed, what it was worth, the definitions it kept, and the pictures it drew (as image blocks). Empty `code` returns the manual. |

```json
{"name": "run", "arguments": {"code": "(cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))"}}
```

The vocabulary the code speaks — `(commands)`, `(cmd "id" params)`, `(cmdline "line" …)`,
`(inspect)`, `(describe)`, `(render)`, `(value "name")`, `(kept)`, `(forget "name")`, `(man)` — is
in [assistant.md](assistant.md#the-namespace). A `defun` (or a `setq` of a literal) is kept in the
definitions directory and reloaded next session, so an agent builds its own tooling:

```lisp
(defun plate (w h r)                     ; once
  (cmd "rectang" (list (cons 'P1 (list 0 0)) (cons 'P2 (list w h))))
  (cmd "circle" (list (cons 'CENTER (list (/ w 2) (/ h 2))) (cons 'RADIUS r))))
(plate 100 60 8)                         ; every session after
```

A run is one undo step; `(cmd "undo")` takes back everything the run did. Every change the code
makes is an ordinary command, so it is exactly what a person could have typed.

## Arguments

Arguments are checked against the tool's schema. An unknown tool, `arguments` that aren't an object,
or a `code` that isn't a string is a JSON-RPC error `-32602` (invalid params) — the call never
reaches the drawing. A run that fails (a bad point, an unknown command, a LISP error) is a result
with `isError: true` and the message, which the model reads and corrects. A server whose application
is not answering says so the same way, in words a model can act on.

## A typical session

1. `run {}` — the manual: the namespace, and what the application offers.
2. `run {"code": "(commands "rect")"}` — find the command and its parameters.
3. `run {"code": "(cmdline "rectang" "0,0" "100,60")"}` — draw it, typed like a person.
4. `run {"code": "(cmd "entities" '((TYPE . \"Circle\")))"}` — verify what is really there.
5. `run {"code": "(render 1200 800)"}` — look at it; the picture comes back as an image block.

Turning a picture into geometry — a photo or scan of a part, resized in one call. A Windows path
goes in as a named value, because a LISP string would eat its backslashes:

```json
{"name": "run", "arguments": {"code": "(cmd \"imagetrace\" (list (cons 'PATH (value \"p\")) (cons 'WIDTH 60.0)))", "values": {"p": "C:\\work\\wing.png"}}}
```

then `(cmd "describe")` to read back the contours, their lengths and the areas they enclose.

## Security

**Running code is what this server does**, with the authority of the process it runs in — there is
no enable/disable flag and no code-free mode. Run CADCraft sandboxed (a container, a VM, a jail)
when the model driving it is not trusted with the user's files.
## Notes

- The tool set does not branch on anything: the same one tool with a window, without one, headless
  or bridged to the app.
- The drawing is read from code (`(cmd "describe")`, `(cmd "entities" …)`), not from MCP resources;
  there is no second, parallel interface.
- The command catalog is a function of the namespace (`(commands)`, `(describe "id")`), so a model
  discovers it by asking, the same way it discovers anything else.
- `cadcraft-cli info`, `convert`, `run`, `commands` and `sample` are unaffected: the CLI drives the
  engine directly, and `run` (the command) is available from it like any other.

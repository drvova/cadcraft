# The assistant: one tool, and the model builds its own

CADCraft gives a model **one tool**: `run`, which executes **AutoLISP inside the open drawing**.
Everything else — drawing, reading back, measuring, rendering, exporting — is reached from code,
as a function call in that namespace. There is no catalog of typed verbs to choose from, and no
glue to write when a command lands.

That is the whole design. A fixed menu of tools is the wrong interface for CAD: every install and
every command set differs, models differ in what they handle well, and each new capability would
need a hand-wired entry. Instead the model discovers what is there, writes helpers, and keeps
them.

## Open it

- **Window ▸ Assistant** (⌘7 / Ctrl+7), or the pane's own close button to hide it again.
- Type `assistant` at the command line, or run it with parameters:

```json
{"id": 1, "method": "engine.execute", "params": {"command": "assistant", "params": {"ask": "trace this wing picture and scale it to 30 mm"}}}
```

| `assistant {…}` | does |
|---|---|
| `{}` | show the pane |
| `{"ask": "…"}` | show the pane and ask the model |
| `{"attach": "path.png"}` | attach a picture to the ask (`attach` takes one path or a list; with no `ask`, the model is told to look at it) |
| `{"stop": true}` | stop the turn running now |
| `{"clear": true}` | forget the conversation |
| `{"open": false}` | do the above without opening the pane |

## The pane

The pane is laid out like an agent panel, not a chat: a header naming the conversation with the
new-conversation and settings buttons, the transcript as plain text on the panel surface (a prompt
in a quiet inset block, the model's words without a bubble), and each tool call collapsed to one
dim line — what ran, and the first line of what came back — that opens on a click to show the code
and the whole result. A picture the code rendered stands inline as an artifact card: the render
itself, with its size and path under it. The composer is a bordered box at the bottom with the
model on the left, how full the context is, and Send on the right (⌘/Ctrl+Enter sends).

**While a turn runs** the composer keeps taking input: Enter (or Queue) holds the message until the
turn ends and sends it next; ⌘/Ctrl+Enter (or Send now) delivers it to the model at its next tool
call, so a correction lands without cutting the work off mid-action. Queued messages are listed
above the box and can be dropped before they go.

**Checkpoints.** The pane records the drawing's undo depth before each request. Hover a request of
your own and a restore control appears: it reverts the drawing to the state before that request —
the conversation stays, so you can keep talking about what happened. (Cursor's rule for its own
checkpoints; the undo history is the same one ⌘Z walks.)

**Pictures.** Attach one with the paperclip, paste it into the pane (⌘/Ctrl+V), or drop it on the
window while the pane is open. The model sees the picture *and* its path, so it can measure it:
`(cmd "imagetrace" '((PATH . "…") (WIDTH . 30)))` turns it into editable polylines at that size and
`(cmd "imageattach" …)` places it as a reference. A photograph of a part becomes geometry you can
dimension — that is the point of attaching it.

## Set the provider

The assistant speaks the **OpenAI chat protocol**, which is what OpenAI, OpenRouter, Anthropic's
compatibility endpoint, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio, vLLM and
llama.cpp all serve. A provider is three things: a base URL, a model name and a key.

Set it in the pane's settings (the gear in the header) or in the Options JSON form:

```json
{"id": 1, "method": "engine.execute", "params": {"command": "options", "params": {
  "assistantBaseUrl": "http://127.0.0.1:11434/v1",
  "assistantModel": "qwen3-coder",
  "assistantApiKey": "",
  "assistantMaxTokens": 8192
}}}
```

`options {}` reports `assistantPreset`, `assistantBaseUrl`, `assistantModel`, `assistantMaxTokens`
and `assistantKeySet` (never the key itself). The pane's presets are convenience, not a limit: type
any OpenAI-compatible base URL. A local server usually wants no key at all.

The provider is saved with the machine's CADCraft profile (the same place the interface
preferences live), so it survives restarts. The key is stored in that profile in clear text — it is
your machine's profile, and a key that cannot be read cannot be used, but do not paste a key you
would not leave in a local file.

## In the browser

The SolidJS interface (`apps/ui`) carries the same assistant: **Window ▸ Assistant** (Ctrl+7)
opens the composer over the drawing — Cursor's measured recipe (`.design-system/cursor/recipes.md`
§1: the 5px box with a 6px padding and gap, the border that turns active on focus, the ghost model
chip, the `0 0 4px 1px` shadow, the ripple while a turn runs), the same one the desktop pane
follows. It speaks the same OpenAI chat protocol with the same one tool — `run`, AutoLISP in the
open drawing — so a model that works in the desktop works here, and the model's code reaches the
same engine through the wasm facade (`execute("run", …)`).

What the browser changes:

- **The provider lives in the browser** (`localStorage`), set from the composer's model button;
  the preset list is the desktop's. The key is in the browser's storage in clear text — treat it
  as you would a key in a local file. A local server (Ollama, LM Studio) needs no key, and it must
  allow the page's origin (`OLLAMA_ORIGINS` for Ollama).
- **There is no filesystem.** A definition a run writes with `(defun …)` is kept for the session —
  live in the drawing's namespace, reported as kept — but not reloaded next time, and `(render)`
  answers that the browser has nowhere to write a PNG. Everything else behaves as on the desktop:
  `(cmd …)`, `(commands)`, `(describe "id")`, `(inspect)`, measurements.
- Attachments (paperclip, paste, drop) are not in the browser composer yet.

## The namespace

The same vocabulary is seeded into every drawing's AutoLISP environment, so a person, a script, an
MCP client and the pane all drive the application through exactly the same functions.

| function | does |
|---|---|
| `(commands [filter])` | every command: id, label, aliases, parameters, whether it can run |
| `(cmd "id" params)` | run any command with parameters — the same call a script makes |
| `(cmdline "line" …)` | type lines at the command line like a person, in order |
| `(inspect)` | the drawing's summary (counts, extents, layers, blocks, selection, undo) |
| `(describe)` | the application and the open drawing in one call |
| `(describe "id")` | one command: label, aliases, parameters, example |
| `(describe x)` | a function's parameters, a list's keys, a value's type |
| `(render [path] [w h [x0 y0 x1 y1]])` | draw the drawing to a PNG and show it to the model |
| `(value "name")`, `(values)` | the named strings passed beside the code |
| `(kept)`, `(forget "name")` | the definitions kept across restarts |
| `(man)` | the manual |

```lisp
(cmd "line" '((POINTS . ((0 0) (10 0)))))          ; draw
(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))
(cmdline "rectang" "0,0" "100,60")                  ; …or type at the command line
(cmd "entities" '((TYPE . "Circle") (LIMIT . 10)))  ; read back
(cmd "describe")                                    ; the measured report
(cmd "techsheet")                                   ; stones, carats, metal weight
(cmd "imagetrace" '((PATH . "wing.png") (WIDTH . 60)))
(render 1200 800)                                   ; look at it
```

`T` is true and `nil` is false in parameters; a parameter left out keeps the command's own default.
A command's real parameter names are in `(commands)` and `(describe "id")` — never guess one.

## Kept definitions: the model builds its own tooling

A `defun` (or a `setq` of a literal) is **saved** after the run that wrote it, one file per name in
the definitions directory (`%APPDATA%\CADCraft\definitions`, `~/.config/cadcraft/definitions`, or
`CADCRAFT_DEFINITIONS` when set). At the start of a drawing's session they are loaded back, so a
helper written today is there tomorrow — in this process and in the next one:

```lisp
(defun wing-width () (cdr (assoc 'WIDTH (cmd "entities" '((TYPE . "Polyline"))))))
```

`(kept)` lists them; `(forget "name")` deletes one. A definition that cannot be loaded is reported
and skipped, so a broken file can never stop a session from starting. A definition may not replace
a built-in (`(defun CAR …)`): the language is put back and the run says `refused:`.

Only definitions are kept — never the work. A restart rebuilds the model's tools without replaying
anything that touched the drawing.

## What a run reports

`run` returns the last value of the code, the lines it printed, the definitions it kept, the
pictures it drew, and the error if it failed. The model reads that as **text**, not JSON:

```
drew 3 outlines
=> ((HANDLE . "10A") (HANDLE . "10B") (HANDLE . "10C"))
kept: WING-OUTLINE
rendered C:\Users\you\AppData\Local\Temp\cadcraft-render-4821-0.png
```

Pictures come back as image content blocks in MCP and as artifact cards the pane draws inline in the
transcript: the render itself, with its size and path under it.
The brief tells the model to quote the numbers the tools returned and to name anything that came
out different from what was asked: a drawing report is a report of measurements.

## The same tool over MCP

`cadcraft-cli mcp` serves the identical tool — one entry in `tools/list`, the same schema — on a
headless session or bridged to the running app:

```json
{"mcpServers": {"cadcraft": {"command": "cadcraft-cli", "args": ["mcp", "--connect", "127.0.0.1:7979", "--launch"]}}}
```

There are no resources and no second tool set: the drawing is read from code like everything else.

## Security is a deployment fact, not a toggle

**Running code is what this tool does.** It executes with the authority of the process it runs in,
on the user's own drawings — which is the point: the model works in the drawing in front of you,
and every change is an ordinary undoable command.

There is deliberately **no enable/disable flag and no code-free mode**. A flag would reframe the
interface as an optional feature layered on something else, which it is not. If the model driving
CADCraft is not trusted with the user's files, run CADCraft sandboxed — a container, a VM, a jail —
and that is the boundary.

## Why it is built this way

- **One surface, one door.** A tool call is `engine.execute` of the `run` command, which runs the
  same AutoLISP a person can type at the command line. A capability is a command, and a command
  added to the engine is reachable the same day — with no glue in the assistant, MCP or the pane.
- **Discovery is in-language.** `(commands)`, `(describe "id")` and `(man)` are functions the code
  calls, so a model explores the application the way it explores anything else: by asking.
- **The interface thread owns the drawing.** The pane's worker never touches the session; tool
  calls arrive as control requests and run between frames, exactly like a script's.
- **Adaptation is emergent.** Each deployment's model accretes its own helpers in its own
  definitions directory. There is no per-model tool set anywhere in the code.

## Where the code lives

| | |
|---|---|
| `crates/ai/src/code.rs` | the one tool: schema, argument checking, and the report a model reads |
| `crates/ai/src/surface.rs` | the catalog — one entry — and the `Harness` a call goes through |
| `crates/ai/src/agent.rs` | the turn loop, and the brief that teaches the namespace |
| `crates/ai/src/client.rs` | the transport: one `/chat/completions` endpoint, streamed |
| `crates/engine/src/lisp/agent.rs` | the namespace: the functions, the manual, kept definitions |
| `crates/engine/src/cmd/code.rs` | the `run` command (load, run, keep, report) |
| `crates/engine/src/paths.rs` | the config directory and the definitions directory |
| `crates/ui-egui/src/assistant.rs` | the pane and the bridge to the interface thread |
| `crates/mcp/src/tools.rs` | the same tool, wrapped in MCP's protocol |

The tests are worth reading. `crates/mcp/src/tests.rs` drives the whole drafting workflow —
a plate with holes, entity queries, texts, the report, a traced picture — **through `run` and
nothing else**, which is what proves a capability is not lost by not being a tool.
`crates/ai/src/tests.rs` runs whole turns against a real HTTP server on localhost that answers
like a provider. `.scratch/mcp_live.py` (a scratch harness, not shipped) drives three real MCP
server processes in turn to prove a definition kept in one is usable in the next.

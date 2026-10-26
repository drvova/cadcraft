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
| `{"stop": true}` | stop the turn running now |
| `{"clear": true}` | forget the conversation |
| `{"open": false}` | do the above without opening the pane |

## Set the provider

The assistant speaks the **OpenAI chat protocol**, which is what OpenAI, OpenRouter, Anthropic's
compatibility endpoint, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio, vLLM and
llama.cpp all serve. A provider is three things: a base URL, a model name and a key.

Set it in the pane's own settings (the fold at the top) or in the Options JSON form:

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

**The browser build has no assistant yet.** The pane needs a worker thread and a socket; the web
build says so instead of pretending.

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

Pictures come back as image content blocks in MCP and as paths the pane shows in the transcript.
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

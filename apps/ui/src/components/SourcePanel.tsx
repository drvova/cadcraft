/**
 * The Source panel: the drawing as a script beside the drawing (`../source.ts` holds the rules).
 *
 * The text is the engine's own writing of the drawing (`facade.scriptSource`), read again whenever
 * the drawing changes while the panel is open. The reader edits it in place and applies it
 * (Ctrl/Cmd+Enter in the editor, or the Apply key): the shell runs it (`onApply`, which rebuilds
 * the drawing and refreshes every surface as after any command) and the panel says what the
 * engine said. Edits are never replaced by a refresh; Revert drops them.
 *
 * The editor is the registry's `TextArea` (`variant="bare"`, the panel's body is its card and
 * shows the focus). Its height is given in rows, as the component asks: the rows the panel's body
 * can hold, measured, as both its floor and its cap, so the text scrolls inside it. Lines do not
 * wrap, so the numbers beside it stay one to a line; the gutter follows the editor's scroll.
 *
 * A script too long for the editor (`fitsEditor`) is shown in part and read-only; what is shown
 * is never what is applied or copied.
 *
 * The panel stays mounted while closed (it renders nothing), so edits outlive closing it.
 */

import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import type { ScriptReport, SourceReply } from "../facade";
import {
  applied,
  counted,
  countLines,
  edited,
  EMPTY_SOURCE,
  fitsEditor,
  gutterText,
  isEdited,
  lineSpan,
  MAX_GUTTER_LINES,
  previewOf,
  read,
  reverted,
  statusOf,
  unreadable,
  type SourceState,
} from "../source";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import { TextArea } from "../ui/TextArea";
import "../source.css";

export interface SourcePanelProps {
  /** Whether the panel shows. Closed, it keeps its text and reads nothing. */
  open: boolean;
  /** Changes whenever the drawing may have changed (its revision, its name, its count). */
  stamp: string;
  /** The drawing's script, read now. */
  readSource: () => SourceReply;
  /** Rebuild the drawing from `text` and refresh the window; what the engine said. */
  onApply: (text: string) => ScriptReport;
  onClose: () => void;
  /** The Apply chord as this platform writes it ("Ctrl+Enter"). */
  applyShortcut: string;
}

/** The fewest rows the editor shows, however short the panel. */
const MIN_ROWS = 3;

/** A length the platform computed, as a number; 0 when it has none. */
const px = (value: string): number => Number.parseFloat(value) || 0;

export function SourcePanel(props: SourcePanelProps): JSX.Element {
  const [state, setState] = createSignal<SourceState>(EMPTY_SOURCE);
  const [copied, setCopied] = createSignal(false);
  let area: HTMLTextAreaElement | undefined;

  /** Read the drawing's script into the state: the text follows it unless it holds edits. */
  const sync = (): void => {
    const reply = props.readSource();
    setState((s) => (reply.ok ? read(s, reply.text) : unreadable(s, reply.error)));
  };

  // The drawing changed, or the panel came back: read it. Closed, nothing is read.
  createEffect(
    on(
      () => [props.open, props.stamp] as const,
      ([open]) => {
        if (open) untrack(sync);
      },
    ),
  );

  const dirty = createMemo(() => isEdited(state()));
  const editable = createMemo(() => fitsEditor(state().base) || dirty());
  const status = createMemo(() => statusOf(state()));
  const failedLine = createMemo(() => {
    const o = state().outcome;
    return o.kind === "failed" ? o.line : null;
  });

  /** Put the caret on the line the error names and bring it into view. */
  const showLine = (line: number | null): void => {
    if (area === undefined || line === null) return;
    const span = lineSpan(area.value, line);
    if (span === null) return;
    const leading = px(getComputedStyle(area).lineHeight);
    area.setSelectionRange(span.start, span.end);
    if (leading > 0) area.scrollTop = Math.max(0, (line - 3) * leading);
  };

  const apply = (): void => {
    const s = state();
    if (!isEdited(s)) return;
    const report = props.onApply(s.draft);
    const reply = props.readSource();
    const next = applied(s, report, reply.ok ? reply.text : null);
    setState(next);
    if (next.outcome.kind === "failed") showLine(next.outcome.line);
  };

  const revert = (): void => {
    const reply = props.readSource();
    setState((s) => (reply.ok ? reverted(reply.text) : unreadable(s, reply.error)));
  };

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  /** The whole text in the editor (or the whole script, when only its start is shown). */
  const copy = (): void => {
    const s = state();
    const done = navigator.clipboard?.writeText(editable() ? s.draft : s.base);
    if (done === undefined) return;
    void done.then(
      () => {
        setCopied(true);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };

  const onEditorKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
      event.preventDefault();
      apply();
    }
  };

  const lines = createMemo(() => countLines(state().draft, MAX_GUTTER_LINES + 1));
  const lineCount = createMemo(() => Math.min(lines().lines, MAX_GUTTER_LINES));
  const preview = createMemo(() => (editable() ? null : previewOf(state().base)));
  const measure = createMemo(() => {
    const p = preview();
    if (p !== null) return `first ${counted(p.shownLines, "line")} of ${p.more ? "more than " : ""}${p.totalLines.toLocaleString("en-US")}`;
    const n = lines();
    return n.capped ? `more than ${counted(MAX_GUTTER_LINES, "line")}` : counted(n.lines, "line");
  });

  return (
    <Show when={props.open}>
      <aside class="source-panel" role="complementary" aria-label="Source">
        <div class="source-head">
          <SectionLabel>Source</SectionLabel>
          <Show when={dirty()}>
            <Chip tone="accent" title="The drawing does not have these changes yet">
              Edited
            </Chip>
          </Show>
          <span class="source-measure">{measure()}</span>
          <div class="source-head-actions">
            <IconButton icon="copy" title={copied() ? "Copied" : "Copy the script"} onClick={copy} />
            <IconButton icon="close" title="Close the source" onClick={() => props.onClose()} />
          </div>
        </div>
        <Show
          when={preview()}
          keyed
          fallback={
            <Editor
              text={state().draft}
              lines={lineCount()}
              failedLine={failedLine()}
              invalid={state().outcome.kind === "failed"}
              onInput={(text) => setState((s) => edited(s, text))}
              onKeyDown={onEditorKey}
              onArea={(el) => {
                area = el;
              }}
            />
          }
        >
          {(p) => (
            <div class="source-body">
              <div class="source-editor source-editor--preview" tabindex="0" role="group" aria-label="The start of the drawing's script">
                <pre class="source-gutter-lines" aria-hidden="true">
                  {gutterText(p.shownLines)}
                </pre>
                <pre class="source-text">{p.text}</pre>
              </div>
              <p class="source-note">
                This script is too long to edit here: only its start is shown. Copy takes all of it.
              </p>
            </div>
          )}
        </Show>
        <div class="source-foot">
          <p class={`source-status source-status--${status().tone}`} id="source-status" role="status">
            {status().text}
          </p>
          <div class="source-foot-actions">
            <Button variant="quiet" size="sm" disabled={!dirty()} title={dirty() ? "Drop the edits and show the drawing's script" : "Nothing is edited"} onClick={revert}>
              Revert
            </Button>
            <Button variant="primary" size="sm" disabled={!dirty()} shortcut={props.applyShortcut} title={dirty() ? "Rebuild the drawing from this text" : "Edit the text first"} onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </aside>
    </Show>
  );
}

interface EditorProps {
  text: string;
  lines: number;
  failedLine: number | null;
  invalid: boolean;
  onInput: (text: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onArea: (el: HTMLTextAreaElement) => void;
}

/** The editor: line numbers, and the text area at the rows the body can hold. */
function Editor(props: EditorProps): JSX.Element {
  const [rows, setRows] = createSignal(MIN_ROWS);
  let body: HTMLDivElement | undefined;
  let gutter: HTMLDivElement | undefined;
  let area: HTMLTextAreaElement | undefined;

  /** The rows that fit the body: its height less its padding, over the editor's line, less one
   *  line kept for the horizontal scrollbar a long line brings. */
  const fitRows = (): void => {
    if (body === undefined || area === undefined) return;
    const box = getComputedStyle(body);
    const style = getComputedStyle(area);
    const leading = px(style.lineHeight) || px(style.fontSize) * 1.2;
    if (leading <= 0) return;
    const room = body.clientHeight - px(box.paddingTop) - px(box.paddingBottom);
    const fit = Math.floor(room / leading) - 1;
    setRows(Number.isFinite(fit) ? Math.max(MIN_ROWS, Math.min(400, fit)) : MIN_ROWS);
  };

  onMount(() => {
    fitRows();
    void document.fonts?.ready.then(fitRows);
    if (body === undefined || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitRows);
    observer.observe(body);
    onCleanup(() => observer.disconnect());
  });

  /** The line an error names, when the gutter draws its number. */
  const marked = createMemo(() => (props.failedLine !== null && props.failedLine <= Math.min(props.lines, MAX_GUTTER_LINES) ? props.failedLine : null));

  const follow = (): void => {
    if (gutter !== undefined && area !== undefined) gutter.scrollTop = area.scrollTop;
  };
  // The numbers change with the text: keep them level with it after either is redrawn.
  createEffect(() => {
    void props.lines;
    void rows();
    follow();
  });

  return (
    <div class="source-body" ref={body}>
      <div class={props.invalid ? "source-editor is-invalid" : "source-editor"}>
        <div class="source-gutter" aria-hidden="true" style={{ "--source-digits": String(Math.max(3, String(props.lines).length)) }}>
          <div class="source-gutter-scroll" ref={gutter}>
            <div class="source-gutter-inner">
              <pre class="source-gutter-lines">{gutterText(props.lines)}</pre>
              <Show when={marked()} keyed>
                {(line) => (
                  <span class="source-mark" style={{ "--source-line": String(line) }}>
                    {line}
                  </span>
                )}
              </Show>
            </div>
          </div>
        </div>
        <TextArea
          variant="bare"
          rows={rows()}
          maxRows={rows()}
          value={props.text}
          ariaLabel="The drawing's script"
          describedBy="source-status"
          invalid={props.invalid}
          spellcheck={false}
          autocomplete="off"
          onInput={props.onInput}
          onKeyDown={props.onKeyDown}
          ref={(el) => {
            area = el;
            // A script's line is one line: no wrapping, so the numbers stay one to a line.
            el.wrap = "off";
            el.addEventListener("scroll", follow, { passive: true });
            props.onArea(el);
          }}
        />
      </div>
    </div>
  );
}

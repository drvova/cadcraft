/**
 * Boot: build the facade (real wasm when `crates/wasm` is built, the mock otherwise), then mount
 * the app. The chosen mode is shown in the top bar and is what the screenshot reports.
 */

import { render } from "solid-js/web";
import { App } from "./app";
import { createFacade } from "./facade";
import "./tokens.css";
import "./ui/ui.css";
import "./styles.css";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("index.html is missing #app");
}

const facade = await createFacade();
render(() => <App facade={facade} />, root);

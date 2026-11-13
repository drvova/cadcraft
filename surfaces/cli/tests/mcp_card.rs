//! The piece card through the MCP server: an agent asks for it inside `run` and gets the picture
//! as an image block, beside the figures it shows. This is the server the command-line tool of
//! this workspace serves (`cadcraft-cli mcp`), with the renderer installed as its `main` does.

use cadcraft_mcp::{Headless, Server};
use serde_json::{Value, json};

fn call(s: &mut Server, id: u64, method: &str, params: Value) -> Value {
    s.handle(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).unwrap_or(Value::Null)
}

fn run_raw(s: &mut Server, code: &str) -> Value {
    call(s, 99, "tools/call", json!({"name": "run", "arguments": {"code": code}}))
}

fn run(s: &mut Server, code: &str) -> String {
    let r = run_raw(s, code);
    let c = &r["result"]["content"][0];
    assert_ne!(r["result"]["isError"], json!(true), "{code} failed: {c}");
    c["text"].as_str().unwrap_or_default().to_string()
}

#[test]
fn the_piece_card_comes_back_as_a_picture_with_its_data() {
    cadcraft_surface::install();
    let mut s = Server::new(Box::new(Headless::default()));
    call(
        &mut s,
        1,
        "initialize",
        json!({"protocolVersion": cadcraft_mcp::PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}),
    );
    run(&mut s, r#"(cmd "new" '((METRIC . T)))"#);
    run(&mut s, r#"(cmd "piece" '((KIND . "solitaire") (HALO . T)))"#);

    let r = run_raw(&mut s, "(card)");
    if cadcraft_surface::png_font().is_none() {
        // The card is a PNG and no font is shipped: on a machine with none the model reads why.
        assert_eq!(r["result"]["isError"], json!(true), "{r}");
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("needs a font"), "{r}");
        return;
    }
    assert_ne!(r["result"]["isError"], json!(true), "{}", r["result"]["content"][0]);
    let content = r["result"]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2, "the report and the card");
    // The picture: an MCP image content block, base64 PNG.
    let image = &content[1];
    assert_eq!(image["type"], "image");
    assert_eq!(image["mimeType"], "image/png");
    let data = image["data"].as_str().unwrap();
    assert!(data.starts_with("iVBORw0KGgo"), "a PNG's signature in base64");
    assert!(data.len() > 13_000, "{} characters", data.len());
    // The data: what the engine's commands replied, in the value of the run.
    let text = content[0]["text"].as_str().unwrap();
    assert!(text.contains("(WIDTH . 1280)") && text.contains("(COUNT . 20)") && text.contains("(GRAMS . 3.53)"), "{text}");
    assert!(text.contains("(ID . \"wall\")") && text.contains("(OK . T)"), "{text}");
    assert!(r.to_string().len() < 2_000_000, "one reply line: {} bytes", r.to_string().len());

    // No piece: still a card, saying so. A bad argument: an error the model reads.
    run(&mut s, r#"(cmd "piece" '((REMOVE . T)))"#);
    let r = run_raw(&mut s, "(card 400 \"light\")");
    assert_eq!(r["result"]["content"][1]["type"], "image", "{r}");
    let r = run_raw(&mut s, "(card 400 \"sepia\")");
    assert_eq!(r["result"]["isError"], json!(true));
    assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("unknown theme"), "{r}");
}

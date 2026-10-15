use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

fn execute(script: &str, handle: impl Fn(&Value) -> Value) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_apexo-workflow-script"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    writeln!(
        input,
        "{}",
        json!({"version":1,"script":script,"args":{"query":"evidence"}})
    )
    .unwrap();
    let mut messages = Vec::new();
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let message: Value = serde_json::from_str(&line.unwrap()).unwrap();
        if message["type"] == "call" {
            writeln!(input, "{}", handle(&message)).unwrap();
        }
        messages.push(message);
    }
    let status = child.wait().unwrap();
    assert!(status.success(), "{messages:?}");
    messages
}

#[test]
fn actual_rhai_functions_conditionals_and_parallel_use_host_calls() {
    let messages = execute(
        r#"
        let meta = #{name: "research", description: "native interpreter test"};
        fn query(s) { s + "?" }
        phase("Research");
        let answer = agent(query(args.query), #{capability_mode: "read-only"});
        if answer.success {
            let panel = parallel([#{prompt: "verify a"}, #{prompt: "verify b"}]);
            complete(#{answer: answer.output, reviewers: panel.len()});
        }
        throw "unreachable";
    "#,
        |message| {
            json!({"id":message["id"], "value": match message["kind"].as_str().unwrap() {
                "phase" => Value::Null,
                "agent" => { assert_eq!(message["payload"]["prompt"], "evidence?"); json!({"success":true,"output":"inspected"}) },
                "parallel" => { assert_eq!(message["payload"].as_array().unwrap().len(),2); json!([{},{}]) },
                other => panic!("unexpected {other}"),
            }})
        },
    );
    assert_eq!(
        messages.last().unwrap(),
        &json!({"type":"complete","value":{"answer":"inspected","reviewers":2}})
    );
}
#[test]
fn pause_is_terminal_even_inside_a_script_catch() {
    let messages = execute(
        r#"try { pause("verification", "Need evidence"); } catch(e) { complete("bypassed"); }"#,
        |_| panic!("no host call expected"),
    );
    assert_eq!(messages.last().unwrap()["type"], "paused");
    assert_eq!(messages.last().unwrap()["message"], "Need evidence");
}
#[test]
fn script_cannot_import_filesystem_modules() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_apexo-workflow-script"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"version":1,"script":"import \"/etc/passwd\" as secret; complete(secret);"})
    )
    .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let message: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(message["type"], "error");
    assert!(!child.wait().unwrap().success());
}

#[test]
fn complete_without_value_is_terminal_null() {
    let messages = execute(
        r#"try { complete(); } catch(e) { complete("bypassed"); }"#,
        |_| panic!("no host call expected"),
    );
    assert_eq!(
        messages.last().unwrap(),
        &json!({"type":"complete","value":null})
    );
}

#[test]
fn await_user_returns_only_after_host_receipt_and_normalizes_kind() {
    let messages = execute(
        r#"await_user("blocked", "Review evidence"); complete("continued");"#,
        |message| {
            assert_eq!(message["kind"], "await_user");
            assert_eq!(
                message["payload"],
                json!({"kind":"verification","message":"Review evidence"})
            );
            json!({"id":message["id"],"value":null})
        },
    );
    assert_eq!(messages.len(), 2);
    assert_eq!(messages.last().unwrap()["value"], "continued");
}

//! Apexo-owned language adapter. Core owns all workflow state and host operations.
use rhai::{Array, Dynamic, Engine, EvalAltResult, Map, Position, Scope};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc,
};

type ScriptResult = Result<Dynamic, Box<EvalAltResult>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    script: String,
    #[serde(default)]
    args: Value,
    #[serde(default)]
    validate: bool,
}
fn output(value: Value) {
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}
fn failure(message: impl Into<String>) -> Box<EvalAltResult> {
    Box::new(EvalAltResult::ErrorRuntime(
        message.into().into(),
        Position::NONE,
    ))
}
#[derive(Clone)]
struct Host {
    sequence: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
    replies: Arc<Mutex<mpsc::Receiver<Value>>>,
}
impl Host {
    fn call(&self, kind: &str, payload: Value) -> ScriptResult {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(failure("Workflow cancelled"));
        }
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        if id >= 10_000 {
            return Err(failure("Workflow host-call limit exceeded"));
        }
        output(json!({"type":"call","id":id,"kind":kind,"payload":payload}));
        let reply = self
            .replies
            .lock()
            .unwrap()
            .recv()
            .map_err(|_| failure("Host disconnected"))?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err(failure("Workflow cancelled"));
        }
        if reply["id"].as_u64() != Some(id) {
            return Err(failure("Host reply sequence mismatch"));
        }
        if let Some(error) = reply.get("error") {
            return Err(failure(error.as_str().unwrap_or("Host operation failed")));
        }
        rhai::serde::to_dynamic(&reply["value"]).map_err(|error| failure(error.to_string()))
    }
}
fn main() {
    if let Err(error) = execute() {
        output(json!({"type":"error","message":error}));
        std::process::exit(1);
    }
}
fn execute() -> Result<(), String> {
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let request: Request = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    if request.version != 1 || request.script.len() > 512_000 {
        return Err("Unsupported version or oversized script".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::channel();
    let input_cancel = cancelled.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(reply) = serde_json::from_str::<Value>(&line) else {
                break;
            };
            if reply["type"] == "cancel" {
                input_cancel.store(true, Ordering::Release);
            }
            if sender.send(reply).is_err() {
                return;
            }
        }
        input_cancel.store(true, Ordering::Release);
    });
    let host = Host {
        sequence: Arc::new(AtomicU64::new(0)),
        cancelled: cancelled.clone(),
        replies: Arc::new(Mutex::new(receiver)),
    };
    let mut engine = Engine::new();
    engine.set_max_operations(1_000_000);
    engine.set_max_expr_depths(128, 64);
    engine.set_max_array_size(10_000);
    engine.set_max_map_size(1_000);
    engine.set_max_string_size(1_000_000);
    engine.set_module_resolver(rhai::module_resolvers::DummyModuleResolver::new());
    engine.disable_symbol("eval");
    engine.on_progress(move |_| {
        cancelled
            .load(Ordering::Acquire)
            .then(|| Dynamic::from("Workflow cancelled"))
    });
    let single = host.clone();
    engine.register_fn("agent", move |prompt: String| {
        single.call("agent", json!({"prompt":prompt}))
    });
    let agent = host.clone();
    engine.register_fn(
        "agent",
        move |prompt: String, options: Map| -> ScriptResult {
            let mut value: Value = rhai::serde::from_dynamic(&options.into())
                .map_err(|error| failure(error.to_string()))?;
            value["prompt"] = json!(prompt);
            agent.call("agent", value)
        },
    );
    let parallel = host.clone();
    engine.register_fn("parallel", move |tasks: Array| -> ScriptResult {
        let tasks: Value =
            rhai::serde::from_dynamic(&tasks.into()).map_err(|error| failure(error.to_string()))?;
        parallel.call("parallel", tasks)
    });
    for name in ["phase", "log", "read_scratch_file", "git_diff_since"] {
        let text = host.clone();
        engine.register_fn(name, move |value: String| {
            text.call(name, json!({"value":value}))
        });
    }
    let scratch = host.clone();
    engine.register_fn(
        "write_scratch_file",
        move |name: String, content: String| {
            scratch.call("write_scratch_file", json!({"name":name,"content":content}))
        },
    );
    let template = host.clone();
    engine.register_fn(
        "render_template",
        move |name: String, vars: Map| -> ScriptResult {
            let vars: Value = rhai::serde::from_dynamic(&vars.into())
                .map_err(|error| failure(error.to_string()))?;
            template.call("render_template", json!({"name":name,"vars":vars}))
        },
    );
    let budget = host.clone();
    engine.register_fn("budget", move || budget.call("budget", Value::Null));
    engine.register_fn(
        "json_encode",
        |value: Dynamic| -> Result<String, Box<EvalAltResult>> {
            rhai::serde::from_dynamic::<Value>(&value)
                .map(|value| value.to_string())
                .map_err(|error| failure(error.to_string()))
        },
    );
    engine.register_fn("json_decode", |value: String| -> ScriptResult {
        let parsed: Value =
            serde_json::from_str(&value).map_err(|error| failure(error.to_string()))?;
        rhai::serde::to_dynamic(parsed).map_err(|error| failure(error.to_string()))
    });
    let terminal = Arc::new(Mutex::new(None::<Value>));
    let completed = terminal.clone();
    engine.register_fn("complete", move |value: Dynamic| -> ScriptResult {
        let value: Value =
            rhai::serde::from_dynamic(&value).map_err(|error| failure(error.to_string()))?;
        *completed.lock().unwrap() = Some(json!({"type":"complete","value":value}));
        Err(Box::new(EvalAltResult::Exit(Dynamic::UNIT, Position::NONE)))
    });
    let completed_empty = terminal.clone();
    engine.register_fn("complete", move || -> ScriptResult {
        *completed_empty.lock().unwrap() = Some(json!({"type":"complete","value":null}));
        Err(Box::new(EvalAltResult::Exit(Dynamic::UNIT, Position::NONE)))
    });
    let waiting = host.clone();
    engine.register_fn(
        "await_user",
        move |kind: String, message: String| -> ScriptResult {
            waiting.call(
                "await_user",
                json!({"kind":pause_kind(&kind)?,"message":message}),
            )
        },
    );
    let paused = terminal.clone();
    engine.register_fn(
        "pause",
        move |kind: String, message: String| -> ScriptResult {
            *paused.lock().unwrap() =
                Some(json!({"type":"paused","kind":pause_kind(&kind)?,"message":message}));
            Err(Box::new(EvalAltResult::Exit(Dynamic::UNIT, Position::NONE)))
        },
    );
    let ast = engine
        .compile(&request.script)
        .map_err(|error| error.to_string())?;
    if request.validate {
        output(json!({"type":"validated"}));
        return Ok(());
    }
    let mut scope = Scope::new();
    scope.push_dynamic(
        "args",
        rhai::serde::to_dynamic(request.args).map_err(|error| error.to_string())?,
    );
    let result = engine.eval_ast_with_scope::<Dynamic>(&mut scope, &ast);
    if let Some(message) = terminal.lock().unwrap().take() {
        output(message);
        return Ok(());
    }
    match result {
        Ok(value) => output(
            json!({"type":"complete","value":rhai::serde::from_dynamic::<Value>(&value).map_err(|error| error.to_string())?}),
        ),
        Err(error) => return Err(error.to_string()),
    }
    Ok(())
}

fn pause_kind(value: &str) -> Result<&str, Box<EvalAltResult>> {
    match value {
        "user" | "back_off" | "no_progress" | "verification" | "infra" => Ok(value),
        "backoff" => Ok("back_off"),
        "blocked" => Ok("verification"),
        _ => Err(failure(format!("Unknown workflow pause kind: {value}"))),
    }
}

import { describe, expect, test } from "bun:test"
import { EditReplace } from "@apexo/core/tool/edit-replace"

const run = (content: string, oldString: string, newString: string, replaceAll = false) =>
  EditReplace.replaceDetailed(content, oldString, newString, replaceAll)

const error = (fn: () => unknown) => {
  try {
    fn()
  } catch (cause) {
    if (cause instanceof EditReplace.ReplaceError) return cause
    throw cause
  }
  throw new Error("expected ReplaceError")
}

describe("EditReplace.replaceDetailed", () => {
  test("exact match wins and reports one replacement", () => {
    const result = run("a\nb\nc\n", "b", "B")
    expect(result).toMatchObject({ content: "a\nB\nc\n", replacements: 1, strategy: "exact", matched: "b" })
  })

  test("line-trimmed strategy tolerates trailing/leading whitespace per line", () => {
    const content = "function f() {\n    return 1   \n}\n"
    const result = run(content, "function f() {\n  return 1\n}", "function f() {\n  return 2\n}")
    expect(result.strategy).toBe("line-trimmed")
    expect(result.content).toBe("function f() {\n  return 2\n}\n")
  })

  test("indentation-flexible strategy matches a block indented differently", () => {
    const content = "class A {\n\t\tif (x) {\n\t\t\ty()\n\t\t}\n}\n"
    const result = run(content, "if (x) {\n\ty()\n}", "if (x) {\n\tz()\n}")
    expect(["line-trimmed", "indentation-flexible"]).toContain(result.strategy)
    expect(result.content).toContain("z()")
    expect(result.content).not.toContain("y()")
  })

  test("whitespace-normalized strategy collapses runs of spaces", () => {
    const result = run("const   x  =  1\n", "const x = 1", "const x = 2")
    expect(result.strategy).toBe("whitespace-normalized")
    expect(result.content).toBe("const x = 2\n")
  })

  test("escape-normalized strategy unescapes \\n and quotes", () => {
    const result = run('say("hi")\nnext\n', 'say(\\"hi\\")\\nnext', 'say("bye")\nnext')
    expect(result.strategy).toBe("escape-normalized")
    expect(result.content).toBe('say("bye")\nnext\n')
  })

  test("block-anchor strategy uses first/last line anchors with similar middle", () => {
    const content = "start()\n  alpha one\n  beta two\n  gamma three\nend()\n"
    const result = run(content, "start()\n  alpha one\n  beta tw0\n  gamma three\nend()", "start()\nend()")
    expect(result.strategy).toBe("block-anchor")
    expect(result.content).toBe("start()\nend()\n")
  })

  test("exact multiple matches never fall through to a fuzzy strategy", () => {
    const failure = error(() => run("x = 1\nx = 1\n", "x = 1", "x = 2"))
    expect(failure.reason).toBe("multiple")
    expect(failure.message).toContain("replaceAll")
  })

  test("replaceAll counts replacements and keeps $ patterns literal", () => {
    const result = run("a-a-a", "a", "$&$1", true)
    expect(result.replacements).toBe(3)
    expect(result.content).toBe("$&$1-$&$1-$&$1")
  })

  test("single replacement keeps $ patterns literal", () => {
    expect(run("price", "price", "$& total").content).toBe("$& total")
  })

  test("identical and empty oldString are rejected", () => {
    expect(error(() => run("a", "a", "a")).reason).toBe("identical")
    expect(error(() => run("a", "", "b")).reason).toBe("empty")
  })

  test("not-found includes Grok Build nearest-match hint", () => {
    const failure = error(() =>
      run("one\nlet requestHandlerFactory = make()\nthree\n", "const requestHandlerFactory = build()", "x"),
    )
    expect(failure.reason).toBe("not-found")
    expect(failure.message).toContain("Nearest match: line 2: let requestHandlerFactory = make()")
  })

  test("not-found without any token match has no hint", () => {
    const failure = error(() => run("alpha\nbeta\n", "zzzz qqqq", "x"))
    expect(failure.message).not.toContain("Nearest match")
    expect(failure.message).not.toContain("Unicode typography")
  })

  test("confusable hint names lines whose smart quotes explain the miss", () => {
    const content = "a\nconsole.log(\u201Chello\u201D)\nb \u2014 c\n"
    const failure = error(() => run(content, 'console.log("hello")', "x"))
    expect(failure.message).toContain("Unicode typography characters")
    expect(failure.message).toContain("on lines 2 ")
    expect(failure.message).not.toContain("lines 2, 3")
  })

  test("no confusable hint when typography is unrelated to the miss", () => {
    const content = "it\u2019s fine\nplain text\n"
    const failure = error(() => run(content, "missing value", "x"))
    expect(failure.message).not.toContain("Unicode typography")
  })

  test("confusable hint caps listed lines at eight", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i} \u201Cq\u201D`)
    const failure = error(() =>
      run(lines.join("\n"), lines.map((line) => line.replaceAll(/[\u201C\u201D]/g, '"')).join("\n"), "x"),
    )
    expect(failure.message).toContain("1, 2, 3, 4, 5, 6, 7, 8 (and 2 more)")
  })

  test("nearest-match hint is capped at 200 characters", () => {
    const long = `token ${"x".repeat(400)}`
    const failure = error(() => run(`${long}\n`, "token zz", "x"))
    const hint = failure.message.slice(failure.message.indexOf("\n\nNearest match"))
    expect(hint.length).toBe(200)
  })
})

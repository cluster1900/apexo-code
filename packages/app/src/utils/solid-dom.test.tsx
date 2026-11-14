import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "@apexo/ui/button"

test("the App unit loader renders reactive Solid JSX and shared UI components", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => {
    const [count, setCount] = createSignal(0)
    return (
      <Button disabled={count() === 2} onClick={() => setCount((value) => value + 1)}>
        {count()}
      </Button>
    )
  }, host)
  try {
    const button = host.querySelector("button")!
    expect(button.dataset.component).toBe("button")
    expect(button.textContent).toBe("0")
    button.click()
    expect(button.textContent).toBe("1")
    button.click()
    expect(button.textContent).toBe("2")
    expect(button.disabled).toBe(true)
  } finally {
    dispose()
    expect(host.childElementCount).toBe(0)
    host.remove()
  }
})

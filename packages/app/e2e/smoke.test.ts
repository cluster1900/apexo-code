import { expect, test } from "@playwright/test"

test("web app serves its root shell", async ({ page }) => {
  const response = await page.goto("/")

  expect(response?.ok()).toBe(true)
  await expect(page.locator("#root")).toBeAttached()
})

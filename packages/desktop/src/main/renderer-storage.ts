import { WebContentsView, protocol } from "electron"
import {
  desktopRendererOrigin,
  legacyDesktopRendererOrigin,
  legacyDesktopRendererScheme,
} from "@apexo/core/desktop-origin"
import { getStore } from "./store"
import { RENDERER_STORAGE_MIGRATED_KEY } from "./store-keys"

const storagePage = "/.apexo-renderer-storage"

export function rendererStoragePage(url: string, origin: string) {
  if (url !== origin + storagePage) return
  return new Response("<!doctype html>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'",
    },
  })
}

export async function migrateRendererStorage() {
  if (process.env.ELECTRON_RENDERER_URL) return
  const settings = getStore()
  if (settings.get(RENDERER_STORAGE_MIGRATED_KEY) === desktopRendererOrigin) return

  const view = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  try {
    // Chromium keeps localStorage per origin. Use empty pages in the same profile to copy only missing keys.
    protocol.handle(
      legacyDesktopRendererScheme,
      (request) => rendererStoragePage(request.url, legacyDesktopRendererOrigin) ?? new Response(null, { status: 404 }),
    )
    await view.webContents.loadURL(legacyDesktopRendererOrigin + storagePage)
    const entries: [string, string][] = await view.webContents.executeJavaScript(`
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index)
        return [key, localStorage.getItem(key)]
      })
    `)
    if (entries.length) {
      await view.webContents.loadURL(desktopRendererOrigin + storagePage)
      await view.webContents.executeJavaScript(`
        for (const [key, value] of ${JSON.stringify(entries)}) {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
        }
      `)
      view.webContents.session.flushStorageData()
    }
    settings.set(RENDERER_STORAGE_MIGRATED_KEY, desktopRendererOrigin)
  } finally {
    protocol.unhandle(legacyDesktopRendererScheme)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}

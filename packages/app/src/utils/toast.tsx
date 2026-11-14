import { Icon, type IconProps } from "@apexo/ui/icon"
import {
  Toast,
  showToast as showLegacyToast,
  toaster as legacyToaster,
  type ToastOptions,
  type ToastVariant,
} from "@apexo/ui/toast"
import { ToastV2, showToastV2, toasterV2 } from "@apexo/ui/v2/toast-v2"
import { isRTL } from "@kobalte/core/i18n"
import { useLanguage } from "@/context/language"

let v2 = false

export function setV2Toast(value: boolean) {
  v2 = value
}

export function ToastRegion(props: { v2: boolean }) {
  const language = useLanguage()
  // Keep feedback above the session dock and the first-run Tabs card.
  if (props.v2)
    return (
      <ToastV2.Region
        position={isRTL(language.intl()) ? "top-left" : "top-right"}
        offset={isRTL(language.intl()) ? { left: 32, top: 48 } : { right: 32, top: 48 }}
        swipeDirections={["top"]}
      />
    )
  return <Toast.Region style={{ top: "48px", bottom: "auto", "max-height": "calc(100dvh - 240px)" }} />
}

export function showToast(options: ToastOptions | string) {
  if (!v2) return showLegacyToast(options)
  if (typeof options === "string") return showToastV2(options)

  return showToastV2({
    ...options,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

// v1 and v2 ids come from separate registries, so dismissal has to use the same
// implementation that issued the id.
export function dismissToast(toastId: number) {
  if (!v2) return legacyToaster.dismiss(toastId)
  return toasterV2.dismiss(toastId)
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastVariant | undefined) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return
  return <Icon name={name} />
}

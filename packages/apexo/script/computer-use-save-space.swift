import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--restore" {
    typealias WindowNumber = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError

    guard let pid = pid_t(CommandLine.arguments[2]), pid > 0,
          let number = CGWindowID(CommandLine.arguments[3]), number > 0 else {
        fputs("Invalid TextEdit window identity\n", stderr)
        exit(2)
    }
    guard let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.apple.TextEdit" else {
        fputs("Original TextEdit process \(pid) exited before window \(number) could be restored\n", stderr)
        exit(2)
    }
    guard AXIsProcessTrusted() else {
        fputs("Accessibility permission is required by the TextEdit window restoration helper\n", stderr)
        exit(2)
    }
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "_AXUIElementGetWindow") else {
        fputs("Unable to match accessibility windows by WindowServer ID\n", stderr)
        exit(2)
    }

    let accessibility = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(accessibility, 0.5)
    // Activation can make an off-Space AX window discoverable on the next attempt.
    app.unhide()
    let activated = app.activate(options: [])
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(accessibility, kAXWindowsAttribute as CFString, &value)
    let windowNumber = unsafeBitCast(symbol, to: WindowNumber.self)
    let window = (value as? [AXUIElement])?.first { element in
        var candidate: CGWindowID = 0
        return windowNumber(element, &candidate) == .success && candidate == number
    }
    guard let window else {
        print("activate=\(activated), AXWindows=\(status.rawValue), owned window absent")
        exit(0)
    }

    var minimized: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimized)
    if minimized as? Bool == true {
        AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    }
    let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    print("activate=\(activated), AXRaise=\(raised.rawValue)")
    exit(0)
}

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--probe" {
    typealias MainConnection = @convention(c) () -> Int32
    typealias ManagedSpaces = @convention(c) (Int32) -> Unmanaged<CFArray>?

    // CoreGraphics exposes on-screen windows, but only SkyLight reports the active Space ID.
    guard let pid = Int(CommandLine.arguments[2]), pid > 0,
          let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY),
          let connection = dlsym(library, "CGSMainConnectionID"),
          let managedSpaces = dlsym(library, "CGSCopyManagedDisplaySpaces"),
          let rows = unsafeBitCast(managedSpaces, to: ManagedSpaces.self)(
              unsafeBitCast(connection, to: MainConnection.self)()
          )?.takeRetainedValue() as? [[String: Any]] else {
        fputs("Unable to read managed macOS Spaces\n", stderr)
        exit(2)
    }

    func spaceID(_ row: [String: Any]) -> Int? { (row["ManagedSpaceID"] as? NSNumber)?.intValue }

    let displays = rows.compactMap { row -> [String: Any]? in
        guard let active = row["Current Space"] as? [String: Any], let current = spaceID(active),
              let spaces = row["Spaces"] as? [[String: Any]] else { return nil }
        return ["current": current, "spaces": spaces.compactMap(spaceID)]
    }
    let windows = CGWindowListCopyWindowInfo([.excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == pid }
    let all = owned.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
    let onscreen = owned
        .filter { ($0[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true }
        .compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
    let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
    let result: [String: Any] = ["displays": displays, "windows": all, "onscreen": onscreen, "foregroundApp": front]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self))
    exit(0)
}

final class SpaceTarget: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 700, height: 480),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        self.window = window
        window.title = "Apexo Save regression"
        window.collectionBehavior = [.fullScreenPrimary]
        window.makeKeyAndOrderFront(nil)
        NSRunningApplication.current.activate(options: [.activateIgnoringOtherApps])
        DispatchQueue.main.async { window.toggleFullScreen(nil) }
    }
}

let delegate = SpaceTarget()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()

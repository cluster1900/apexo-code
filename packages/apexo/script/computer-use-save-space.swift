import AppKit
import CoreGraphics
import Darwin
import Foundation

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
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let onscreen = windows
        .filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == pid }
        .compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
    print(String(decoding: try JSONSerialization.data(withJSONObject: ["displays": displays, "onscreen": onscreen]), as: UTF8.self))
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

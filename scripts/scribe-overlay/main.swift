// Scribe overlay — the native MECHANISM for system-wide inline squiggles. It carries NO writing
// logic (no rules, no dictionary): it reads the focused field's text + geometry, draws squiggles
// where it's told, and reports focus/typing back. The POLICY (what to underline) lives in the pro
// Electron process, which runs the writing engine and drives this binary over stdio. This split
// keeps the open-core boundary clean and the engine the single source of truth.
//
// Two modes:
//   (default) IPC   — stdin: JSON commands; stdout: JSON events; stderr: debug. Driven by Electron.
//   --demo [words]  — standalone visual test: underlines a demo word set in the focused native
//                     field, no Electron needed. Used to verify coordinates/drawing.
//
// Build: swiftc -O scripts/scribe-overlay/main.swift -o /tmp/scribe-overlay \
//          -framework Cocoa -framework ApplicationServices
//
// IPC protocol (one JSON object per line):
//   Electron → binary:
//     {"cmd":"underline","spans":[{"loc":Int,"len":Int,"cat":"spelling|grammar|clarity|style|punctuation"}]}
//     {"cmd":"clear"}                      remove all squiggles
//     {"cmd":"quit"}                       exit
//   binary → Electron:
//     {"type":"context","bundleId":String,"app":String,"text":String,"editable":Bool}   focus/text changed
//     {"type":"blur"}                      no focused text field
//
import Cocoa
import ApplicationServices
import Foundation

// ============================================================ AX helpers

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &out) == .success ? out : nil
}
func stringAttr(_ el: AXUIElement, _ name: String) -> String? { attr(el, name) as? String }

func setAX(_ el: AXUIElement, _ name: String, _ value: CFTypeRef) -> Bool {
    AXUIElementSetAttributeValue(el, name as CFString, value) == .success
}

func directBounds(_ el: AXUIElement, _ loc: Int, _ len: Int) -> CGRect? {
    var range = CFRange(location: loc, length: len)
    guard let axRange = AXValueCreate(.cfRange, &range) else { return nil }
    var out: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(
        el, kAXBoundsForRangeParameterizedAttribute as CFString, axRange, &out) == .success,
        let v = out else { return nil }
    var rect = CGRect.zero
    guard AXValueGetValue(v as! AXValue, .cgRect, &rect), rect.width > 0, rect.height > 0 else { return nil }
    return rect
}

func getSelection(_ el: AXUIElement) -> CFRange? {
    guard let v = attr(el, kAXSelectedTextRangeAttribute as String) else { return nil }
    var r = CFRange()
    return AXValueGetValue(v as! AXValue, .cfRange, &r) ? r : nil
}
@discardableResult
func setSelection(_ el: AXUIElement, _ loc: Int, _ len: Int) -> Bool {
    var r = CFRange(location: loc, length: len)
    guard let v = AXValueCreate(.cfRange, &r) else { return false }
    return setAX(el, kAXSelectedTextRangeAttribute as String, v)
}

// Chromium/Electron/browser path: AXBoundsForRange lies, so set the selection to the range and
// read the selection's marker-range bounds. Caller restores the cursor afterward. Rejects the
// whole-line bogus rect Chromium returns for the word before a newline.
func selectionBounds(_ el: AXUIElement, _ loc: Int, _ len: Int, fieldWidth: CGFloat) -> CGRect? {
    setSelection(el, 0, 0); usleep(6000)
    guard setSelection(el, loc, len) else { return nil }
    usleep(40000)
    for attempt in 0 ..< 8 {
        if attempt > 0 { usleep(7000) }
        guard let marker = attr(el, "AXSelectedTextMarkerRange") else { continue }
        var out: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
            el, "AXBoundsForTextMarkerRange" as CFString, marker, &out) == .success, let v = out else { continue }
        var rect = CGRect.zero
        guard AXValueGetValue(v as! AXValue, .cgRect, &rect) else { continue }
        if rect.width > 0, rect.height > 0, fieldWidth <= 0 || rect.width < fieldWidth * 0.8 { return rect }
    }
    return nil
}

func elementFrameAX(_ el: AXUIElement) -> CGRect? {
    guard let pv = attr(el, kAXPositionAttribute as String), let sv = attr(el, kAXSizeAttribute as String) else { return nil }
    var pos = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(pv as! AXValue, .cgPoint, &pos), AXValueGetValue(sv as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
}

extension unichar { var scalar: Unicode.Scalar { Unicode.Scalar(self) ?? Unicode.Scalar(65) } }

func wordRanges(_ text: String) -> [(loc: Int, len: Int, word: String)] {
    var out: [(Int, Int, String)] = []
    let ns = text as NSString
    var i = 0; let n = ns.length; let ws = CharacterSet.whitespacesAndNewlines
    while i < n {
        while i < n, ws.contains(ns.character(at: i).scalar) { i += 1 }
        let s = i
        while i < n, !ws.contains(ns.character(at: i).scalar) { i += 1 }
        if i > s {
            let raw = ns.substring(with: NSRange(location: s, length: i - s))
            out.append((s, i - s, raw.trimmingCharacters(in: CharacterSet.alphanumerics.inverted).lowercased()))
        }
    }
    return out
}

// ============================================================ coordinate transform

// AX rects: top-left origin at the primary display, Y down. Cocoa: bottom-left, Y up. Flip against
// the primary screen height; holds across monitors since both are global from the same origin.
func axRectToCocoa(_ r: CGRect) -> CGRect {
    let primaryH = NSScreen.screens.first?.frame.height ?? r.maxY
    return CGRect(x: r.origin.x, y: primaryH - r.origin.y - r.size.height, width: r.size.width, height: r.size.height)
}

// ============================================================ overlay window + view

let CATEGORY_COLOR: [String: NSColor] = [
    "spelling":    NSColor(calibratedRed: 0.94, green: 0.27, blue: 0.27, alpha: 1),  // red
    "grammar":     NSColor(calibratedRed: 0.96, green: 0.62, blue: 0.07, alpha: 1),  // amber
    "clarity":     NSColor(calibratedRed: 0.23, green: 0.51, blue: 0.96, alpha: 1),  // blue
    "style":       NSColor(calibratedRed: 0.55, green: 0.36, blue: 0.96, alpha: 1),  // violet
    "punctuation": NSColor(calibratedRed: 0.55, green: 0.36, blue: 0.96, alpha: 1),
    "demo":        NSColor(calibratedRed: 0.204, green: 0.827, blue: 0.60, alpha: 1) // emerald
]

struct Underline { let rect: CGRect; let cat: String }   // rect in view coords

final class SquiggleView: NSView {
    var items: [Underline] = [] { didSet { needsDisplay = true } }
    override var isFlipped: Bool { false }
    override func draw(_ dirty: NSRect) {
        NSColor.clear.set(); dirty.fill()
        for u in items {
            (CATEGORY_COLOR[u.cat] ?? CATEGORY_COLOR["demo"]!).setStroke()
            let path = NSBezierPath(); path.lineWidth = 2.0
            let baseline = u.rect.minY - 1, amp: CGFloat = 2.0, step: CGFloat = 3.0
            var x = u.rect.minX; path.move(to: NSPoint(x: x, y: baseline)); var up = true
            while x < u.rect.maxX {
                x += step
                path.line(to: NSPoint(x: min(x, u.rect.maxX), y: baseline + (up ? amp : -amp))); up.toggle()
            }
            path.stroke()
        }
    }
}

final class Overlay {
    let window: NSWindow; let view: SquiggleView; let unionOrigin: CGPoint
    init() {
        let union = NSScreen.screens.reduce(CGRect.zero) { $0.union($1.frame) }
        window = NSWindow(contentRect: union, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false; window.backgroundColor = .clear; window.ignoresMouseEvents = true
        window.level = .screenSaver; window.hasShadow = false
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        view = SquiggleView(frame: CGRect(origin: .zero, size: union.size))
        window.contentView = view; window.orderFrontRegardless()
        unionOrigin = union.origin
    }
    func draw(_ cocoa: [(CGRect, String)]) {
        view.items = cocoa.map { Underline(rect: CGRect(x: $0.0.minX - unionOrigin.x, y: $0.0.minY - unionOrigin.y, width: $0.0.width, height: $0.0.height), cat: $0.1) }
    }
}

let MAX_SQUIGGLES = 300

func focusedTextElement() -> (el: AXUIElement, bundleId: String, app: String)? {
    guard let front = NSWorkspace.shared.frontmostApplication,
          let f = attr(AXUIElementCreateApplication(front.processIdentifier), kAXFocusedUIElementAttribute as String)
    else { return nil }
    let el = f as! AXUIElement
    let role = stringAttr(el, kAXRoleAttribute as String) ?? ""
    guard role == "AXTextArea" || role == "AXTextField" else { return nil }
    return (el, front.bundleIdentifier ?? "", front.localizedName ?? "")
}

// ============================================================ demo mode

func runDemo() {
    let targets: Set<String> = {
        let a = Array(CommandLine.arguments.dropFirst().filter { $0 != "--demo" })
        return a.isEmpty ? ["recieve", "teh", "alot", "wierd", "seperate", "definately"] : Set(a.map { $0.lowercased() })
    }()
    let overlay = Overlay()
    FileHandle.standardError.write("demo targets: \(targets.sorted().joined(separator: ", "))\n".data(using: .utf8)!)
    Timer.scheduledTimer(withTimeInterval: 1.0 / 15.0, repeats: true) { _ in
        guard let f = focusedTextElement(), let text = stringAttr(f.el, kAXValueAttribute as String) else { overlay.draw([]); return }
        let frame = elementFrameAX(f.el)
        var out: [(CGRect, String)] = []
        for w in wordRanges(text) where targets.contains(w.word) {
            if out.count >= MAX_SQUIGGLES { break }
            if let r = directBounds(f.el, w.loc, w.len) {
                if let fr = frame, !fr.intersects(r) { continue }
                out.append((axRectToCocoa(r), "demo"))
            }
        }
        overlay.draw(out)
    }
}

// ============================================================ IPC mode

final class IpcOverlay {
    let overlay = Overlay()
    var spans: [(loc: Int, len: Int, cat: String)] = []
    var lastContextKey = ""
    var preferSelection = false
    var lastText = ""
    let lock = NSLock()
    // Bounds cache (AX rects, pre-conversion), keyed "loc:len". For selection-trick apps we only
    // re-measure when the text/span set changes AND typing has settled — measuring moves the
    // cursor, so doing it per-tick or mid-type would fight the user. Native apps re-measure freely.
    var cache: [String: CGRect] = [:]
    var measuredKey = ""
    var lastChange = Date()
    let typingPause: TimeInterval = 0.4

    func emit(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }

    func handleCommand(_ obj: [String: Any]) {
        switch obj["cmd"] as? String {
        case "underline":
            let raw = obj["spans"] as? [[String: Any]] ?? []
            lock.lock()
            spans = raw.compactMap {
                guard let l = $0["loc"] as? Int, let n = $0["len"] as? Int else { return nil }
                return (l, n, ($0["cat"] as? String) ?? "grammar")
            }
            lock.unlock()
        case "clear":
            lock.lock(); spans = []; lock.unlock()
        case "quit":
            exit(0)
        default: break
        }
    }

    private func spanKey(_ loc: Int, _ len: Int) -> String { "\(loc):\(len)" }
    private func spanSetSignature(_ ss: [(loc: Int, len: Int, cat: String)]) -> String {
        ss.map { "\($0.loc):\($0.len)" }.joined(separator: ",")
    }

    // Each tick: report context on change; keep the cache fresh (per strategy) and redraw.
    func tick() {
        guard let f = focusedTextElement(), let text = stringAttr(f.el, kAXValueAttribute as String) else {
            if lastContextKey != "blur" { emit(["type": "blur"]); lastContextKey = "blur"; lastText = "" }
            overlay.draw([]); return
        }
        if text != lastText {
            lastChange = Date(); cache = [:]; measuredKey = ""
            preferSelection = false          // re-detect strategy after an edit
        }
        let key = f.bundleId + "\u{1}" + text
        if key != lastContextKey {
            lastContextKey = key; lastText = text
            emit(["type": "context", "bundleId": f.bundleId, "app": f.app, "text": text, "editable": true])
        }
        let frame = elementFrameAX(f.el)
        lock.lock(); let current = spans; lock.unlock()
        if current.isEmpty { overlay.draw([]); return }

        // Detect strategy once per field/edit: if direct fails on the first span, it's a
        // Chromium/Electron/browser field → selection trick.
        if !preferSelection, let first = current.first, directBounds(f.el, first.loc, first.len) == nil {
            preferSelection = true
        }

        if !preferSelection {
            // Native: direct bounds are cheap → refresh the cache every tick (tracks scroll).
            var fresh: [String: CGRect] = [:]
            for s in current { if let r = directBounds(f.el, s.loc, s.len) { fresh[spanKey(s.loc, s.len)] = r } }
            cache = fresh
        } else {
            // Selection trick: only re-measure when the span set changed AND typing settled, so we
            // don't move the cursor mid-type. (Trade-off: squiggles can lag a scroll until the next
            // edit; acceptable for v1, revisited with an AXObserver scroll hook.)
            let sig = spanSetSignature(current) + "|" + String(text.utf16.count)
            if sig != measuredKey, Date().timeIntervalSince(lastChange) > typingPause {
                let saved = getSelection(f.el)
                var fresh: [String: CGRect] = [:]
                for s in current {
                    if fresh.count >= MAX_SQUIGGLES { break }
                    if let r = selectionBounds(f.el, s.loc, s.len, fieldWidth: frame?.width ?? 0) {
                        fresh[spanKey(s.loc, s.len)] = r
                    }
                }
                if let sv = saved { setSelection(f.el, sv.location, sv.length) }
                cache = fresh; measuredKey = sig
            }
        }

        var out: [(CGRect, String)] = []
        for s in current {
            if out.count >= MAX_SQUIGGLES { break }
            guard let r = cache[spanKey(s.loc, s.len)] else { continue }
            if let fr = frame, !fr.intersects(r) { continue }
            out.append((axRectToCocoa(r), s.cat))
        }
        overlay.draw(out)
    }

    func start() {
        // Read stdin commands on a background thread; apply on main.
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine(strippingNewline: true) {
                guard let d = line.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
                DispatchQueue.main.async { self.handleCommand(obj) }
            }
            DispatchQueue.main.async { exit(0) } // stdin closed → parent gone
        }
        // Native apps: cheap direct measure at 15fps tracks scroll perfectly. Selection apps are
        // re-measured too but throttled inside measure(); acceptable for v1.
        Timer.scheduledTimer(withTimeInterval: 1.0 / 15.0, repeats: true) { _ in self.tick() }
    }
}

// ============================================================ entry

if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
    FileHandle.standardError.write("Accessibility permission required.\n".data(using: .utf8)!)
    exit(1)
}
NSApplication.shared.setActivationPolicy(.accessory)
if CommandLine.arguments.contains("--demo") {
    runDemo()
} else {
    IpcOverlay().start()
}
NSApplication.shared.run()

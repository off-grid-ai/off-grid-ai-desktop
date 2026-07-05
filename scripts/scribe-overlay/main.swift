// Scribe overlay — Phase 1 vertical slice (VISUAL CHECKPOINT, not wired to the engine yet).
//
// Proves the hard part of the system-wide overlay: a transparent, click-through, always-on-top
// window that draws wavy underlines at the correct on-screen position under words in ANOTHER
// app's focused text field, and keeps tracking them as you type / scroll / move the window.
//
// P1 scope: NATIVE apps via direct AXBoundsForRange (Notes, Mail, TextEdit). It underlines a
// small demo set of "misspelled" words so you can see placement without the real engine. The
// engine/IPC wiring comes next; this is the checkpoint to confirm coordinates + drawing.
//
// Build + run (from repo root):
//   swiftc -O scripts/scribe-overlay/main.swift -o /tmp/scribe-overlay -framework Cocoa -framework ApplicationServices
//   /tmp/scribe-overlay [word1 word2 ...]      # default demo words if none given
// Then open Notes and type e.g.:  please recieve teh alot of wierd notes
// You should see red wavy underlines under the four misspelled words, tracking as you edit.
// Ctrl-C to quit.

import Cocoa
import ApplicationServices

// --- AX helpers (same technique as the probe) ------------------------------

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &out) == .success ? out : nil
}
func stringAttr(_ el: AXUIElement, _ name: String) -> String? { attr(el, name) as? String }

func directBounds(_ el: AXUIElement, location: Int, length: Int) -> CGRect? {
    var range = CFRange(location: location, length: length)
    guard let axRange = AXValueCreate(.cfRange, &range) else { return nil }
    var out: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(
        el, kAXBoundsForRangeParameterizedAttribute as CFString, axRange, &out) == .success,
        let v = out else { return nil }
    var rect = CGRect.zero
    guard AXValueGetValue(v as! AXValue, .cgRect, &rect), rect.width > 0, rect.height > 0 else { return nil }
    return rect
}

extension unichar { var scalar: Unicode.Scalar { Unicode.Scalar(self) ?? Unicode.Scalar(65) } }

// UTF-16 word ranges (AX offsets are UTF-16), with trailing punctuation stripped for matching.
func wordRanges(_ text: String) -> [(loc: Int, len: Int, word: String)] {
    var out: [(Int, Int, String)] = []
    let ns = text as NSString
    var i = 0
    let n = ns.length
    let ws = CharacterSet.whitespacesAndNewlines
    while i < n {
        while i < n, ws.contains(ns.character(at: i).scalar) { i += 1 }
        let start = i
        while i < n, !ws.contains(ns.character(at: i).scalar) { i += 1 }
        if i > start {
            let raw = ns.substring(with: NSRange(location: start, length: i - start))
            let clean = raw.trimmingCharacters(in: CharacterSet.alphanumerics.inverted).lowercased()
            out.append((start, i - start, clean))
        }
    }
    return out
}

// --- coordinate transform (AX top-left global → Cocoa bottom-left global) ----

// AX rects: top-left origin at the primary (menubar) display, Y down. Cocoa: bottom-left origin
// at the primary display, Y up. The flip is against the PRIMARY screen height and holds across
// monitors because both are global relative to the same origin.
func axRectToCocoa(_ r: CGRect) -> CGRect {
    let primaryH = NSScreen.screens.first?.frame.height ?? r.maxY
    return CGRect(x: r.origin.x, y: primaryH - r.origin.y - r.size.height, width: r.size.width, height: r.size.height)
}

// --- overlay window + view --------------------------------------------------

final class SquiggleView: NSView {
    var rects: [CGRect] = [] { didSet { needsDisplay = true } }   // in this view's coords
    override var isFlipped: Bool { false }

    override func draw(_ dirty: NSRect) {
        NSColor.clear.set()
        dirty.fill()
        // Emerald (brand #34D399), deliberately NOT red — so it can't be confused with the
        // OS's native red spellcheck underline while we verify placement.
        let color = NSColor(calibratedRed: 0.204, green: 0.827, blue: 0.600, alpha: 1.0)
        color.setStroke()
        for r in rects {
            let path = NSBezierPath()
            path.lineWidth = 2.0
            let baseline = r.minY - 1
            let amp: CGFloat = 2.2
            let step: CGFloat = 3.0
            var x = r.minX
            path.move(to: NSPoint(x: x, y: baseline))
            var up = true
            while x < r.maxX {
                x += step
                path.line(to: NSPoint(x: min(x, r.maxX), y: baseline + (up ? amp : -amp)))
                up.toggle()
            }
            path.stroke()
        }
    }
}

final class Overlay {
    let window: NSWindow
    let view: SquiggleView

    init() {
        // Cover the union of all screens.
        let union = NSScreen.screens.reduce(CGRect.zero) { $0.union($1.frame) }
        window = NSWindow(contentRect: union, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.ignoresMouseEvents = true              // click-through (P1; hit-testing comes in P3)
        window.level = .screenSaver                   // above normal app windows
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.hasShadow = false
        view = SquiggleView(frame: CGRect(origin: .zero, size: union.size))
        window.contentView = view
        window.orderFrontRegardless()
        // Remember the union origin to translate global Cocoa coords into view coords.
        self.unionOrigin = union.origin
    }
    let unionOrigin: CGPoint

    func show(cocoaRects: [CGRect]) {
        view.rects = cocoaRects.map {
            CGRect(x: $0.origin.x - unionOrigin.x, y: $0.origin.y - unionOrigin.y, width: $0.width, height: $0.height)
        }
    }
}

// --- refresh loop -----------------------------------------------------------

let demoTargets: Set<String> = {
    let args = Array(CommandLine.arguments.dropFirst())
    return args.isEmpty ? ["recieve", "teh", "alot", "wierd", "seperate", "definately"] : Set(args.map { $0.lowercased() })
}()

func focusedTextElement() -> AXUIElement? {
    guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
    let app = AXUIElementCreateApplication(front.processIdentifier)
    guard let f = attr(app, kAXFocusedUIElementAttribute as String) else { return nil }
    let el = f as! AXUIElement
    let role = stringAttr(el, kAXRoleAttribute as String) ?? ""
    return (role == "AXTextArea" || role == "AXTextField") ? el : nil
}

var lastSig = ""
func refresh(_ overlay: Overlay) {
    guard let el = focusedTextElement(), let text = stringAttr(el, kAXValueAttribute as String) else {
        if lastSig != "none" { print("[overlay] no focused text field"); lastSig = "none" }
        overlay.show(cocoaRects: [])
        return
    }
    var rects: [CGRect] = []
    var matched: [String] = []
    for w in wordRanges(text) where demoTargets.contains(w.word) {
        matched.append(w.word)
        if let r = directBounds(el, location: w.loc, length: w.len) {
            rects.append(axRectToCocoa(r))
        }
    }
    let sig = matched.joined(separator: ",") + "|" + String(rects.count)
    if sig != lastSig {
        print("[overlay] matched \(matched.count) word(s): [\(matched.joined(separator: ", "))] → drawing \(rects.count) squiggle(s)")
        if let f = rects.first { print("[overlay]   first squiggle at cocoa rect x=\(Int(f.minX)) y=\(Int(f.minY)) w=\(Int(f.width))") }
        lastSig = sig
    }
    overlay.show(cocoaRects: rects)
}

// Accessibility permission gate.
if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
    print("Grant Accessibility to your terminal in System Settings → Privacy & Security → Accessibility, then rerun.")
    exit(1)
}

let appDelegateApp = NSApplication.shared
appDelegateApp.setActivationPolicy(.accessory)   // no dock icon, don't steal focus
let overlay = Overlay()
print("Scribe overlay running. Targets: \(demoTargets.sorted().joined(separator: ", "))")
print("Open Notes/TextEdit and type those words — you should see red wavy underlines. Ctrl-C to quit.")

// 15 fps refresh (P1: simple + reliable. P2 swaps to AXObserver-driven + caching).
Timer.scheduledTimer(withTimeInterval: 1.0 / 15.0, repeats: true) { _ in refresh(overlay) }
appDelegateApp.run()

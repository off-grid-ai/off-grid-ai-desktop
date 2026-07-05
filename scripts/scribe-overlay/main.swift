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

// Coexist with macOS's own spellchecker the way TextWarden/Harper do: don't try to suppress the
// native red underline (impossible for third-party apps + browsers use their own), but DO respect
// words the user taught macOS via "Learn Spelling" — never draw a spelling squiggle on those.
func isLearnedSpelling(_ text: String, _ loc: Int, _ len: Int) -> Bool {
    let ns = text as NSString
    guard loc >= 0, len > 0, loc + len <= ns.length else { return false }
    return NSSpellChecker.shared.hasLearnedWord(ns.substring(with: NSRange(location: loc, length: len)))
}

// High-quality spelling suggestions from macOS itself (e.g. "gance" → "glance"), far better than a
// small bundled wordlist. Used for the card's spelling fixes; grammar/style fixes still come from
// the engine.
func osSpellGuesses(_ word: String) -> [String] {
    guard !word.isEmpty else { return [] }
    let r = NSRange(location: 0, length: (word as NSString).length)
    return NSSpellChecker.shared.guesses(forWordRange: r, in: word, language: nil, inSpellDocumentWithTag: 0) ?? []
}

// Expand a (loc,len) span to the sentence that contains it — style/clarity fixes (passive voice,
// wordiness) are sentence-level, so the model must rewrite the whole sentence, not the flagged
// fragment. Bounds are the nearest . ! ? or newline on each side (UTF-16 offsets, matching AX).
func sentenceRange(_ text: String, _ loc: Int, _ len: Int) -> (loc: Int, len: Int) {
    let ns = text as NSString
    let n = ns.length
    guard loc >= 0, loc <= n else { return (loc, len) }
    let enders = CharacterSet(charactersIn: ".!?\n")
    var start = min(loc, n)
    while start > 0 {
        let c = ns.character(at: start - 1)
        if let u = Unicode.Scalar(c), enders.contains(u) { break }
        start -= 1
    }
    var end = min(loc + max(len, 0), n)
    while end < n {
        let c = ns.character(at: end)
        end += 1
        if let u = Unicode.Scalar(c), enders.contains(u) { break }
    }
    // Trim leading whitespace so the selection starts at the first word.
    while start < end, let u = Unicode.Scalar(ns.character(at: start)), CharacterSet.whitespaces.contains(u) {
        start += 1
    }
    return (start, max(0, end - start))
}

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

// A brand chip — a fully custom, layer-drawn clickable view. AppKit's NSButton won't let us set a
// push button's fill/title color reliably (contentTintColor + bezelColor are ignored for rounded
// buttons), so we own the drawing: emerald fill + dark text for primary (fixes), dark-grey fill +
// light text for secondary. Click fires on mouseUp inside bounds.
final class ChipView: NSView {
    var onClick: (() -> Void)?
    override var isFlipped: Bool { true }
    // The card is a non-activating panel; without these the first click on a chip is swallowed
    // (the view never enters the event chain, so mouseUp never fires).
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with e: NSEvent) { /* accept so we receive the matching mouseUp */ }
    override func mouseUp(with e: NSEvent) {
        if bounds.contains(convert(e.locationInWindow, from: nil)) { onClick?() }
    }
}

// The branded correction card — a small non-activating panel (never steals focus from the app
// you're typing in) styled to the Off Grid brand: dark card, emerald fixes, Menlo. Swift-drawn
// (not an Electron window) so it's reliable floating over other apps.
// Light/dark palette (Off Grid design tokens) so the card mimics the app's theme instead of
// always being dark. Emerald accent shifts too: #34D399 on dark, #059669 on light.
enum CardTheme { case dark, light }
struct CardPalette {
    let cardBg: NSColor, border: NSColor, msg: NSColor
    let chipBg: NSColor, chipText: NSColor        // secondary chips (Ignore / gear / ×)
    let accent: NSColor, accentText: NSColor       // primary chips (fixes/Rephrase) + badge + stripe
    static let dark = CardPalette(
        cardBg: NSColor(calibratedRed: 0.078, green: 0.078, blue: 0.078, alpha: 1),   // #141414
        border: NSColor(calibratedRed: 0.165, green: 0.165, blue: 0.165, alpha: 1),   // #2A2A2A
        msg: NSColor(calibratedWhite: 0.72, alpha: 1),
        chipBg: NSColor(calibratedRed: 0.118, green: 0.118, blue: 0.118, alpha: 1),    // #1E1E1E
        chipText: NSColor(calibratedWhite: 0.85, alpha: 1),
        accent: NSColor(calibratedRed: 0.204, green: 0.827, blue: 0.60, alpha: 1),     // #34D399
        accentText: NSColor(calibratedWhite: 0.04, alpha: 1))
    static let light = CardPalette(
        cardBg: NSColor(calibratedWhite: 1.0, alpha: 1),                               // #FFFFFF
        border: NSColor(calibratedRed: 0.898, green: 0.898, blue: 0.898, alpha: 1),    // #E5E5E5
        msg: NSColor(calibratedWhite: 0.28, alpha: 1),
        chipBg: NSColor(calibratedRed: 0.945, green: 0.945, blue: 0.945, alpha: 1),    // #F1F1F1
        chipText: NSColor(calibratedWhite: 0.12, alpha: 1),
        accent: NSColor(calibratedRed: 0.02, green: 0.588, blue: 0.412, alpha: 1),     // #059669
        accentText: NSColor(calibratedWhite: 1.0, alpha: 1))
}

final class CardPanel {
    let panel: NSPanel
    private(set) var visible = false
    private(set) var anchor: CGRect = .zero   // squiggle rect (cocoa global), for the hover bridge
    var theme: CardTheme = .dark              // set by IpcOverlay from the app's resolved theme
    private var pal: CardPalette { theme == .light ? .light : .dark }
    // Set by the caller before present(); the chips invoke these.
    var onReplace: ((String) -> Void)?
    var onTeach: (() -> Void)?
    var onIgnore: (() -> Void)?
    var onClose: (() -> Void)?
    var onSettings: (() -> Void)?
    var onAiFix: (() -> Void)?

    private static func menlo(_ s: CGFloat) -> NSFont { NSFont(name: "Menlo", size: s) ?? NSFont.systemFont(ofSize: s) }

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 240, height: 80),
                        styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: true)
        panel.isFloatingPanel = true
        // Sit ABOVE the squiggle overlay window (which is at .screenSaver) so the card is never occluded.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }

    private func chip(_ title: String, accent: Bool, onClick: @escaping () -> Void) -> ChipView {
        let v = ChipView()
        v.wantsLayer = true
        v.layer?.backgroundColor = (accent ? pal.accent : pal.chipBg).cgColor
        v.layer?.cornerRadius = 6
        v.onClick = onClick
        let label = NSTextField(labelWithString: title)
        label.font = CardPanel.menlo(12)
        label.textColor = accent ? pal.accentText : pal.chipText
        label.backgroundColor = .clear
        label.isBezeled = false
        label.drawsBackground = false
        label.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: v.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: v.trailingAnchor, constant: -10),
            label.topAnchor.constraint(equalTo: v.topAnchor, constant: 5),
            label.bottomAnchor.constraint(equalTo: v.bottomAnchor, constant: -5)
        ])
        return v
    }

    func present(message: String, fixes: [String], category: String, isSpelling: Bool, anchor: CGRect) {
        self.anchor = anchor

        let root = styledRoot()

        let rows = makeRows()
        rows.addArrangedSubview(badge(category))

        let msg = NSTextField(labelWithString: message.isEmpty ? "Suggestion" : message)
        msg.font = CardPanel.menlo(11)
        msg.textColor = pal.msg
        msg.lineBreakMode = .byWordWrapping
        msg.maximumNumberOfLines = 3
        msg.preferredMaxLayoutWidth = 260
        msg.backgroundColor = .clear
        msg.isBezeled = false
        rows.addArrangedSubview(msg)

        // Primary actions row. Canned fixes (spelling guesses, a-an, etc.) are emerald chips. When
        // there's no canned fix (passive voice, wordiness, clarity), offer an emerald AI action that
        // rewrites the span with the model - so every issue is actionable, not just Ignore.
        let fixRow = NSStackView()
        fixRow.orientation = .horizontal
        fixRow.spacing = 6
        if !fixes.isEmpty {
            for f in fixes {
                fixRow.addArrangedSubview(chip(f.isEmpty ? "Remove" : f, accent: true) { [weak self] in self?.onReplace?(f) })
            }
        } else if !isSpelling {
            let label = category == "grammar" ? "Fix grammar"
                : (category == "clarity" ? "Make clearer" : "Rephrase")
            fixRow.addArrangedSubview(chip(label, accent: true) { [weak self] in self?.onAiFix?() })
        }
        if !fixRow.views.isEmpty { rows.addArrangedSubview(fixRow) }

        let secondary = NSStackView()
        secondary.orientation = .horizontal
        secondary.spacing = 6
        secondary.addArrangedSubview(chip(isSpelling ? "Add to dictionary" : "Ignore", accent: false) { [weak self] in
            if isSpelling { self?.onTeach?() } else { self?.onIgnore?() }
        })
        secondary.addArrangedSubview(chip("\u{2699}", accent: false) { [weak self] in self?.onSettings?() }) // gear
        secondary.addArrangedSubview(chip("\u{2715}", accent: false) { [weak self] in self?.onClose?() })
        rows.addArrangedSubview(secondary)

        mount(rows, in: root, anchor: anchor)
    }

    // Dark card container with the design-token surface + border + an emerald left accent stripe
    // (the Off Grid brand marker so the card reads as ours, not a system menu).
    private func styledRoot() -> NSView {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = pal.cardBg.cgColor
        root.layer?.cornerRadius = 10
        root.layer?.borderWidth = 1
        root.layer?.borderColor = pal.border.cgColor
        let stripe = CALayer()
        stripe.backgroundColor = pal.accent.cgColor
        stripe.name = "accent"
        root.layer?.addSublayer(stripe)
        return root
    }

    private func makeRows() -> NSStackView {
        let rows = NSStackView()
        rows.orientation = .vertical
        rows.alignment = .leading
        rows.spacing = 6
        rows.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        rows.translatesAutoresizingMaskIntoConstraints = false
        return rows
    }

    private func badge(_ text: String) -> NSTextField {
        let b = NSTextField(labelWithString: text.uppercased())
        b.font = CardPanel.menlo(9); b.textColor = pal.accent; b.backgroundColor = .clear; b.isBezeled = false
        return b
    }

    private func mount(_ rows: NSStackView, in root: NSView, anchor: CGRect) {
        root.addSubview(rows)
        NSLayoutConstraint.activate([
            rows.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            rows.topAnchor.constraint(equalTo: root.topAnchor),
            rows.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        let size = rows.fittingSize
        root.frame = NSRect(origin: .zero, size: size)
        // Size the emerald accent stripe down the left edge (inside the rounded corners).
        if let stripe = root.layer?.sublayers?.first(where: { $0.name == "accent" }) {
            stripe.frame = CGRect(x: 0, y: 6, width: 3, height: size.height - 12)
        }
        panel.setContentSize(size)
        panel.contentView = root
        // Position just below the anchor (cocoa is bottom-left, so "below" = smaller y).
        panel.setFrameOrigin(NSPoint(x: anchor.minX, y: anchor.minY - size.height - 4))
        panel.orderFrontRegardless()   // non-activating: shows without stealing focus
        visible = true
    }

    // Rewrite menu shown on the hotkey over a selection: action chips (emit the action key).
    func presentMenu(anchor: CGRect, onPick: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.anchor = anchor
        onSettings = nil
        let root = styledRoot()
        let rows = makeRows()
        rows.addArrangedSubview(badge("Rewrite selection"))
        let actions: [(String, String)] = [
            ("Improve", "improve"), ("Shorten", "shorten"), ("Simplify", "simplify"),
            ("Fix grammar", "fix-grammar"), ("Change tone", "tone"), ("Translate", "translate")
        ]
        var row: NSStackView?
        for (i, a) in actions.enumerated() {
            if i % 2 == 0 {
                let r = NSStackView(); r.orientation = .horizontal; r.spacing = 6
                rows.addArrangedSubview(r); row = r
            }
            row?.addArrangedSubview(chip(a.0, accent: true) { onPick(a.1) })
        }
        let sec = NSStackView(); sec.orientation = .horizontal; sec.spacing = 6
        sec.addArrangedSubview(chip("\u{2715}", accent: false) { onClose() })
        rows.addArrangedSubview(sec)
        mount(rows, in: root, anchor: anchor)
    }

    // Transient "working" card while the model rewrites.
    func presentBusy(_ message: String) {
        let root = styledRoot()
        let rows = makeRows()
        let msg = NSTextField(labelWithString: message)
        msg.font = CardPanel.menlo(12); msg.textColor = pal.msg
        msg.backgroundColor = .clear; msg.isBezeled = false
        rows.addArrangedSubview(msg)
        mount(rows, in: root, anchor: anchor)
    }

    /// Should the card stay open given the current cursor? True while the pointer is over the card
    /// or over the word it belongs to (with a little slack for the gap between them).
    func keepOpen(mouse: CGPoint) -> Bool {
        panel.frame.insetBy(dx: -12, dy: -12).contains(mouse) || anchor.insetBy(dx: -6, dy: -10).contains(mouse)
    }

    func dismiss() { if visible { panel.orderOut(nil); visible = false } }
}

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
    var spans: [(loc: Int, len: Int, cat: String, message: String, fixes: [String])] = []
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
    // Hover-to-fix: the branded card appears when the cursor dwells over a squiggle. hitRects maps
    // on-screen squiggle rects (cocoa global) to a span index for hit-testing the mouse.
    var hitRects: [(rect: CGRect, idx: Int)] = []
    var mouseAt = CGPoint.zero
    var mouseMovedAt = Date.distantPast
    var cardCooldownUntil = Date.distantPast
    var cardSpanKey = ""          // which span the card is currently showing (avoid re-present flicker)
    var cardPersistent = false    // rewrite menu / busy card stays until picked or closed (not hover-dismissed)
    var pendingRange: (loc: Int, len: Int)?  // range to re-select when a rewrite result returns
    let card = CardPanel()

    init() {
        // Default the card to the macOS system appearance until the app pushes its own theme.
        let dark = UserDefaults.standard.string(forKey: "AppleInterfaceStyle")?.lowercased() == "dark"
        card.theme = dark ? .dark : .light
    }

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
                return (l, n, ($0["cat"] as? String) ?? "grammar",
                        ($0["message"] as? String) ?? "", ($0["fixes"] as? [String]) ?? [])
            }
            lock.unlock()
        case "clear":
            lock.lock(); spans = []; lock.unlock()
        case "theme":
            // App tells us its resolved theme so the card mimics it (light/dark).
            if let t = obj["theme"] as? String { card.theme = (t == "light") ? .light : .dark }
        case "rewrite-menu":
            showRewriteMenu()
        case "apply-text":
            if let t = obj["text"] as? String { applyText(t) } else { dismissCard() }
        case "rewrite-cancel":
            // Show why briefly instead of silently vanishing (so a model failure is visible).
            if cardPersistent {
                card.presentBusy((obj["reason"] as? String) ?? "Could not rewrite - is the model loaded?")
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in self?.dismissCard() }
            } else { dismissCard() }
        case "quit":
            exit(0)
        default: break
        }
    }

    // Non-invasive bounds of the CURRENT selection (native: bounds-for-range; Chromium: bounds of
    // the live selection markers — a read, no caret movement).
    private func selectionBoundsCocoa(_ el: AXUIElement) -> CGRect? {
        if let sel = getSelection(el), sel.length > 0, let b = directBounds(el, sel.location, sel.length) {
            return axRectToCocoa(b)
        }
        if let marker = attr(el, "AXSelectedTextMarkerRange") {
            var out: CFTypeRef?
            if AXUIElementCopyParameterizedAttributeValue(el, "AXBoundsForTextMarkerRange" as CFString, marker, &out) == .success,
               let v = out {
                var r = CGRect.zero
                if AXValueGetValue(v as! AXValue, .cgRect, &r), r.width > 0 || r.height > 0 { return axRectToCocoa(r) }
            }
        }
        return nil
    }

    // Hotkey over a selection → show the rewrite menu at the selection.
    private func showRewriteMenu() {
        guard let f = focusedTextElement(),
              let range = getSelection(f.el), range.length > 0,
              let sel = stringAttr(f.el, kAXSelectedTextAttribute as String),
              !sel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let anchor = selectionBoundsCocoa(f.el) ?? CGRect(x: mouseAt.x, y: mouseAt.y, width: 1, height: 1)
        cardPersistent = true
        card.presentMenu(anchor: anchor, onPick: { [weak self] action in
            guard let self = self else { return }
            self.pendingRange = (range.location, range.length)  // re-select before pasting the result
            self.emit(["type": "rewrite", "action": action, "text": sel])
            self.card.presentBusy("Rewriting\u{2026}")
        }, onClose: { [weak self] in self?.dismissCard() })
    }

    // Rewrite result came back → RE-SELECT the original range, then paste so the rewrite REPLACES
    // it. The selection set before the LLM call has usually collapsed by now (multi-second round
    // trip), which is why an earlier version inserted at the cursor instead of replacing.
    private func applyText(_ text: String) {
        if let r = pendingRange, let f = focusedTextElement() {
            setSelection(f.el, r.loc, r.len)
            usleep(15000)
        }
        pendingRange = nil
        pasteReplace(text)
        dismissCard()
    }

    private func spanKey(_ loc: Int, _ len: Int) -> String { "\(loc):\(len)" }
    private func spanSetSignature(_ ss: [(loc: Int, len: Int, cat: String, message: String, fixes: [String])]) -> String {
        ss.map { "\($0.loc):\($0.len)" }.joined(separator: ",")
    }

    // Each tick: report context on change; keep the cache fresh (per strategy) and redraw.
    func tick() {
        guard let f = focusedTextElement(), let text = stringAttr(f.el, kAXValueAttribute as String) else {
            if lastContextKey != "blur" { emit(["type": "blur"]); lastContextKey = "blur"; lastText = "" }
            dismissCard()
            overlay.draw([]); return
        }
        if text != lastText {
            lastChange = Date(); cache = [:]; measuredKey = ""
            preferSelection = false          // re-detect strategy after an edit
            dismissCard()                    // the card's span may have shifted — don't leave it stale
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
            // Chromium/Electron/browser: the only way to get bounds here is the selection trick,
            // which MOVES the caret — that makes live typing jumpy and corrupts input. Never do that
            // while the user is in the field. Draw nothing live here; these apps are served by the
            // on-demand hotkey flow instead. (A non-invasive text-marker bounds method would let us
            // bring live squiggles back — tracked as a follow-up.)
            cache = [:]
        }

        var out: [(CGRect, String)] = []
        var hits: [(CGRect, Int)] = []
        for (idx, s) in current.enumerated() {
            if out.count >= MAX_SQUIGGLES { break }
            // Respect macOS's learned words (the TextWarden/Harper pattern) — skip spelling
            // squiggles for words the user already taught the OS dictionary.
            if s.cat == "spelling", isLearnedSpelling(text, s.loc, s.len) { continue }
            guard let r = cache[spanKey(s.loc, s.len)] else { continue }
            if let fr = frame, !fr.intersects(r) { continue }
            let cocoa = axRectToCocoa(r)
            out.append((cocoa, s.cat))
            hits.append((cocoa, idx))
        }
        hitRects = hits
        overlay.draw(out)
        updateCard(current, text: text)
    }

    // Hover-driven branded card: show it when the cursor dwells over a squiggle; keep it while the
    // cursor is over the card or the word; dismiss when it leaves both. Uses the global mouse
    // position (the overlay window stays click-through, so we never steal clicks from the target
    // app), while the card's own buttons handle their clicks as a normal non-activating panel.
    private func updateCard(_ current: [(loc: Int, len: Int, cat: String, message: String, fixes: [String])], text: String) {
        let now = Date()
        // The rewrite menu / busy card stays until the user picks or closes it — don't hover-dismiss.
        if cardPersistent { return }
        if card.visible {
            if !card.keepOpen(mouse: mouseAt) {
                card.dismiss(); cardSpanKey = ""; cardCooldownUntil = now.addingTimeInterval(0.25)
            }
            return
        }
        guard now > cardCooldownUntil, now.timeIntervalSince(mouseMovedAt) > 0.45 else { return }
        guard let hit = hitRects.first(where: { $0.rect.insetBy(dx: -1, dy: -7).contains(mouseAt) }),
              hit.idx < current.count else { return }
        showCard(for: current[hit.idx], anchor: hit.rect, text: text)
    }

    private func showCard(for span: (loc: Int, len: Int, cat: String, message: String, fixes: [String]), anchor: CGRect, text: String) {
        // For spelling, prefer macOS's own guesses (much better than a small bundled wordlist).
        var fixes = span.fixes
        if span.cat == "spelling" {
            let ns = text as NSString
            if span.loc >= 0, span.len > 0, span.loc + span.len <= ns.length {
                let word = ns.substring(with: NSRange(location: span.loc, length: span.len))
                let guesses = osSpellGuesses(word)
                if !guesses.isEmpty { fixes = Array(guesses.prefix(4)) }
            }
        }
        card.onReplace = { [weak self] fix in self?.apply(span.loc, span.len, fix); self?.dismissCard() }
        card.onTeach = { [weak self] in self?.emitAction("teach", span); self?.dismissCard() }
        card.onIgnore = { [weak self] in self?.emitAction("ignore", span); self?.dismissCard() }
        card.onClose = { [weak self] in self?.dismissCard() }
        card.onSettings = { [weak self] in self?.emit(["type": "action", "kind": "open-settings"]); self?.dismissCard() }
        // No canned fix (passive voice, wordiness, clarity) → rewrite with the model. These are
        // SENTENCE-level, so expand to the enclosing sentence (grammar stays on the flagged span);
        // select that range, request the rewrite, re-select+paste when it returns.
        card.onAiFix = { [weak self] in
            guard let self = self, let f = focusedTextElement() else { return }
            let ns = text as NSString
            let r = span.cat == "grammar" ? (loc: span.loc, len: span.len) : sentenceRange(text, span.loc, span.len)
            guard r.loc >= 0, r.len > 0, r.loc + r.len <= ns.length else { return }
            let target = ns.substring(with: NSRange(location: r.loc, length: r.len))
            setSelection(f.el, r.loc, r.len)
            self.pendingRange = (r.loc, r.len)  // re-select before pasting the result
            let action = span.cat == "grammar" ? "fix-grammar" : "improve"
            self.cardPersistent = true
            self.emit(["type": "rewrite", "action": action, "text": target])
            self.card.presentBusy("Rewriting\u{2026}")
        }
        card.present(message: span.message, fixes: fixes, category: span.cat, isSpelling: span.cat == "spelling", anchor: anchor)
        cardSpanKey = spanKey(span.loc, span.len)
    }

    private func dismissCard() {
        card.dismiss(); cardSpanKey = ""; cardPersistent = false; pendingRange = nil
        cardCooldownUntil = Date().addingTimeInterval(0.3)
    }

    // Apply a replacement over a span: select it, then replace. Try AXSelectedText first (works in
    // native apps); Chromium/Electron ignore that, so fall back to paste (universal). This is a
    // one-shot user action, so moving the caret here is fine.
    private func apply(_ loc: Int, _ len: Int, _ replacement: String) {
        guard let f = focusedTextElement() else { return }
        setSelection(f.el, loc, len)
        usleep(15000)
        // Verify AXSelectedText actually took (Chromium returns success but doesn't change the text);
        // if the value didn't change, paste instead.
        let before = stringAttr(f.el, kAXValueAttribute as String)
        let axOk = setAX(f.el, kAXSelectedTextAttribute as String, replacement as CFString)
        usleep(15000)
        let after = stringAttr(f.el, kAXValueAttribute as String)
        if !axOk || before == after {
            pasteReplace(replacement)
        }
    }

    // Replace the current selection by pasting — works in every app (the card is non-activating, so
    // the target app keeps focus). Restores the user's clipboard afterward.
    private func pasteReplace(_ replacement: String) {
        let pb = NSPasteboard.general
        let saved = pb.string(forType: .string)
        pb.clearContents()
        pb.setString(replacement, forType: .string)
        let src = CGEventSource(stateID: .combinedSessionState)
        let down = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: true)  // 'v'
        down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: false)
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            pb.clearContents()
            if let s = saved { pb.setString(s, forType: .string) }
        }
    }

    private func emitAction(_ kind: String, _ span: (loc: Int, len: Int, cat: String, message: String, fixes: [String])) {
        emit(["type": "action", "kind": kind, "loc": span.loc, "len": span.len])
    }

    func start() {
        // Track the cursor across all apps (window stays click-through). Powers hover-to-fix.
        NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved]) { [weak self] _ in
            self?.mouseAt = NSEvent.mouseLocation
            self?.mouseMovedAt = Date()
        }
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

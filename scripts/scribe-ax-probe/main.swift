// Scribe AX probe (Phase 0 spike). Answers the make-or-break question for system-wide
// inline underlining: for the focused text field in the frontmost app, can macOS give
// us (a) the text and (b) a bounding rectangle per word? If yes for an app, we can paint
// squiggles over that app; if no, that app needs a different mechanism (e.g. a browser
// extension). This tool does NOT change anything — it only reads and prints a report.
//
// Build + run (from repo root):
//   swiftc -O scripts/scribe-ax-probe/main.swift -o /tmp/scribe-ax-probe -framework Cocoa -framework ApplicationServices
//   /tmp/scribe-ax-probe            # then click into the app you want to test
//
// It counts down a few seconds so you can click into the target app AFTER launching
// (running it from Terminal would otherwise make Terminal the frontmost app).

import Cocoa
import ApplicationServices

// --- helpers ---------------------------------------------------------------

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(el, name as CFString, &out)
    return err == .success ? out : nil
}

func stringAttr(_ el: AXUIElement, _ name: String) -> String? {
    attr(el, name) as? String
}

func intAttr(_ el: AXUIElement, _ name: String) -> Int? {
    (attr(el, name) as? NSNumber)?.intValue
}

// Bounding rect for a character range, via the parameterized AX attribute. This is the
// exact call a Grammarly-style overlay needs. Returns nil when the app doesn't support it.
func boundsForRange(_ el: AXUIElement, location: Int, length: Int) -> CGRect? {
    var range = CFRange(location: location, length: length)
    guard let axRange = AXValueCreate(.cfRange, &range) else { return nil }
    var out: CFTypeRef?
    let err = AXUIElementCopyParameterizedAttributeValue(
        el, kAXBoundsForRangeParameterizedAttribute as CFString, axRange, &out)
    guard err == .success, let axVal = out else { return nil }
    var rect = CGRect.zero
    // out is an AXValue of type .cgRect
    guard AXValueGetValue(axVal as! AXValue, .cgRect, &rect) else { return nil }
    return rect
}

func getSelection(_ el: AXUIElement) -> CFRange? {
    var out: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, &out) == .success,
          let v = out else { return nil }
    var r = CFRange()
    guard AXValueGetValue(v as! AXValue, .cfRange, &r) else { return nil }
    return r
}

func setSelection(_ el: AXUIElement, location: Int, length: Int) -> Bool {
    var r = CFRange(location: location, length: length)
    guard let v = AXValueCreate(.cfRange, &r) else { return false }
    return AXUIElementSetAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, v) == .success
}

// The Chromium trick (TextWarden/Harper approach, reference-only): AXBoundsForRange lies
// in Chromium, so set the selection to the word, then read the SELECTION's marker-range
// bounds. The caller restores the original cursor afterwards.
func boundsViaSelection(_ el: AXUIElement, location: Int, length: Int) -> CGRect? {
    _ = setSelection(el, location: 0, length: 0)   // reset Chromium AX state
    usleep(8000)
    guard setSelection(el, location: location, length: length) else { return nil }
    usleep(45000)                                   // let Chromium process the selection
    for attempt in 0 ..< 10 {
        if attempt > 0 { usleep(8000) }
        var markerRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, "AXSelectedTextMarkerRange" as CFString, &markerRef) == .success,
              let marker = markerRef else { continue }
        var boundsRef: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
                el, "AXBoundsForTextMarkerRange" as CFString, marker, &boundsRef) == .success,
              let bv = boundsRef else { continue }
        var rect = CGRect.zero
        if AXValueGetValue(bv as! AXValue, .cgRect, &rect), rect.width > 0 || rect.height > 0 {
            return rect
        }
    }
    return nil
}

// Split text into (location, length) word ranges over the raw string offsets.
func wordRanges(_ text: String) -> [(Int, Int, String)] {
    var ranges: [(Int, Int, String)] = []
    let ns = text as NSString
    var i = 0
    let n = ns.length
    while i < n {
        // skip whitespace
        while i < n, CharacterSet.whitespacesAndNewlines.contains(ns.character(at: i).unicodeScalar) {
            i += 1
        }
        let start = i
        while i < n, !CharacterSet.whitespacesAndNewlines.contains(ns.character(at: i).unicodeScalar) {
            i += 1
        }
        if i > start {
            ranges.append((start, i - start, ns.substring(with: NSRange(location: start, length: i - start))))
        }
    }
    return ranges
}

extension unichar {
    // Surrogate halves (emoji) don't form a scalar — treat as non-whitespace.
    var unicodeScalar: Unicode.Scalar { Unicode.Scalar(self) ?? Unicode.Scalar(65) }
}

// --- main ------------------------------------------------------------------

// 1. Accessibility permission is required. Prompt (once) if not granted.
let trusted = AXIsProcessTrustedWithOptions(
    [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
if !trusted {
    print("❌ Accessibility permission not granted.")
    print("   Grant it in System Settings → Privacy & Security → Accessibility for your")
    print("   Terminal (or the built binary), then run again.")
    exit(1)
}

let countdown = 4
print("Scribe AX probe. Click into the app + text field you want to test.")
for s in stride(from: countdown, to: 0, by: -1) {
    print("  capturing in \(s)…")
    Thread.sleep(forTimeInterval: 1)
}

guard let front = NSWorkspace.shared.frontmostApplication else {
    print("❌ No frontmost application.")
    exit(1)
}
let appName = front.localizedName ?? "?"
let bundle = front.bundleIdentifier ?? "?"
print("\n── App: \(appName)  [\(bundle)]  pid \(front.processIdentifier) ──")

let appEl = AXUIElementCreateApplication(front.processIdentifier)
// Wake up Chromium/Electron's accessibility tree — off by default until it thinks a
// screen reader is present. Two levers:
//   - Electron apps (Slack/Teams): AXManualAccessibility on the app (no side effects).
//   - Real browsers (Chrome/Brave): reject that (-25205); they use AXEnhancedUserInterface,
//     the attribute VoiceOver sets. It CAN disturb window positioning, so we set it, test,
//     then restore it to false at the end.
let manual = AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
print("AXManualAccessibility set: \(manual == .success ? "yes" : "no (err \(manual.rawValue))")")
var setEnhanced = false
if manual != .success {
    let enhanced = AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    setEnhanced = enhanced == .success
    print("AXEnhancedUserInterface set (browser path): \(setEnhanced ? "yes — building web AX tree…" : "no (err \(enhanced.rawValue))")")
}
// Chromium builds the full (web) AX tree lazily; the first walks are empty. Give it time.
Thread.sleep(forTimeInterval: setEnhanced ? 1.2 : 0.4)
// Restore the browser's accessibility state so we don't leave it in enhanced mode.
func restoreAX() {
    if setEnhanced {
        AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse)
    }
}
guard let focusedRef = attr(appEl, kAXFocusedUIElementAttribute as String) else {
    print("❌ No focused UI element. (Is a text field actually focused?)")
    restoreAX()
    exit(1)
}
let focused = focusedRef as! AXUIElement

let role = stringAttr(focused, kAXRoleAttribute as String) ?? "?"
let roleDesc = stringAttr(focused, kAXRoleDescriptionAttribute as String) ?? "?"
print("Focused role: \(role)  (\(roleDesc))")

let value = stringAttr(focused, kAXValueAttribute as String)
let charCount = intAttr(focused, kAXNumberOfCharactersAttribute as String)

if let value = value {
    let preview = value.count > 80 ? String(value.prefix(80)) + "…" : value
    print("Text value: \"\(preview)\"  (\(value.count) chars)")
} else {
    print("Text value: <none> (AXValue not exposed)")
}
if let charCount = charCount { print("AXNumberOfCharacters: \(charCount)") }

// 2. The real test: per-word bounding rects.
let text = value ?? ""
var words = wordRanges(text)
if words.isEmpty {
    // contenteditable (Gmail/Docs) often reports a char count but no AXValue string.
    // Synthesize a few small ranges from the char count so the selection trick still
    // gets a fair test instead of bailing out.
    let n = charCount ?? 0
    if n > 0 {
        print("\nNo AXValue text, but \(n) chars reported — testing synthetic ranges (contenteditable).")
        var i = 0
        while i < min(n, 60) {
            let len = min(5, n - i)
            words.append((i, len, "chars[\(i)..\(i + len)]"))
            i += len + 1
        }
    } else {
        print("\nNo words to measure. Try focusing a field with some text in it.")
        if let r = boundsForRange(focused, location: 0, length: 1) {
            print("Single-char bounds at 0: \(r) → bounds ARE supported")
        } else if let s = boundsViaSelection(focused, location: 0, length: 1) {
            print("Single-char bounds via selection: \(s) → selection trick works")
        } else {
            print("Single-char bounds: nil → bounds NOT supported")
        }
        restoreAX()
        exit(0)
    }
}

var ok = 0
var okViaSelection = 0
let savedSel = getSelection(focused) // restore the user's cursor when we're done
print("\nPer-word bounds (first 12):  [direct = AXBoundsForRange, sel = selection trick]")
for (idx, w) in words.prefix(12).enumerated() {
    let label = w.2.padding(toLength: min(18, max(w.2.count, 6)), withPad: " ", startingAt: 0)
    let direct = boundsForRange(focused, location: w.0, length: w.1)
    let directGood = direct.map { $0.size.width > 0 && $0.size.height > 0 } ?? false
    if directGood, let r = direct {
        ok += 1
        print("  \(idx)  \(label)  direct: x=\(Int(r.origin.x)) y=\(Int(r.origin.y)) w=\(Int(r.size.width)) h=\(Int(r.size.height))")
    } else if let s = boundsViaSelection(focused, location: w.0, length: w.1) {
        okViaSelection += 1
        print("  \(idx)  \(label)  direct: ✗   sel: x=\(Int(s.origin.x)) y=\(Int(s.origin.y)) w=\(Int(s.size.width)) h=\(Int(s.size.height))")
    } else {
        print("  \(idx)  \(label)  direct: ✗   sel: ✗")
    }
}
// Put the cursor back where the user left it.
if let s = savedSel { _ = setSelection(focused, location: s.location, length: s.length) }

let total = min(words.count, 12)
let anyGood = ok + okViaSelection
print("\n── VERDICT for \(appName) ──")
print("direct (AXBoundsForRange): \(ok)/\(total)   |   selection trick: \(okViaSelection)/\(total)")
if ok == total {
    print("✅ Native overlay works directly (AXBoundsForRange). Easiest case.")
} else if anyGood == total && okViaSelection > 0 {
    print("✅ Native overlay works via the SELECTION trick (AXManualAccessibility + set-selection")
    print("   → AXBoundsForTextMarkerRange → restore cursor). This is how TextWarden/Harper do")
    print("   Slack/Teams. No browser extension needed for this app.")
} else if anyGood > 0 {
    print("⚠️  Partial (\(anyGood)/\(total)). Doable but needs per-app tuning + caching.")
} else {
    print("❌ Neither method works. This app (likely a browser web page) needs the extension.")
}
restoreAX()

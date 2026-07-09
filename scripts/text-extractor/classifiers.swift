import Foundation

// Pure string-heuristic classifiers for the text extractor. These have NO
// dependency on AXUIElement or the live accessibility system - they are plain
// String -> Bool functions, so they live here (framework-free, unit-testable)
// separate from the AX-tree walkers in common.swift. This file is the ONE
// source of truth for these functions: it is compiled into both the shipping
// text-extractor binary (see text-extractor.sh) and the TextExtractorKit
// SwiftPM test package (swift-tests/TextExtractorKit).

/// Check if text looks like a timestamp
func isTimestamp(_ text: String) -> Bool {
    let pattern = "^\\d{1,2}:\\d{2}\\s?(AM|PM)?$"
    return text.range(of: pattern, options: .regularExpression) != nil
}

/// Check if text looks like a URL or domain
func isLikelyURL(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return false }
    if trimmed.count < 4 || trimmed.count > 2048 { return false }
    if trimmed.contains(" ") { return false }

    let lower = trimmed.lowercased()
    if lower.contains("claude.ai") { return true }
    if lower.contains("chatgpt.com") { return true }
    if lower.contains("chat.openai.com") { return true }
    if lower.contains("gemini.google.com") { return true }
    if lower.contains("bard.google.com") { return true }
    if lower.hasPrefix("http://") || lower.hasPrefix("https://") { return true }

    let pattern = "^[a-z0-9.-]+\\.[a-z]{2,}(/[^\\s]*)?$"
    return lower.range(of: pattern, options: .regularExpression) != nil
}

func isClaudeURL(_ text: String) -> Bool {
    let lower = text.lowercased()
    return lower.contains("claude.ai")
}

func isGeminiURL(_ text: String) -> Bool {
    let lower = text.lowercased()
    return lower.contains("gemini.google.com") || lower.contains("bard.google.com")
}

func isChatGPTURL(_ text: String) -> Bool {
    let lower = text.lowercased()
    return lower.contains("chatgpt.com") || lower.contains("chat.openai.com")
}

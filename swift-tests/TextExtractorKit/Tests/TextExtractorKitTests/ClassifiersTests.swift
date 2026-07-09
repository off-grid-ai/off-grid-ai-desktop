import XCTest
@testable import TextExtractorKit

// One case per branch of the pure classifiers in classifiers.swift.
final class ClassifiersTests: XCTestCase {

    // MARK: - isTimestamp

    func testTimestampWithPMSuffix() {
        XCTAssertTrue(isTimestamp("3:45 PM"))
    }

    func testTimestampWithAMSuffix() {
        XCTAssertTrue(isTimestamp("11:05 AM"))
    }

    func testTimestampWithSuffixNoSpace() {
        // Optional whitespace before AM/PM.
        XCTAssertTrue(isTimestamp("3:45PM"))
    }

    func testTimestampBare24Hour() {
        XCTAssertTrue(isTimestamp("12:00"))
    }

    func testTimestampSingleDigitHour() {
        XCTAssertTrue(isTimestamp("9:30"))
    }

    func testTimestampRejectsExtraText() {
        // Anchored ^...$ - trailing text is not a match.
        XCTAssertFalse(isTimestamp("3:45 PM tomorrow"))
    }

    func testTimestampRejectsThreeDigitMinutes() {
        XCTAssertFalse(isTimestamp("3:456"))
    }

    func testTimestampRejectsNonTime() {
        XCTAssertFalse(isTimestamp("hello"))
    }

    func testTimestampRejectsEmpty() {
        XCTAssertFalse(isTimestamp(""))
    }

    // MARK: - isLikelyURL

    func testLikelyURLEmptyIsFalse() {
        XCTAssertFalse(isLikelyURL(""))
    }

    func testLikelyURLWhitespaceOnlyIsFalse() {
        // Trims to empty.
        XCTAssertFalse(isLikelyURL("   "))
    }

    func testLikelyURLTooShortIsFalse() {
        // "a.b" is 3 chars, under the 4 minimum.
        XCTAssertFalse(isLikelyURL("a.b"))
    }

    func testLikelyURLTooLongIsFalse() {
        let long = "http://" + String(repeating: "a", count: 3000) + ".com"
        XCTAssertFalse(isLikelyURL(long))
    }

    func testLikelyURLWithSpaceIsFalse() {
        XCTAssertFalse(isLikelyURL("hello world.com"))
    }

    func testLikelyURLClaudeDomain() {
        XCTAssertTrue(isLikelyURL("claude.ai/chat/123"))
    }

    func testLikelyURLChatGPTDomain() {
        XCTAssertTrue(isLikelyURL("chatgpt.com/c/abc"))
    }

    func testLikelyURLOpenAIDomain() {
        XCTAssertTrue(isLikelyURL("chat.openai.com/c/abc"))
    }

    func testLikelyURLGeminiDomain() {
        XCTAssertTrue(isLikelyURL("gemini.google.com/app"))
    }

    func testLikelyURLBardDomain() {
        XCTAssertTrue(isLikelyURL("bard.google.com/chat"))
    }

    func testLikelyURLHttpPrefix() {
        XCTAssertTrue(isLikelyURL("http://example.org"))
    }

    func testLikelyURLHttpsPrefix() {
        XCTAssertTrue(isLikelyURL("https://example.org"))
    }

    func testLikelyURLBareDomainMatchesPattern() {
        XCTAssertTrue(isLikelyURL("example.com"))
    }

    func testLikelyURLBareDomainWithPath() {
        XCTAssertTrue(isLikelyURL("example.com/path/to/thing"))
    }

    func testLikelyURLIsCaseInsensitiveForProviders() {
        XCTAssertTrue(isLikelyURL("HTTPS://Example.COM"))
        XCTAssertTrue(isLikelyURL("Claude.AI/foo"))
    }

    func testLikelyURLNonDomainTextIsFalse() {
        // Long enough, no space, but no dot+TLD and no scheme.
        XCTAssertFalse(isLikelyURL("justtext"))
    }

    func testLikelyURLTrimsSurroundingWhitespace() {
        XCTAssertTrue(isLikelyURL("  example.com  "))
    }

    // MARK: - isClaudeURL

    func testClaudeURLPositive() {
        XCTAssertTrue(isClaudeURL("https://claude.ai/chat/1"))
    }

    func testClaudeURLCaseInsensitive() {
        XCTAssertTrue(isClaudeURL("https://CLAUDE.AI/chat/1"))
    }

    func testClaudeURLNegative() {
        XCTAssertFalse(isClaudeURL("https://chatgpt.com"))
    }

    // MARK: - isGeminiURL

    func testGeminiURLGeminiDomain() {
        XCTAssertTrue(isGeminiURL("https://gemini.google.com/app"))
    }

    func testGeminiURLBardDomain() {
        XCTAssertTrue(isGeminiURL("https://bard.google.com"))
    }

    func testGeminiURLCaseInsensitive() {
        XCTAssertTrue(isGeminiURL("https://Gemini.Google.com"))
    }

    func testGeminiURLNegative() {
        XCTAssertFalse(isGeminiURL("https://claude.ai"))
    }

    // MARK: - isChatGPTURL

    func testChatGPTURLChatGPTDomain() {
        XCTAssertTrue(isChatGPTURL("https://chatgpt.com/c/1"))
    }

    func testChatGPTURLOpenAIDomain() {
        XCTAssertTrue(isChatGPTURL("https://chat.openai.com/c/1"))
    }

    func testChatGPTURLCaseInsensitive() {
        XCTAssertTrue(isChatGPTURL("https://ChatGPT.com"))
    }

    func testChatGPTURLNegative() {
        XCTAssertFalse(isChatGPTURL("https://gemini.google.com"))
    }
}

// swift-tools-version:5.7
import PackageDescription

// Test-only SwiftPM package that wraps the PURE string-heuristic classifiers
// from the text extractor so they can be unit-tested with XCTest, without
// pulling in AXUIElement / the live accessibility system.
//
// ONE source of truth: Sources/TextExtractorKit/classifiers.swift is a symlink
// to ../../scripts/text-extractor/classifiers.swift - the exact same file the
// shipping binary compiles (see scripts/text-extractor.sh). There is no copy.
//
// The library functions are `internal`, so the tests reach them via
// `@testable import TextExtractorKit`.
let package = Package(
    name: "TextExtractorKit",
    targets: [
        .target(name: "TextExtractorKit"),
        .testTarget(
            name: "TextExtractorKitTests",
            dependencies: ["TextExtractorKit"]
        )
    ]
)

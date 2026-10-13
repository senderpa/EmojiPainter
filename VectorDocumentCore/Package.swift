// swift-tools-version:5.9
import PackageDescription

// VectorDocumentCore — platform-neutral Swift core for iOS Vector Mode V3
// (per VectorModeIOSImplementationHandoff). Phase 0/1: versioned schema, Double
// world geometry, camera math, chunk keys, and the Mac emoji-painter.v4 migration
// reader. Standalone package so it builds/tests independently of the app target;
// wired into the Expo iOS target in a later phase behind a feature flag.
let package = Package(
  name: "VectorDocumentCore",
  platforms: [.iOS(.v14), .macOS(.v12)],
  products: [
    .library(name: "VectorDocumentCore", targets: ["VectorDocumentCore"]),
  ],
  targets: [
    .target(name: "VectorDocumentCore", path: "Sources/VectorDocumentCore"),
    .testTarget(
      name: "VectorDocumentCoreTests",
      dependencies: ["VectorDocumentCore"],
      path: "Tests/VectorDocumentCoreTests"
    ),
  ]
)

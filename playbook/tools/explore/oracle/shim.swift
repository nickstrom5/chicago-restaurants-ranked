// The one app type DataStore.swift needs from a file that can't build for macOS (Services/AppServices.swift imports UIKit).
// The oracle always shows the data it's given, as screenshot mode would.
enum ScreenshotMode { static let name: String? = nil }

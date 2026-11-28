import ExpoModulesCore
import Foundation

/// One run of the block's text, in one style (apps/mobile/src/selection/native-runs.ts).
struct TextRun: Decodable {
  let text: String
  let fontFamily: String
  /// 100 to 900, as React Native's `fontWeight`.
  let fontWeight: Int
  /// Points, before the reader's text size is applied (`fontScale`).
  let fontSize: Double
  let italic: Bool
  /// A colour as React Native's `processColor` gives it on iOS: 0xAARRGGBB.
  let color: Double
  let backgroundColor: Double?
  /// Inline code's chip: its background is rounded and as tall as its glyphs.
  let rounded: Bool
  let strikethrough: Bool
  /// A link's or a highlight's run: a tap on it is reported with `onPressRun`.
  let pressable: Bool
}

/// A VoiceOver action for a link or a highlight: its label, and the run `onPressRun` reports.
struct RunAction: Decodable {
  let name: String
  let index: Int
}

/// Decodes a JSON prop. The runs and actions come as JSON text, decoded here with the types
/// above, so no conversion step between JavaScript and Swift can drop a field silently.
func decodeProp<Value: Decodable>(_ type: Value.Type, from json: String) -> Result<Value, Error> {
  Result { try JSONDecoder().decode(type, from: Data(json.utf8)) }
}

/// Selectable document text: a non-editable `UITextView` drawn from styled runs, whose selection
/// menu adds "Comment" to the system's items (Copy, Look Up, …) and reports the selected range.
public final class SelectableTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SelectableText")

    View(SelectableTextView.self) {
      Events("onComment", "onPressRun", "onTextHeight")

      /// The runs, as JSON (`[TextRun]`).
      Prop("runs") { (view: SelectableTextView, json: String) in
        view.setRuns(json: json)
      }
      /// The block's line height in points, before `fontScale`.
      Prop("lineHeight") { (view: SelectableTextView, lineHeight: Double) in
        view.lineHeight = lineHeight
      }
      /// The reader's text size (Dynamic Type), as React Native applies it to `Text`.
      Prop("fontScale") { (view: SelectableTextView, fontScale: Double) in
        view.fontScale = fontScale
      }
      /// The selection menu item's title; absent, the menu has the system's items only.
      Prop("commentTitle") { (view: SelectableTextView, title: String?) in
        view.commentTitle = title
      }
      /// The links and highlights, as VoiceOver actions (the rotor's Actions), since VoiceOver
      /// cannot tap a run.
      Prop("actions") { (view: SelectableTextView, json: String) in
        view.actions = (try? decodeProp([RunAction].self, from: json).get()) ?? []
      }
      /// A heading, for VoiceOver.
      Prop("heading") { (view: SelectableTextView, heading: Bool) in
        view.heading = heading
      }

      OnViewDidUpdateProps { (view: SelectableTextView) in
        view.rebuild()
      }
    }
  }
}

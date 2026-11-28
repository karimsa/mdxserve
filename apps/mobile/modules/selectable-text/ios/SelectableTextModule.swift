import ExpoModulesCore

/// One run of the block's text, in one style (apps/mobile/src/selection/native-runs.ts).
struct TextRun: Record {
  @Field var text: String = ""
  @Field var fontFamily: String = ""
  /// 100 to 900, as React Native's `fontWeight`.
  @Field var fontWeight: Int = 400
  /// Points, before the reader's text size is applied (`fontScale`).
  @Field var fontSize: Double = 16
  @Field var italic: Bool = false
  /// A colour as React Native's `processColor` gives it on iOS: 0xAARRGGBB.
  @Field var color: Double = 0
  @Field var backgroundColor: Double?
  /// Inline code's chip: its background is rounded and as tall as its glyphs.
  @Field var rounded: Bool = false
  @Field var strikethrough: Bool = false
  /// A link's or a highlight's run: a tap on it is reported with `onPressRun`.
  @Field var pressable: Bool = false
}

/// Selectable document text: a non-editable `UITextView` drawn from styled runs, whose selection
/// menu adds "Comment" to the system's items (Copy, Look Up, …) and reports the selected range.
public final class SelectableTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SelectableText")

    View(SelectableTextView.self) {
      Events("onComment", "onPressRun", "onTextHeight")

      Prop("runs") { (view: SelectableTextView, runs: [TextRun]) in
        view.runs = runs
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

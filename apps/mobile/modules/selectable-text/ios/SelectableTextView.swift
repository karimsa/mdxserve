import ExpoModulesCore
import React
import UIKit

extension NSAttributedString.Key {
  /// The index of the run a character belongs to, for `onPressRun`.
  static let selectableTextRun = NSAttributedString.Key("SelectableTextRun")
  /// Set on inline code's chip: its background is drawn rounded, as tall as its glyphs.
  static let selectableTextRounded = NSAttributedString.Key("SelectableTextRounded")
}

/// Draws every background as TextKit does (over the whole line, as React Native's `Text` draws a
/// nested run's), except a chip's: a rounded box around the code's own glyphs. The room on each
/// side of a chip is letter spacing on the character before it and on its last character (JS
/// `CHIP_PADDING`); the run's rect already holds the trailing one, the box reaches into the leading.
final class RunLayoutManager: NSLayoutManager {
  /// `CHIP_PADDING` in native-runs.ts.
  static let chipPadding: CGFloat = 4
  /// The chip view in `Text` is a little shorter than the code's line: its box, trimmed each side.
  private static let trim: CGFloat = 0.5
  private static let radius: CGFloat = 3

  override func fillBackgroundRectArray(
    _ rectArray: UnsafePointer<CGRect>,
    count rectCount: Int,
    forCharacterRange charRange: NSRange,
    color: UIColor
  ) {
    guard let storage = textStorage,
      charRange.length > 0,
      NSMaxRange(charRange) <= storage.length,
      storage.attribute(.selectableTextRounded, at: charRange.location, effectiveRange: nil) as? Bool == true,
      let font = storage.attribute(.font, at: charRange.location, effectiveRange: nil) as? UIFont,
      let container = textContainers.first
    else {
      super.fillBackgroundRectArray(rectArray, count: rectCount, forCharacterRange: charRange, color: color)
      return
    }
    let glyphs = glyphRange(forCharacterRange: charRange, actualCharacterRange: nil)
    guard glyphs.length > 0 else { return }
    let shift = storage.attribute(.baselineOffset, at: charRange.location, effectiveRange: nil) as? CGFloat ?? 0
    color.setFill()
    for index in 0..<rectCount {
      let rect = rectArray[index]
      // The baseline of the line this rect is on: the glyph under its middle, clamped to the run.
      let hit = glyphIndex(for: CGPoint(x: rect.midX, y: rect.midY), in: container)
      let glyph = min(max(hit, glyphs.location), NSMaxRange(glyphs) - 1)
      let baseline = rect.minY + location(forGlyphAt: glyph).y - shift
      let box = CGRect(
        x: rect.minX - Self.chipPadding,
        y: baseline - font.ascender + Self.trim,
        width: rect.width + Self.chipPadding,
        height: font.ascender - font.descender - Self.trim * 2
      )
      UIBezierPath(roundedRect: box, cornerRadius: Self.radius).fill()
    }
  }
}

/// A block of document text the reader can select. The text is drawn by a non-editable,
/// non-scrolling `UITextView` on TextKit 1 with React Native's text settings (no line fragment
/// padding, no font leading, a fixed line height with the glyphs centred in it), so it wraps as
/// the same runs drawn by `Text` wrap. Its selection menu holds the system's items and, when
/// `commentTitle` is set, one more that reports the selection with `onComment`.
final class SelectableTextView: ExpoView, UITextViewDelegate, UIGestureRecognizerDelegate {
  let onComment = EventDispatcher()
  let onPressRun = EventDispatcher()
  let onTextHeight = EventDispatcher()

  private(set) var runs: [TextRun] = []
  /// Why the last `runs` could not be read, if they could not.
  private(set) var runsError: String?
  var lineHeight: Double = 0
  var fontScale: Double = 1
  var commentTitle: String?
  var heading = false
  var actions: [RunAction] = []

  /// The view holding a selection, so that selecting in another block clears it.
  private static weak var selecting: SelectableTextView?
  private static var fonts: [String: UIFont] = [:]
  /// How far below the prose's baseline a chip's code sits, as the chip view in `Text` puts it.
  private static let chipDrop: CGFloat = 1.5
  /// A press longer than this is the start of a selection, not a tap.
  private static let tapDuration: TimeInterval = 0.5

  private let storage = NSTextStorage()
  private let textView: UITextView
  private var reportedHeight: CGFloat = -1
  private var touchStart: TimeInterval = 0
  private var selectedAtTouch = false

  required init(appContext: AppContext? = nil) {
    let manager = RunLayoutManager()
    manager.usesFontLeading = false
    storage.addLayoutManager(manager)
    let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    container.widthTracksTextView = true
    manager.addTextContainer(container)
    // A text view made with its own container stays on TextKit 1, which React Native's text uses.
    textView = UITextView(frame: .zero, textContainer: container)
    super.init(appContext: appContext)

    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = false
    textView.showsVerticalScrollIndicator = false
    textView.showsHorizontalScrollIndicator = false
    textView.contentInsetAdjustmentBehavior = .never
    textView.textContainerInset = .zero
    textView.backgroundColor = .clear
    textView.clipsToBounds = false
    textView.dataDetectorTypes = []
    textView.linkTextAttributes = [:]
    textView.adjustsFontForContentSizeCategory = false
    // Dragging selected text out would fight the document's scrolling.
    textView.textDragInteraction?.isEnabled = false
    textView.delegate = self

    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.cancelsTouchesInView = false
    tap.delegate = self
    textView.addGestureRecognizer(tap)

    addSubview(textView)
  }

  // MARK: - Content

  func setRuns(json: String) {
    switch decodeProp([TextRun].self, from: json) {
    case .success(let decoded):
      runs = decoded
      runsError = nil
    case .failure(let error):
      runs = []
      runsError = String(describing: error)
    }
  }

  /// Builds the attributed text from the runs, as React Native builds a `Text`'s.
  func rebuild() {
    let scale = CGFloat(fontScale > 0 ? fontScale : 1)
    let line = CGFloat(lineHeight) * scale
    let paragraph = NSMutableParagraphStyle()
    if line > 0 {
      paragraph.minimumLineHeight = line
      paragraph.maximumLineHeight = line
    }
    let text = NSMutableAttributedString()
    var tallest: CGFloat = 0
    for (index, run) in runs.enumerated() {
      let font = Self.font(
        family: run.fontFamily,
        size: CGFloat(run.fontSize) * scale,
        weight: run.fontWeight,
        italic: run.italic
      )
      tallest = max(tallest, font.lineHeight)
      var attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: Self.color(run.color),
        .paragraphStyle: paragraph,
        .selectableTextRun: index,
      ]
      if let background = run.backgroundColor {
        attributes[.backgroundColor] = Self.color(background)
        if run.rounded {
          attributes[.selectableTextRounded] = true
        }
      }
      if run.strikethrough {
        attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      }
      if run.letterSpacing != 0 {
        attributes[.kern] = run.letterSpacing
      }
      text.append(NSAttributedString(string: run.text, attributes: attributes))
    }
    // React Native centres the glyphs in a line taller than the font (RCTApplyBaselineOffset).
    if line > 0, line >= tallest, text.length > 0 {
      let offset = (line - tallest) / 2
      text.addAttribute(.baselineOffset, value: offset, range: NSRange(location: 0, length: text.length))
      // A chip's code sits a little lower, as the chip view does; this moves glyphs, not lines.
      text.enumerateAttribute(.selectableTextRounded, in: NSRange(location: 0, length: text.length)) {
        value, range, _ in
        if value as? Bool == true {
          text.addAttribute(.baselineOffset, value: offset - Self.chipDrop, range: range)
        }
      }
    }
    // Through the text view's own setter, so it lays out and redraws as for any text it is given.
    textView.attributedText = text
    textView.setNeedsDisplay()
    textView.accessibilityTraits = heading ? [.staticText, .header] : .staticText
    textView.accessibilityCustomActions = actions.map { action in
      let index = action.index
      return UIAccessibilityCustomAction(name: action.name) { [weak self] _ in
        self?.onPressRun(["index": index])
        return true
      }
    }
    reportedHeight = -1
    setNeedsLayout()
  }

  /// The face React Native's text picks for a family, weight and style (RCTFontWithFontProperties):
  /// the family's face of that style closest in weight, else its first face.
  private static func font(family: String, size: CGFloat, weight: Int, italic: Bool) -> UIFont {
    let key = "\(family)/\(size)/\(weight)/\(italic)"
    if let cached = fonts[key] {
      return cached
    }
    let wanted = uiWeight(weight)
    var names = family.isEmpty ? [] : UIFont.fontNames(forFamilyName: family)
    if names.isEmpty, !family.isEmpty, let named = UIFont(name: family, size: size) {
      names = UIFont.fontNames(forFamilyName: named.familyName)
    }
    var best: UIFont?
    var closest = CGFloat.infinity
    for name in names {
      guard let candidate = UIFont(name: name, size: size) else {
        continue
      }
      if candidate.fontDescriptor.symbolicTraits.contains(.traitItalic) != italic {
        continue
      }
      let candidateWeight = RCTGetFontWeight(candidate)
      if abs(candidateWeight - wanted.rawValue) < abs(closest - wanted.rawValue) {
        best = candidate
        closest = candidateWeight
      }
    }
    let font =
      best ?? names.first.flatMap { UIFont(name: $0, size: size) }
      ?? UIFont.systemFont(ofSize: size, weight: wanted)
    fonts[key] = font
    return font
  }

  private static func uiWeight(_ weight: Int) -> UIFont.Weight {
    switch weight {
    case ..<150: return .ultraLight
    case ..<250: return .thin
    case ..<350: return .light
    case ..<450: return .regular
    case ..<550: return .medium
    case ..<650: return .semibold
    case ..<750: return .bold
    case ..<850: return .heavy
    default: return .black
    }
  }

  /// A colour from React Native's `processColor` on iOS (0xAARRGGBB).
  private static func color(_ value: Double) -> UIColor {
    let argb = UInt32(truncatingIfNeeded: Int64(value))
    return UIColor(
      red: CGFloat((argb >> 16) & 0xFF) / 255,
      green: CGFloat((argb >> 8) & 0xFF) / 255,
      blue: CGFloat(argb & 0xFF) / 255,
      alpha: CGFloat((argb >> 24) & 0xFF) / 255
    )
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    textView.frame = bounds
    guard bounds.width > 0 else {
      return
    }
    // The height the text needs at this width, for the block to grow if it needs more room than
    // the same runs laid out by React Native took.
    let manager = textView.layoutManager
    manager.ensureLayout(for: textView.textContainer)
    let height = manager.usedRect(for: textView.textContainer).height
    if abs(height - reportedHeight) >= 0.5 {
      reportedHeight = height
      onTextHeight(["height": height])
    }
  }

  // MARK: - Selection

  func textViewDidChangeSelection(_ textView: UITextView) {
    guard textView.selectedRange.length > 0 else {
      return
    }
    if let other = Self.selecting, other !== self {
      other.clearSelection()
    }
    Self.selecting = self
  }

  private func clearSelection() {
    textView.selectedRange = NSRange(location: 0, length: 0)
    textView.resignFirstResponder()
  }

  func textView(
    _ textView: UITextView,
    editMenuForTextIn range: NSRange,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    guard let title = commentTitle, range.length > 0 else {
      return UIMenu(children: suggestedActions)
    }
    let comment = UIAction(title: title, image: UIImage(systemName: "text.bubble")) { [weak self] _ in
      self?.comment(range)
    }
    // First, so it is on the menu's first page beside Copy.
    return UIMenu(children: [comment] + suggestedActions)
  }

  private func comment(_ menuRange: NSRange) {
    let current = textView.selectedRange
    let range = current.length > 0 ? current : menuRange
    guard range.length > 0, NSMaxRange(range) <= storage.length else {
      return
    }
    let text = (storage.string as NSString).substring(with: range)
    onComment([
      "start": range.location,
      "end": NSMaxRange(range),
      "text": text,
    ])
    clearSelection()
  }

  // MARK: - Taps on links and highlights

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return true
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    // A tap that only clears a selection opens nothing.
    selectedAtTouch = textView.selectedRange.length > 0
    touchStart = touch.timestamp
    return true
  }

  @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended,
      !selectedAtTouch,
      textView.selectedRange.length == 0,
      ProcessInfo.processInfo.systemUptime - touchStart < Self.tapDuration
    else {
      return
    }
    let manager = textView.layoutManager
    let container = textView.textContainer
    let point = recognizer.location(in: textView)
    let glyph = manager.glyphIndex(for: point, in: container)
    guard glyph < manager.numberOfGlyphs else {
      return
    }
    // Only a tap on the glyph itself, not past the end of its line.
    let bounds = manager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
    guard bounds.insetBy(dx: -4, dy: -4).contains(point) else {
      return
    }
    let character = manager.characterIndexForGlyph(at: glyph)
    guard character < storage.length,
      let index = storage.attribute(.selectableTextRun, at: character, effectiveRange: nil) as? Int,
      index < runs.count,
      runs[index].pressable
    else {
      return
    }
    onPressRun(["index": index])
  }
}

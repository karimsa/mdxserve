import type { LucideIcon } from "lucide-react";
// Deep per-file imports are deliberate, not an oversight: importing named
// icons from lucide-react's entry point pulls in its whole `icons` map (2,022
// icons, 1.15 MB pre-bundled in dev) regardless of tree-shaking, because Vite
// pre-bundles a package's entry module as a unit. Reaching straight into
// `dist/esm/icons/<name>.mjs` keeps each of these to exactly one icon.
//
// This is the static "chrome" tier of Icon.web.tsx: every name an
// mdxserve UI component passes to an icon prop, resolved synchronously with
// no dynamic import so the header, toolbars, callouts and toasts never flicker.
// Any other name (an author's `icon="rocket"` in a doc) falls through to
// `lucide-react/dynamicIconImports` and loads lazily.
//
// Regenerate the candidate list with (then review it — a literal on an
// icon-passing line is not always an icon name):
//   grep -rhE '(icon|Icon|name)[A-Za-z]*\s*[=:]' client --include='*.tsx' --include='*.ts' --exclude-dir=design-ref \
//     | grep -oE '"[a-z][a-z0-9-]*"' | tr -d '"' | sort -u \
//     | node -e '
//         const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
//         import("./node_modules/lucide-react/dynamicIconImports.mjs").then((mod) => {
//           const names = new Set(Object.keys(mod.default));
//           console.log(lines.filter((line) => names.has(line)).join("\n"));
//         });
//       '
// Two names live in a value map rather than on an icon-passing line and must
// be kept by hand: "arrow-down" / "arrow-up" (CodeBlock.tsx's flowchart
// direction glyphs). "check" and "chevron-down" are Dropdown.tsx's.
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import ArrowUpDown from "lucide-react/dist/esm/icons/arrow-up-down.mjs";
import ChartBar from "lucide-react/dist/esm/icons/chart-bar.mjs";
import ChartColumn from "lucide-react/dist/esm/icons/chart-column.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import Code from "lucide-react/dist/esm/icons/code.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Expand from "lucide-react/dist/esm/icons/expand.mjs";
import File from "lucide-react/dist/esm/icons/file.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus.mjs";
import ImageIcon from "lucide-react/dist/esm/icons/image.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import Lightbulb from "lucide-react/dist/esm/icons/lightbulb.mjs";
import ListChecks from "lucide-react/dist/esm/icons/list-checks.mjs";
import TableOfContents from "lucide-react/dist/esm/icons/table-of-contents.mjs";
import Maximize from "lucide-react/dist/esm/icons/maximize.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Minus from "lucide-react/dist/esm/icons/minus.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import OctagonAlert from "lucide-react/dist/esm/icons/octagon-alert.mjs";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left.mjs";
import PanelRight from "lucide-react/dist/esm/icons/panel-right.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import XIcon from "lucide-react/dist/esm/icons/x.mjs";

export const staticIcons: Record<string, LucideIcon> = {
	"arrow-down": ArrowDown,
	"arrow-left": ArrowLeft,
	"arrow-right": ArrowRight,
	"arrow-up": ArrowUp,
	"arrow-up-down": ArrowUpDown,
	"chart-bar": ChartBar,
	"chart-column": ChartColumn,
	check: Check,
	"chevron-down": ChevronDown,
	"chevron-right": ChevronRight,
	"circle-check": CircleCheck,
	code: Code,
	copy: Copy,
	expand: Expand,
	file: File,
	"file-text": FileText,
	folder: Folder,
	"folder-open": FolderOpen,
	"folder-plus": FolderPlus,
	image: ImageIcon,
	info: Info,
	lightbulb: Lightbulb,
	"list-checks": ListChecks,
	"table-of-contents": TableOfContents,
	maximize: Maximize,
	"message-square": MessageSquare,
	minus: Minus,
	moon: Moon,
	"octagon-alert": OctagonAlert,
	"panel-left": PanelLeft,
	"panel-right": PanelRight,
	pencil: Pencil,
	plus: Plus,
	"rotate-ccw": RotateCcw,
	search: Search,
	sparkles: Sparkles,
	sun: Sun,
	"trash-2": Trash2,
	"triangle-alert": TriangleAlert,
	user: User,
	x: XIcon,
};

import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Tabs from "@mdxserve/ui/builtins/Tabs";

const TABS = [
	{ id: "os>mac", value: "mac", label: "macOS", content: <Text>Use brew.</Text> },
	{ id: "os>linux", value: "linux", label: "Linux", content: <Text>Use apt.</Text> },
];

describe("the shared builtins on React Native", () => {
	it("draws a badge's label", async () => {
		await render(
			<Badge tone="ok" variant="soft" dot={true}>
				Online
			</Badge>,
		);
		expect(screen.getByText("Online")).toBeOnTheScreen();
	});

	it("titles a callout with its tone's label unless it has a title", async () => {
		await render(
			<Callout tone="warn">
				<Text>Mind the gap.</Text>
			</Callout>,
		);
		expect(screen.getByText("Careful")).toBeOnTheScreen();
		expect(screen.getByText("Mind the gap.")).toBeOnTheScreen();
	});

	it("shows the selected tab's panel and reports a press on another tab", async () => {
		const onSelect = jest.fn<(value: string) => void>();
		await render(<Tabs id="os" tabs={TABS} selected="mac" onSelect={onSelect} />);

		expect(screen.getByRole("tab", { name: "macOS", selected: true })).toBeOnTheScreen();
		expect(screen.getByRole("tab", { name: "Linux", selected: false })).toBeOnTheScreen();
		// Both panels stay mounted; the unselected one is not displayed.
		expect(screen.getByText("Use apt.")).toBeTruthy();

		await fireEvent.press(screen.getByRole("tab", { name: "Linux" }));
		expect(onSelect).toHaveBeenCalledWith("linux");
	});
});

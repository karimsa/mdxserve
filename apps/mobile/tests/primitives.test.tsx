import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Code, Heading, Link, Text } from "@mdxserve/ui/primitives/Text";

describe("the primitives on React Native", () => {
	it("marks a heading for VoiceOver", async () => {
		await render(<Heading level={2}>Install</Heading>);
		expect(screen.getByRole("heading", { name: "Install" })).toBeOnTheScreen();
	});

	it("keeps code and links as runs of the line around them", async () => {
		await render(
			<Text>
				Run <Code>mdxserve serve</Code>, then read <Link href="https://example.com">the guide</Link>
				.
			</Text>,
		);
		expect(screen.getByText("Run mdxserve serve, then read the guide.")).toBeOnTheScreen();
	});

	it("opens a link's address unless the caller handles the press", async () => {
		const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		const onPress = jest.fn();
		await render(
			<>
				<Link href="https://example.com">outside</Link>
				<Link href="/settings" onPress={onPress}>
					inside
				</Link>
			</>,
		);
		await fireEvent.press(screen.getByText("outside"));
		await fireEvent.press(screen.getByText("inside"));
		expect(openURL).toHaveBeenCalledWith("https://example.com");
		expect(openURL).toHaveBeenCalledTimes(1);
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("presses a button", async () => {
		const onPress = jest.fn();
		await render(
			<Pressable onPress={onPress} accessibilityLabel="Copy">
				<Text>Copy</Text>
			</Pressable>,
		);
		await fireEvent.press(screen.getByRole("button", { name: "Copy" }));
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("draws a lucide glyph by name and nothing for an unknown name", async () => {
		const { toJSON } = await render(<Icon name="circle-check" size="xl" />);
		// react-native-svg's native view, not the web's DOM <svg> (Icon.web.tsx).
		expect(JSON.stringify(toJSON())).toMatch(/"type":"RNSVG/);
		expect(JSON.stringify(toJSON())).toContain('"width":24');
		const unknown = await render(<Icon name="no-such-icon" />);
		expect(unknown.toJSON()).toBeNull();
	});
});

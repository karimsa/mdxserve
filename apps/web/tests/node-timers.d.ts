// The tests run server code, which keeps Node's timer handles (`NodeJS.Timeout`). React
// Native's global types, which this program loads through @mdxserve/ui, declare the same
// timers returning a number; restating Node's signatures here keeps them for that code.
declare global {
	function setTimeout<TArgs extends any[]>(
		callback: (...args: TArgs) => void,
		delay?: number,
		...args: TArgs
	): NodeJS.Timeout;
	function setInterval<TArgs extends any[]>(
		callback: (...args: TArgs) => void,
		delay?: number,
		...args: TArgs
	): NodeJS.Timeout;
}

export {};

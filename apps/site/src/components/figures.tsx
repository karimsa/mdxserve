/**
 * Static drawings of what the reader's Mermaid and Chart builtins produce.
 * They are plain SVG: no chart or diagram library ships with the site.
 */

export interface BarDatum {
	label: string;
	values: Record<string, number>;
}

export function BarChart({
	data,
	series,
	yLabel,
	xLabel,
	caption,
}: {
	data: BarDatum[];
	series: string[];
	yLabel: string;
	xLabel?: string;
	caption: string;
}) {
	const width = 560;
	const height = 260;
	const left = 44;
	const right = 12;
	const top = 16;
	const bottom = xLabel ? 52 : 36;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const maxValue = Math.max(...data.flatMap((datum) => series.map((name) => datum.values[name])));
	const ceiling = Math.ceil(maxValue / 2) * 2;
	const ticks = Array.from({ length: ceiling / 2 + 1 }, (_, index) => index * 2);
	const groupWidth = plotWidth / data.length;
	const barWidth = Math.min(28, (groupWidth * 0.7) / series.length);
	const scale = (value: number) => top + plotHeight - (value / ceiling) * plotHeight;

	return (
		<figure className="figure">
			<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption}>
				{ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={left}
							x2={width - right}
							y1={scale(tick)}
							y2={scale(tick)}
							className={tick === 0 ? "chart-axis" : "chart-grid"}
						/>
						<text x={left - 8} y={scale(tick) + 4} textAnchor="end" className="chart-label">
							{tick}
						</text>
					</g>
				))}
				{data.map((datum, groupIndex) => {
					const groupStart = left + groupIndex * groupWidth;
					const barsWidth = barWidth * series.length;
					return (
						<g key={datum.label}>
							{series.map((name, seriesIndex) => {
								const value = datum.values[name];
								const barX = groupStart + (groupWidth - barsWidth) / 2 + seriesIndex * barWidth;
								return (
									<rect
										key={name}
										x={barX + 1}
										y={scale(value)}
										width={barWidth - 2}
										height={scale(0) - scale(value)}
										rx={2}
										className={`chart-bar series-${seriesIndex + 1}`}
									>
										<title>{`${datum.label}, ${name}: ${value}`}</title>
									</rect>
								);
							})}
							<text
								x={groupStart + groupWidth / 2}
								y={scale(0) + 18}
								textAnchor="middle"
								className="chart-label"
							>
								{datum.label}
							</text>
						</g>
					);
				})}
				<text
					x={14}
					y={top + plotHeight / 2}
					textAnchor="middle"
					transform={`rotate(-90 14 ${top + plotHeight / 2})`}
					className="chart-label"
				>
					{yLabel}
				</text>
				{xLabel ? (
					<text x={left + plotWidth / 2} y={height - 8} textAnchor="middle" className="chart-label">
						{xLabel}
					</text>
				) : null}
			</svg>
			<figcaption>
				{series.length > 1 ? (
					<span className="chart-legend">
						{series.map((name, seriesIndex) => (
							<span key={name}>
								<span className={`legend-swatch series-${seriesIndex + 1}`} aria-hidden="true" />
								{name}
							</span>
						))}
					</span>
				) : null}
				{caption}
			</figcaption>
		</figure>
	);
}

export interface FlowNode {
	id: string;
	label: string;
	x: number;
	y: number;
}

/** A left-to-right flowchart with hand-placed nodes, drawn like the reader's Mermaid theme. */
export function Flowchart({
	nodes,
	edges,
	width,
	height,
	caption,
}: {
	nodes: FlowNode[];
	edges: [string, string][];
	width: number;
	height: number;
	caption: string;
}) {
	const nodeWidth = 168;
	const nodeHeight = 44;
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return (
		<figure className="figure">
			<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption}>
				<defs>
					<marker
						id="flow-arrow"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrowhead" />
					</marker>
				</defs>
				{edges.map(([from, to]) => {
					const source = byId.get(from);
					const target = byId.get(to);
					if (!source || !target) return null;
					const startX = source.x + nodeWidth;
					const startY = source.y + nodeHeight / 2;
					const endX = target.x - 2;
					const endY = target.y + nodeHeight / 2;
					const middleX = (startX + endX) / 2;
					return (
						<path
							key={`${from}-${to}`}
							d={`M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`}
							className="flow-edge"
							markerEnd="url(#flow-arrow)"
						/>
					);
				})}
				{nodes.map((node) => (
					<g key={node.id}>
						<rect
							x={node.x}
							y={node.y}
							width={nodeWidth}
							height={nodeHeight}
							rx={6}
							className="flow-node"
						/>
						<text
							x={node.x + nodeWidth / 2}
							y={node.y + nodeHeight / 2 + 5}
							textAnchor="middle"
							className="flow-label"
						>
							{node.label}
						</text>
					</g>
				))}
			</svg>
			<figcaption>{caption}</figcaption>
		</figure>
	);
}

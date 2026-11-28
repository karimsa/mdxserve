// An HTML file required as an asset is an asset module id (Metro's assetExts include html).
declare module "*.html" {
	const assetId: number;
	export default assetId;
}

// So is an image (the diagram view's bar icons, assets/bar-icons/).
declare module "*.png" {
	const assetId: number;
	export default assetId;
}

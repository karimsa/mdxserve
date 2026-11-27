import { serverInfoSchema } from "@mdxserve/shared/server-info";
import { procedure } from "../api/trpc.js";

const getServerInfo = procedure(
	"Returns this server's id, name, version, permissions mode, mermaid version, document tree schema version and the tailnet addresses `tailscale serve` publishes it under. Never a mounted folder's name or path. Used by the app to identify a server and to check that an address still reaches the same one.",
)
	.output(serverInfoSchema)
	.query(({ ctx }) => ctx.serverInfo.info().info);

export const serverInfoController = { getServerInfo };

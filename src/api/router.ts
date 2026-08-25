import { router } from "./trpc.js";
import { listingController } from "../listing/controller.js";
import { searchController } from "../search/controller.js";
import { trashController } from "../trash/controller.js";
import { validationController } from "../validation/controller.js";
import { docsController } from "../docs/controller.js";
import { componentsController } from "../components/controller.js";

export const appRouter = router({
	...listingController,
	...searchController,
	...trashController,
	...validationController,
	...docsController,
	...componentsController,
});

export type AppRouter = typeof appRouter;

import { router } from "./trpc.js";
import { listingController } from "../listing/controller.js";
import { searchController } from "../search/controller.js";
import { trashController } from "../trash/controller.js";
import { validationController } from "../validation/controller.js";
import { docsController } from "../docs/controller.js";
import { componentsController } from "../components/controller.js";
import { rootsController } from "../roots/controller.js";
import { exportController } from "../export/controller.js";

import { diagramsController } from "../diagrams/controller.js";

export const appRouter = router({
	...listingController,
	...diagramsController,
	...searchController,
	...trashController,
	...validationController,
	...docsController,
	...componentsController,
	...rootsController,
	...exportController,
});

export type AppRouter = typeof appRouter;

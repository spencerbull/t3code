import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "./auth/http.ts";
import * as OmarchyTheme from "./omarchyTheme.ts";

export const hostThemeHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "server",
  Effect.fnUntraced(function* (handlers) {
    const omarchyTheme = yield* OmarchyTheme.OmarchyTheme;
    return handlers.handle(
      "refreshHostTheme",
      Effect.fn("environment.server.refreshHostTheme")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* omarchyTheme.refresh;
      }),
    );
  }),
);

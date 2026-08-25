import {
  AuthAdministrativeScopes,
  EnvironmentHttpApi,
  type HostThemeRefreshResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { discoverPairTarget, makePairServerConfig } from "./pair.ts";

export class ThemeRefreshRequestError extends Schema.TaggedErrorClass<ThemeRefreshRequestError>()(
  "ThemeRefreshRequestError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to refresh the running server's host theme.";
  }
}

export function formatThemeRefreshOutput(result: HostThemeRefreshResult, json: boolean): string {
  if (json) return JSON.stringify(result);
  switch (result.status) {
    case "updated":
      return "Host theme updated.";
    case "unchanged":
      return "Host theme unchanged.";
    case "unavailable":
      return "Host theme unavailable.";
  }
}

export const requestHostThemeRefresh = Effect.fn("theme.requestHostThemeRefresh")(function* (
  origin: string,
  bearerToken: string,
) {
  const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
  return yield* client.server
    .refreshHostTheme({
      headers: { authorization: `Bearer ${bearerToken}` },
      payload: {},
    })
    .pipe(Effect.mapError((cause) => new ThemeRefreshRequestError({ cause })));
});

const withThemeCliSession = <A, E, R>(
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    environmentAuth.issueSession({
      scopes: AuthAdministrativeScopes,
      label: "t3 theme refresh",
    }),
    (issued) => run(issued.token),
    (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const themeRefreshCommand = Command.make("refresh", {
  json: Flag.boolean("json").pipe(
    Flag.withDescription("Print the refresh result as JSON."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Refresh the running server's host theme."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const cliLogLevel = yield* GlobalFlag.LogLevel;
      const logLevel = Option.getOrElse(cliLogLevel, () => "Warn" as const);
      const target = yield* discoverPairTarget(undefined);
      const config = yield* makePairServerConfig({ target, logLevel });
      const minimumLogLevel = config.logLevel;

      const result = yield* Effect.gen(function* () {
        const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
        return yield* withThemeCliSession(environmentAuth, (token) =>
          requestHostThemeRefresh(target.state.origin, token),
        );
      }).pipe(
        Effect.provide(
          EnvironmentAuth.runtimeLayer.pipe(
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
          ),
        ),
      );

      yield* Console.log(formatThemeRefreshOutput(result, flags.json));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  ),
);

export const themeCommand = Command.make("theme").pipe(
  Command.withDescription("Manage host theme integration."),
  Command.withSubcommands([themeRefreshCommand]),
);

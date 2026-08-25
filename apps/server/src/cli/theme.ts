import {
  AuthAdministrativeScopes,
  EnvironmentHttpApi,
  EnvironmentHttpCommonError,
  type HostThemeRefreshResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { baseDirFlag } from "./config.ts";
import { discoverPairTarget, makePairServerConfig } from "./pair.ts";

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export class ThemeRefreshDeclaredResponseError extends Schema.TaggedErrorClass<ThemeRefreshDeclaredResponseError>()(
  "ThemeRefreshDeclaredResponseError",
  {
    code: Schema.String,
    traceId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Host theme refresh failed (${this.code}, trace ${this.traceId}).`;
  }
}

export class ThemeRefreshUndeclaredStatusError extends Schema.TaggedErrorClass<ThemeRefreshUndeclaredStatusError>()(
  "ThemeRefreshUndeclaredStatusError",
  {
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Host theme refresh failed with undeclared status ${this.status}.`;
  }
}

export class ThemeRefreshRequestError extends Schema.TaggedErrorClass<ThemeRefreshRequestError>()(
  "ThemeRefreshRequestError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to refresh the running server's host theme.";
  }
}

export type ThemeRefreshError =
  | ThemeRefreshDeclaredResponseError
  | ThemeRefreshUndeclaredStatusError
  | ThemeRefreshRequestError;

/** Same classification as projectCommandErrorFromLiveServerRequest: declared
 * code/trace errors and undeclared HTTP statuses keep their identity; only
 * transport failures collapse into the generic request error. */
export function themeRefreshErrorFromRequest(cause: unknown): ThemeRefreshError {
  if (isEnvironmentHttpCommonError(cause)) {
    return new ThemeRefreshDeclaredResponseError({
      code: cause.code,
      traceId: cause.traceId,
      cause,
    });
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    return new ThemeRefreshUndeclaredStatusError({
      status: cause.response.status,
      cause,
    });
  }
  return new ThemeRefreshRequestError({ cause });
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

const THEME_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(10);

const withThemeCliLiveServerTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout(THEME_CLI_LIVE_SERVER_TIMEOUT));

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
    .pipe(withThemeCliLiveServerTimeout, Effect.mapError(themeRefreshErrorFromRequest));
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
  baseDir: baseDirFlag,
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
      const target = yield* discoverPairTarget(Option.getOrUndefined(flags.baseDir));
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

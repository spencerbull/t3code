// @effect-diagnostics nodeBuiltinImport:off - the CLI request test owns an isolated HTTP server.
import * as NodeHttp from "node:http";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { EnvironmentInternalError } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { cli } from "../bin.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import {
  formatThemeRefreshOutput,
  requestHostThemeRefresh,
  themeRefreshErrorFromRequest,
  ThemeRefreshDeclaredResponseError,
  ThemeRefreshRequestError,
  ThemeRefreshUndeclaredStatusError,
} from "./theme.ts";

describe("t3 theme refresh", () => {
  it.effect("sends only an authenticated empty request and decodes the status", () =>
    Effect.acquireUseRelease(
      Effect.callback<{
        readonly origin: string;
        readonly server: NodeHttp.Server;
        readonly request: Promise<{
          method: string;
          url: string;
          authorization: string;
          body: string;
        }>;
      }>((resume) => {
        let resolveRequest!: (request: {
          method: string;
          url: string;
          authorization: string;
          body: string;
        }) => void;
        const request = new Promise<{
          method: string;
          url: string;
          authorization: string;
          body: string;
        }>((resolve) => {
          resolveRequest = resolve;
        });
        const server = NodeHttp.createServer((incoming, response) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          incoming.on("end", () => {
            resolveRequest({
              method: incoming.method ?? "",
              url: incoming.url ?? "",
              authorization: incoming.headers.authorization ?? "",
              body: Buffer.concat(chunks).toString("utf8"),
            });
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ status: "unchanged" }));
          });
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            resume(Effect.die(new Error("Expected a TCP address")));
            return;
          }
          resume(
            Effect.succeed({
              origin: `http://127.0.0.1:${String(address.port)}`,
              server,
              request,
            }),
          );
        });
      }),
      ({ origin, request }) =>
        Effect.gen(function* () {
          const result = yield* requestHostThemeRefresh(origin, "test-token");
          const received = yield* Effect.promise(() => request);

          assert.deepEqual(result, { status: "unchanged" });
          assert.equal(received.method, "POST");
          assert.equal(received.url, "/api/server/theme/refresh");
          assert.equal(received.authorization, "Bearer test-token");
          assert.equal(received.body, "{}");
        }).pipe(Effect.provide(FetchHttpClient.layer)),
      ({ server }) =>
        Effect.callback<void>((resume) => {
          server.close(() => resume(Effect.void));
        }),
    ),
  );

  it("formats every human and JSON result", () => {
    assert.equal(formatThemeRefreshOutput({ status: "updated" }, false), "Host theme updated.");
    assert.equal(formatThemeRefreshOutput({ status: "unchanged" }, false), "Host theme unchanged.");
    assert.equal(
      formatThemeRefreshOutput({ status: "unavailable" }, false),
      "Host theme unavailable.",
    );
    assert.equal(formatThemeRefreshOutput({ status: "updated" }, true), '{"status":"updated"}');
  });

  it.effect("times out a live server that accepts the refresh request but never responds", () =>
    Effect.acquireUseRelease(
      Effect.callback<{
        readonly origin: string;
        readonly requestReceived: Promise<void>;
        readonly server: NodeHttp.Server;
      }>((resume) => {
        let markRequestReceived!: () => void;
        const requestReceived = new Promise<void>((resolve) => {
          markRequestReceived = resolve;
        });
        const server = NodeHttp.createServer((request) => {
          request.resume();
          request.on("end", markRequestReceived);
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            resume(Effect.die(new Error("Expected a TCP address")));
            return;
          }
          resume(
            Effect.succeed({
              origin: `http://127.0.0.1:${String(address.port)}`,
              requestReceived,
              server,
            }),
          );
        });
      }),
      ({ origin, requestReceived }) =>
        Effect.gen(function* () {
          const errorFiber = yield* requestHostThemeRefresh(origin, "test-token").pipe(
            Effect.provide(FetchHttpClient.layer),
            Effect.flip,
            Effect.forkScoped,
          );
          yield* Effect.promise(() => requestReceived);
          yield* TestClock.adjust(Duration.seconds(10));
          const error = yield* Fiber.join(errorFiber);

          assert.instanceOf(error, ThemeRefreshRequestError);
          assert.isTrue(Cause.isTimeoutError(error.cause));
        }),
      ({ server }) =>
        Effect.callback<void>((resume) => {
          server.closeAllConnections();
          server.close(() => resume(Effect.void));
        }),
    ).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it("keeps declared server failures structural with their code and trace", () => {
    const cause = new EnvironmentInternalError({
      code: "internal_error",
      reason: "internal_error",
      traceId: "trace-123",
    });

    const error = themeRefreshErrorFromRequest(cause);

    assert.instanceOf(error, ThemeRefreshDeclaredResponseError);
    assert.strictEqual(error.code, "internal_error");
    assert.strictEqual(error.traceId, "trace-123");
    assert.strictEqual(
      error.message,
      "Host theme refresh failed (internal_error, trace trace-123).",
    );
    assert.strictEqual(error.cause, cause);
  });

  it("keeps the HTTP status of undeclared response failures", () => {
    const request = HttpClientRequest.post("http://127.0.0.1:1/api/server/theme/refresh");
    const response = HttpClientResponse.fromWeb(
      request,
      new Response("bad gateway", { status: 502 }),
    );
    const cause = new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({ request, response }),
    });

    const error = themeRefreshErrorFromRequest(cause);

    assert.instanceOf(error, ThemeRefreshUndeclaredStatusError);
    assert.strictEqual(error.status, 502);
    assert.strictEqual(error.message, "Host theme refresh failed with undeclared status 502.");
    assert.strictEqual(error.cause, cause);
  });

  it("preserves transport failures without deriving the message from them", () => {
    const cause = new Error("credential abc123 was rejected");

    const error = themeRefreshErrorFromRequest(cause);

    assert.instanceOf(error, ThemeRefreshRequestError);
    assert.strictEqual(error.message, "Failed to refresh the running server's host theme.");
    assert.strictEqual(error.cause, cause);
  });
});

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* effect;
    return (
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      ""
    );
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const testDescriptor = {
  environmentId: "theme-test-environment",
  label: "theme-test",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.1",
  capabilities: { repositoryIdentity: true },
};

/** Answers discovery's descriptor probe and the theme refresh endpoint. */
const withThemeServer = <A, E, R>(
  run: (input: {
    readonly origin: string;
    readonly refreshAuthorizations: ReadonlyArray<string>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.callback<{ server: NodeHttp.Server; refreshAuthorizations: Array<string> }>((resume) => {
      const refreshAuthorizations: Array<string> = [];
      const server = NodeHttp.createServer((request, response) => {
        if (request.method === "GET" && request.url === "/.well-known/t3/environment") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(testDescriptor));
          return;
        }
        if (request.method === "POST" && request.url === "/api/server/theme/refresh") {
          refreshAuthorizations.push(request.headers.authorization ?? "");
          request.resume();
          request.on("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ status: "updated" }));
          });
          return;
        }
        response.writeHead(404);
        response.end();
      });
      server.listen(0, "127.0.0.1", () =>
        resume(Effect.succeed({ server, refreshAuthorizations })),
      );
    }),
    ({ server, refreshAuthorizations }) => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        return Effect.die(new Error("Expected a TCP address"));
      }
      return run({
        origin: `http://127.0.0.1:${String(address.port)}`,
        refreshAuthorizations,
      });
    },
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      }),
  );

describe("t3 theme refresh --base-dir", () => {
  it.effect("discovers the server recorded under an explicit base dir", () =>
    withThemeServer(({ origin, refreshAuthorizations }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // Scoped so the runtime-state file and the ephemeral auth database the
        // CLI creates under it are removed even when an assertion fails.
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-theme-refresh-" });
        const statePath = path.join(baseDir, "userdata", "server-runtime.json");
        yield* persistServerRuntimeState({
          path: statePath,
          state: yield* makePersistedServerRuntimeState({
            config: { host: "127.0.0.1", devUrl: undefined },
            port: Number(new URL(origin).port),
          }),
        });

        const output = yield* captureStdout(runCli(["theme", "refresh", "--base-dir", baseDir]));

        assert.equal(output, "Host theme updated.");
        assert.equal(refreshAuthorizations.length, 1);
        assert.isTrue(refreshAuthorizations[0]?.startsWith("Bearer "));
      }).pipe(Effect.scoped),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

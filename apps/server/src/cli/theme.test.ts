// @effect-diagnostics nodeBuiltinImport:off - the CLI request test owns an isolated HTTP server.
import * as NodeHttp from "node:http";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

import { formatThemeRefreshOutput, requestHostThemeRefresh } from "./theme.ts";

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
});

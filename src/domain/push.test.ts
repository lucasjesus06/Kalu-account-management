import { describe, expect, it } from "vitest";
import { parsePushSubscription } from "./push";

const valid = { endpoint: "https://push.example.com/abc", keys: { p256dh: "BKey", auth: "authKey" } };

describe("parsePushSubscription", () => {
  it("aceita uma inscrição válida", () => {
    expect(parsePushSubscription(valid)).toEqual({ endpoint: "https://push.example.com/abc", p256dh: "BKey", auth: "authKey" });
  });

  it.each([
    ["nulo", null],
    ["texto", "x"],
    ["sem chaves", { endpoint: valid.endpoint }],
    ["chave vazia", { ...valid, keys: { p256dh: "", auth: "a" } }],
    ["chave de tipo errado", { ...valid, keys: { p256dh: 1, auth: "a" } }],
    ["endpoint http", { ...valid, endpoint: "http://push.example.com/abc" }],
    ["endpoint inválido", { ...valid, endpoint: "não é url" }],
    ["campo enorme", { ...valid, keys: { p256dh: "x".repeat(2000), auth: "a" } }],
  ])("recusa %s", (_name, input) => {
    expect(parsePushSubscription(input)).toBeNull();
  });
});

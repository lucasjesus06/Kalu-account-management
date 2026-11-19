import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "./crypto";

const chave = () => randomBytes(32).toString("base64");

describe("crypto", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", chave());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recupera o texto original", () => {
    const segredo = "pluggy_sk_exemplo_123";
    expect(decrypt(encrypt(segredo))).toBe(segredo);
  });

  it("gera resultados diferentes para o mesmo texto", () => {
    expect(encrypt("mesmo texto")).not.toBe(encrypt("mesmo texto"));
  });

  it("não guarda o texto original no resultado", () => {
    expect(encrypt("pluggy_sk_exemplo_123")).not.toContain("pluggy_sk");
  });

  it("rejeita dado adulterado", () => {
    const [versao, iv, tag, conteudo] = encrypt("segredo").split(":");
    const adulterado = Buffer.from(conteudo, "base64url");
    adulterado[0] ^= 1;
    expect(() => decrypt([versao, iv, tag, adulterado.toString("base64url")].join(":"))).toThrow();
  });

  it("rejeita descriptografia com outra chave", () => {
    const cifrado = encrypt("segredo");
    vi.stubEnv("ENCRYPTION_KEY", chave());
    expect(() => decrypt(cifrado)).toThrow();
  });

  it("rejeita formato inválido", () => {
    expect(() => decrypt("texto-sem-formato")).toThrow("Formato de dado criptografado inválido");
  });

  it("exige a chave configurada", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encrypt("segredo")).toThrow("ENCRYPTION_KEY não configurada");
  });

  it("exige chave de 32 bytes", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encrypt("segredo")).toThrow("32 bytes");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { appConfig, DEFAULT_PUBLIC_BASE_URL } from "./app-config";

// Regression: the secure report link used to point at :5191 (Clinic docs server) while the Lab web runs on :5193.
test("publicBaseUrl defaults to the Lab web dev port (5193), never 5191", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  try {
    assert.equal(DEFAULT_PUBLIC_BASE_URL, "http://localhost:5193");
    assert.equal(appConfig.publicBaseUrl(), "http://localhost:5193");
    assert.ok(!appConfig.publicBaseUrl().includes("5191"));
  } finally { if (prev !== undefined) process.env.PUBLIC_BASE_URL = prev; }
});

test("publicBaseUrl is derived from PUBLIC_BASE_URL, trailing slashes trimmed, blank falls back", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  try {
    process.env.PUBLIC_BASE_URL = "https://lab.example.test///";
    assert.equal(appConfig.publicBaseUrl(), "https://lab.example.test");
    process.env.PUBLIC_BASE_URL = "   ";
    assert.equal(appConfig.publicBaseUrl(), DEFAULT_PUBLIC_BASE_URL);
  } finally { if (prev === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prev; }
});

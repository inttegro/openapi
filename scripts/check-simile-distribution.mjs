import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const openapiDir = resolve(scriptDir, "..");
const simile = process.env.SIMILE_BIN ?? resolve(openapiDir, "../simile/target/debug/simile");
const work = mkdtempSync(resolve(tmpdir(), "inttegro-simile-distribution-"));
const distribution = resolve(work, "public-contract");
const simileDir = resolve(distribution, "simile");
const environment = { SIMILE_HOME: resolve(work, "simile-home") };
const publicFiles = [
  "principals.hcl",
  "behaviors.hcl",
  "errors.hcl",
  "state.hcl",
  "faults.hcl",
  "inttegro.simile.hcl",
  "README.md",
];

if (!existsSync(simile)) {
  throw new Error(`Simile binary not found at ${simile}; set SIMILE_BIN to override it`);
}

try {
  mkdirSync(simileDir, { recursive: true });
  copyFileSync(resolve(openapiDir, "commerce.yml"), resolve(distribution, "commerce.yml"));
  for (const file of publicFiles) {
    copyFileSync(resolve(openapiDir, "simile", file), resolve(simileDir, file));
  }

  const configuration = resolve(simileDir, "inttegro.simile.hcl");
  // Why: a passing monorepo test can accidentally depend on source files, generated artifacts, or
  // package dependencies that customers do not receive. Compile from only the published bundle.
  const descriptionOutput = runSimile([
    "describe",
    "service",
    "inttegro",
    "--config",
    configuration,
    "--output",
    "json",
  ]).stdout;
  assert.ok(
    !descriptionOutput.includes(openapiDir),
    "clean-room service description retained a path into the provider monorepo",
  );
  const description = JSON.parse(descriptionOutput);
  assert.equal(description.operationCount, 135, "clean-room composition lost public operations");

  runSimile([
    "register",
    "inttegro",
    "--config",
    configuration,
    "--output",
    "json",
  ]);
  const setup = JSON.parse(runSimile([
    "setup",
    "inttegro",
    "--profile",
    "customer-contract-test",
    "--set",
    "name=Customer contract test",
    "--set",
    "alias=customer-contract-test",
    "--output",
    "json",
  ]).stdout);
  const credentials = readFileSync(setup.credentialsFile, "utf8");
  const credential = credentials.match(/^API_KEY="([^"]+)"$/m)?.[1];
  assert.ok(credential?.startsWith("simile_test_"), "clean-room setup issued no bearer credential");

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const service = spawn(simile, ["start", "inttegro", "--port", String(port)], {
    cwd: distribution,
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  service.stdout.on("data", (chunk) => { output += chunk; });
  service.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const publicResponse = await waitForService(service, `${baseUrl}/spec/countries`, () => output);
    assert.equal(publicResponse.status, 200, "clean-room public operation failed");
    const authenticatedResponse = await fetch(`${baseUrl}/apps/lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
    });
    assert.equal(authenticatedResponse.status, 200, "clean-room authenticated operation failed");
  } finally {
    await stopService(service);
  }

  console.log("Public Simile distribution verified in a clean room: compile, setup, public request, and authenticated request passed");
} finally {
  // Why: the bundle test must leave no credentials or state database behind on developer and CI hosts.
  rmSync(work, { recursive: true, force: true });
}

function runSimile(arguments_) {
  const result = spawnSync(simile, arguments_, {
    cwd: distribution,
    encoding: "utf8",
    env: { ...process.env, SIMILE_COLOR: "never", ...environment },
  });
  if (result.status !== 0) {
    throw new Error(
      `simile ${arguments_.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (port === undefined) reject(new Error("could not allocate an HTTP test port"));
        else resolvePort(port);
      });
    });
  });
}

async function waitForService(service, url, serviceOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.exitCode !== null) {
      throw new Error(`Simile service exited before readiness\n${serviceOutput()}`);
    }
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error(`Simile service did not become ready\n${serviceOutput()}`);
}

async function stopService(service) {
  if (service.exitCode !== null) return;
  const exited = new Promise((resolveExit) => service.once("exit", resolveExit));
  service.kill("SIGINT");
  await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
  if (service.exitCode === null) service.kill("SIGTERM");
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pnpm = ["npx", "pnpm@10.26.2"];
const appPresets = {
  chatgpt: {
    url: "https://chatgpt.com/",
    name: "ChatGPT Pake",
    "performance-profile": "chatgpt",
  },
  amazon: {
    url: "https://www.amazon.co.jp/",
    name: "Amazon Pake",
  },
};

const helpText = `Usage:
  node scripts/pake-ops.mjs build-app --url <url> --name <app name> [--install]
  node scripts/pake-ops.mjs build-app --preset <chatgpt|amazon> [--install]
  node scripts/pake-ops.mjs install-dmg --dmg <path-to-dmg> [--dry-run]
  node scripts/pake-ops.mjs verify-download-fix [--install]
  node scripts/pake-ops.mjs verify [--install] [--test <path>] [--prettier <path>] [--cli-build]

Commands:
  build-app
    Trigger the personal GitHub Actions workflow, watch it, download artifacts,
    validate macOS DMGs, and optionally install the first DMG into /Applications.

    Defaults:
      --repo w-maruoka/Pake
      --workflow "Build My Pake App"
      --ref main
      --platform macos-latest
      --width 1200
      --height 800
      --app-version 1.0.0
      --fullscreen false
      --hide-title-bar true
      --multi-arch true
      --macos-target universal
      --windows-target x64
      --linux-targets appimage
      --force-internal-navigation false
      --new-window false
      --inject ""

    Speed shortcuts:
      --preset chatgpt|amazon   Fill --url and --name for common personal apps.
      --app-version auto        Bump the installed app's patch version.
      --quit-running            Quit the app before installing the new DMG.
      --new-window              Allow popup windows for authentication flows.
      --inject                  Comma-separated repository paths to JS/CSS files.
      --performance-profile     Runtime profile: default or chatgpt.
      --dry-run                 Print the planned workflow/install commands only.

    Useful examples:
      node scripts/pake-ops.mjs build-app --url https://chatgpt.com/ --name "ChatGPT Pake" --app-version 1.0.1 --install
      node scripts/pake-ops.mjs build-app --preset chatgpt --app-version auto --install --quit-running
      node scripts/pake-ops.mjs build-app --preset chatgpt --performance-profile default --dry-run
      node scripts/pake-ops.mjs build-app --url https://www.amazon.co.jp/ --name "Amazon Pake" --install
      node scripts/pake-ops.mjs build-app --run-id 28696551338 --name "ChatGPT Pake" --install

  install-dmg
    Validate and mount a DMG, copy the contained .app into /Applications, read
    the installed bundle name/version/identifier, then detach the DMG.

  verify-download-fix
    Run the lightweight checks used for Pake download/link-handling edits:
      - vitest tests/unit/event-link-guard.test.js
      - prettier check for event.js and the matching unit test
      - pnpm run cli:build

  verify
    Generic local verification wrapper. Repeat --test and --prettier as needed.
`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function quote(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function formatCommand(bin, args) {
  return [bin, ...args].map((part) => quote(String(part))).join(" ");
}

function logCommand(bin, args) {
  console.error(`$ ${formatCommand(bin, args)}`);
}

function run(bin, args, options = {}) {
  logCommand(bin, args);
  const result = spawnSync(bin, args, {
    cwd: options.cwd || repoRoot,
    stdio: options.stdio || "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    fail(`${bin} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  return result;
}

function runCapture(bin, args, options = {}) {
  logCommand(bin, args);
  const result = spawnSync(bin, args, {
    cwd: options.cwd || repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.error) {
    fail(`${bin} failed to start: ${result.error.message}`);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  return result.stdout || "";
}

function parseArgs(rawArgs) {
  const args = [...rawArgs];
  const command = args.shift();
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    if (token.startsWith("--no-")) {
      options[token.slice(5)] = false;
      continue;
    }

    const eqIndex = token.indexOf("=");
    const key = eqIndex === -1 ? token.slice(2) : token.slice(2, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : token.slice(eqIndex + 1);
    const next = args[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : next && !next.startsWith("--")
          ? args[++index]
          : true;

    if (key === "test" || key === "prettier") {
      options[key] = [...(options[key] || []), String(value)];
    } else {
      options[key] = value;
    }
  }

  return { command, options };
}

function opt(options, name, fallback) {
  return options[name] === undefined ? fallback : options[name];
}

function boolOpt(options, name, fallback = false) {
  const value = opt(options, name, fallback);
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function applyPreset(options) {
  const presetName = options.preset
    ? String(options.preset).trim().toLowerCase()
    : "";
  if (!presetName) {
    return options;
  }

  const preset = appPresets[presetName];
  if (!preset) {
    fail(
      `Unknown preset: ${options.preset}. Available presets: ${Object.keys(
        appPresets,
      ).join(", ")}`,
    );
  }

  return {
    ...preset,
    ...options,
    preset: presetName,
  };
}

function nextPatchVersion(version) {
  const match = String(version)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return "1.0.0";
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function slug(value) {
  return String(value || "pake-app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function findApps(volumePath) {
  return fs
    .readdirSync(volumePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(volumePath, entry.name));
}

function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || value === "") {
    fail(`--${name} is required`);
  }
  return String(value);
}

function validateDmg(dmgPath) {
  run("hdiutil", ["imageinfo", dmgPath]);
  run("shasum", ["-a", "256", dmgPath]);
}

function parseVolumePath(attachOutput) {
  const matches = [...attachOutput.matchAll(/\/Volumes\/[^\n\r]+/g)];
  return matches.length ? matches[matches.length - 1][0].trim() : "";
}

function tryReadBundleValue(appPath, key) {
  const infoPath = path.join(appPath, "Contents", "Info");
  const result = spawnSync("defaults", ["read", infoPath, key], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.status !== 0 || result.error) {
    return "";
  }

  return (result.stdout || "").trim();
}

function readBundleValue(appPath, key) {
  const value = tryReadBundleValue(appPath, key);
  if (!value) {
    fail(`Unable to read ${key} from ${appPath}`);
  }
  return value;
}

function installedAppPath(appName) {
  return path.join("/Applications", `${appName.replace(/\.app$/, "")}.app`);
}

function resolveAppVersion(appName, requestedVersion) {
  if (requestedVersion !== "auto") {
    return requestedVersion;
  }

  const installedPath = installedAppPath(appName);
  const currentVersion = fs.existsSync(installedPath)
    ? tryReadBundleValue(installedPath, "CFBundleShortVersionString")
    : "";
  const nextVersion = nextPatchVersion(currentVersion);

  console.error(
    currentVersion
      ? `auto app version: ${currentVersion} -> ${nextVersion}`
      : `auto app version: no installed ${appName}; using ${nextVersion}`,
  );

  return nextVersion;
}

function appMetadata(appPath) {
  const appName = path.basename(appPath).replace(/\.app$/, "");
  return {
    appName,
    bundleName: tryReadBundleValue(appPath, "CFBundleName"),
    bundleIdentifier: tryReadBundleValue(appPath, "CFBundleIdentifier"),
    bundleExecutable: tryReadBundleValue(appPath, "CFBundleExecutable"),
  };
}

function pgrepLines(pattern) {
  if (!pattern) {
    return [];
  }

  const result = spawnSync("pgrep", ["-fl", pattern], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    return [];
  }

  return (result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("scripts/pake-ops.mjs"));
}

function runningAppProcesses(metadata) {
  const patterns = [
    metadata.appName,
    metadata.bundleName,
    metadata.bundleIdentifier,
    metadata.bundleExecutable,
  ].filter(Boolean);
  const seen = new Set();
  const lines = [];

  for (const pattern of patterns) {
    for (const line of pgrepLines(pattern)) {
      const pid = line.split(/\s+/, 1)[0] || line;
      if (!seen.has(pid)) {
        seen.add(pid);
        lines.push(line);
      }
    }
  }

  return lines;
}

function runOptional(bin, args) {
  logCommand(bin, args);
  return spawnSync(bin, args, {
    cwd: repoRoot,
    stdio: "inherit",
    encoding: "utf8",
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function quitRunningApp(metadata) {
  const beforeQuit = runningAppProcesses(metadata);
  if (beforeQuit.length === 0) {
    return;
  }

  const appSelector = metadata.bundleIdentifier
    ? `id ${JSON.stringify(metadata.bundleIdentifier)}`
    : JSON.stringify(metadata.bundleName || metadata.appName);
  const result = runOptional("osascript", [
    "-e",
    `tell application ${appSelector} to quit`,
  ]);

  if (result.status !== 0) {
    fail(`Unable to quit ${metadata.bundleName || metadata.appName}`);
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (runningAppProcesses(metadata).length === 0) {
      return;
    }
    sleep(250);
  }

  fail(
    `${metadata.bundleName || metadata.appName} is still running after quit request:\n${runningAppProcesses(
      metadata,
    ).join("\n")}`,
  );
}

function installDmg(dmgPath, options = {}) {
  const absoluteDmg = path.resolve(repoRoot, dmgPath);
  const dryRun = Boolean(options.dryRun);

  if (!fs.existsSync(absoluteDmg)) {
    fail(`DMG not found: ${absoluteDmg}`);
  }

  if (dryRun) {
    console.log(`dry-run: would validate ${absoluteDmg}`);
    console.log(`dry-run: would mount ${absoluteDmg}`);
    if (options.quitRunning) {
      console.log("dry-run: would quit the contained app if it is running");
    }
    console.log("dry-run: would copy the contained .app into /Applications");
    console.log(
      "dry-run: would read installed bundle metadata and detach the DMG",
    );
    return;
  }

  validateDmg(absoluteDmg);

  let volumePath = "";
  try {
    const attachOutput = runCapture("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      absoluteDmg,
    ]);
    volumePath = parseVolumePath(attachOutput);
    if (!volumePath) {
      fail("Unable to find mounted /Volumes path in hdiutil output");
    }

    const apps = findApps(volumePath);
    if (apps.length === 0) {
      fail(`No .app found in ${volumePath}`);
    }
    if (apps.length > 1) {
      fail(`Multiple .app bundles found in ${volumePath}: ${apps.join(", ")}`);
    }

    const sourceApp = apps[0];
    const appName = path.basename(sourceApp);
    const displayName = appName.replace(/\.app$/, "");
    const destinationApp = path.join("/Applications", appName);
    const metadata = appMetadata(sourceApp);

    if (options.quitRunning) {
      quitRunningApp(metadata);
    }

    const runningLines = runningAppProcesses(metadata);
    if (runningLines.length > 0) {
      fail(
        `${displayName} appears to be running. Quit it or pass --quit-running before installing:\n${runningLines.join(
          "\n",
        )}`,
      );
    }

    run("ditto", [sourceApp, destinationApp]);
    run("ls", ["-ld", destinationApp]);

    const bundleName = readBundleValue(destinationApp, "CFBundleName");
    const version = readBundleValue(
      destinationApp,
      "CFBundleShortVersionString",
    );
    const identifier = readBundleValue(destinationApp, "CFBundleIdentifier");
    console.log(`installed: ${destinationApp}`);
    console.log(`bundle: ${bundleName}`);
    console.log(`version: ${version}`);
    console.log(`identifier: ${identifier}`);
  } finally {
    if (volumePath) {
      run("hdiutil", ["detach", volumePath]);
    }
  }
}

function runPnpm(args) {
  run(pnpm[0], [pnpm[1], ...args]);
}

function verify(options) {
  if (
    boolOpt(options, "install", false) ||
    !fs.existsSync(path.join(repoRoot, "node_modules"))
  ) {
    runPnpm(["install", "--frozen-lockfile"]);
  }

  const tests = options.test || [];
  const prettierTargets = options.prettier || [];

  for (const testPath of tests) {
    runPnpm(["exec", "vitest", "run", testPath]);
  }

  if (prettierTargets.length > 0) {
    runPnpm(["exec", "prettier", "--check", ...prettierTargets]);
  }

  if (boolOpt(options, "cli-build", false)) {
    runPnpm(["run", "cli:build"]);
  }
}

function verifyDownloadFix(options) {
  verify({
    ...options,
    test: ["tests/unit/event-link-guard.test.js"],
    prettier: [
      "src-tauri/src/inject/event.js",
      "tests/unit/event-link-guard.test.js",
    ],
    "cli-build": true,
  });
}

function buildApp(options) {
  const resolvedOptions = applyPreset(options);
  const repo = String(opt(resolvedOptions, "repo", "w-maruoka/Pake"));
  const workflow = String(
    opt(resolvedOptions, "workflow", "Build My Pake App"),
  );
  const ref = String(opt(resolvedOptions, "ref", "main"));
  const name = String(opt(resolvedOptions, "name", ""));
  let runId = resolvedOptions["run-id"]
    ? String(resolvedOptions["run-id"])
    : "";
  const dryRun = boolOpt(resolvedOptions, "dry-run", false);

  if (!runId) {
    const url = requireOption(resolvedOptions, "url");
    const appName = requireOption(resolvedOptions, "name");
    const fields = {
      platform: opt(resolvedOptions, "platform", "macos-latest"),
      url,
      name: appName,
      icon: opt(resolvedOptions, "icon", ""),
      inject: opt(resolvedOptions, "inject", ""),
      width: opt(resolvedOptions, "width", "1200"),
      height: opt(resolvedOptions, "height", "800"),
      app_version: resolveAppVersion(
        appName,
        String(opt(resolvedOptions, "app-version", "1.0.0")),
      ),
      fullscreen: boolOpt(resolvedOptions, "fullscreen", false),
      hide_title_bar: boolOpt(resolvedOptions, "hide-title-bar", true),
      multi_arch: boolOpt(resolvedOptions, "multi-arch", true),
      macos_target: opt(resolvedOptions, "macos-target", "universal"),
      windows_target: opt(resolvedOptions, "windows-target", "x64"),
      linux_targets: opt(resolvedOptions, "linux-targets", "appimage"),
      performance_profile: opt(
        resolvedOptions,
        "performance-profile",
        "default",
      ),
      force_internal_navigation: boolOpt(
        resolvedOptions,
        "force-internal-navigation",
        false,
      ),
      new_window: boolOpt(resolvedOptions, "new-window", false),
    };

    const ghArgs = ["workflow", "run", workflow, "-R", repo, "--ref", ref];
    for (const [key, value] of Object.entries(fields)) {
      ghArgs.push("-f", `${key}=${value}`);
    }

    if (dryRun) {
      console.log(`dry-run: would run ${formatCommand("gh", ghArgs)}`);
      if (boolOpt(resolvedOptions, "install", false)) {
        console.log(
          `dry-run: would watch the run, download artifacts, validate the DMG, and install ${appName}`,
        );
      }
      return;
    }

    const output = runCapture("gh", ghArgs);
    const match = output.match(/\/runs\/(\d+)/);
    if (!match) {
      fail("Unable to parse GitHub Actions run id from gh output");
    }
    runId = match[1];
  }

  if (dryRun) {
    console.log(
      `dry-run: would watch/download artifacts for run ${runId} from ${repo}`,
    );
    return;
  }

  if (!boolOpt(resolvedOptions, "no-watch", false)) {
    run("gh", ["run", "watch", runId, "-R", repo, "--exit-status"]);
  }

  const outRoot = path.resolve(
    repoRoot,
    String(
      opt(
        resolvedOptions,
        "out",
        path.join("artifacts", `${slug(name)}-${runId}`),
      ),
    ),
  );
  fs.mkdirSync(outRoot, { recursive: true });
  run("gh", ["run", "download", runId, "-R", repo, "-D", outRoot]);

  const files = walkFiles(outRoot);
  for (const file of files) {
    console.log(path.relative(repoRoot, file));
  }

  const dmgs = files.filter((file) => file.endsWith(".dmg"));
  for (const dmg of dmgs) {
    validateDmg(dmg);
  }

  if (boolOpt(resolvedOptions, "install", false)) {
    if (dmgs.length === 0) {
      fail("No DMG artifact found to install");
    }
    if (dmgs.length > 1) {
      fail(
        `Multiple DMGs found; install explicitly with install-dmg: ${dmgs.join(", ")}`,
      );
    }
    installDmg(dmgs[0], {
      quitRunning: boolOpt(resolvedOptions, "quit-running", false),
    });
  }
}

const { command, options } = parseArgs(process.argv.slice(2));

if (
  !command ||
  command === "help" ||
  command === "--help" ||
  command === "-h"
) {
  console.log(helpText);
  process.exit(0);
}

switch (command) {
  case "build-app":
    buildApp(options);
    break;
  case "install-dmg":
    installDmg(requireOption(options, "dmg"), {
      dryRun: boolOpt(options, "dry-run", false),
      quitRunning: boolOpt(options, "quit-running", false),
    });
    break;
  case "verify":
    verify(options);
    break;
  case "verify-download-fix":
    verifyDownloadFix(options);
    break;
  default:
    fail(`Unknown command: ${command}\n\n${helpText}`);
}

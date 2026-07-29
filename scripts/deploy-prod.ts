import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type CommandOptions = {
  capture?: boolean;
};

type DeployOptions = {
  dryRun: boolean;
  message?: string;
};

const nodeCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command: string, args: string[], options: CommandOptions = {}): string {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  }) as string;
}

function git(args: string[], capture = false): string {
  return run("git", args, { capture });
}

function nullSeparatedGitList(args: string[]): string[] {
  return git(args, true)
    .split("\0")
    .filter(Boolean);
}

function parseOptions(args: string[]): DeployOptions {
  let dryRun = false;
  let message: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (argument === "--message" || argument === "-m") {
      message = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      console.log(`
Usage:
  npm run deploy:prod
  npm run deploy:prod -- --message "fix: description"
  npm run deploy:prod -- --dry-run --message "fix: description"

The command validates main, checks sensitive paths, runs the typecheck and
production build, displays the diff, then asks for confirmation before commit
and push. --dry-run never stages, commits, or pushes.
`);
      process.exit(0);
    }

    throw new Error(`Option inconnue : ${argument}`);
  }

  if (message !== undefined && message.trim().length === 0) {
    throw new Error("Le message de commit ne peut pas être vide.");
  }

  return { dryRun, message };
}

function isProtectedPath(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? "";

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return fileName !== ".env.example" && fileName !== ".env.sample";
  }

  const protectedDirectories = new Set([
    ".vercel",
    "node_modules",
    "dist",
    "dist-ssr",
    ".output",
    ".vinxi",
    ".tanstack",
    ".nitro",
    "tmp",
    "temp",
    "logs",
    "backup",
    "backups",
    "src.backup",
  ]);

  if (segments.some((segment) => protectedDirectories.has(segment))) {
    return true;
  }

  if (/\.(bak|backup|tmp|temp|orig|swp|swo|pem|key|p12|pfx|keystore)$/i.test(fileName)) {
    return true;
  }

  return /(^|[._-])(secret|secrets|credential|credentials|private[_-]?key|password)([._-]|$)/i.test(fileName);
}

function assertNoProtectedFiles(paths: string[]): void {
  const protectedPaths = paths.filter(isProtectedPath);

  if (protectedPaths.length > 0) {
    throw new Error(
      `Publication bloquée : fichier(s) sensible(s), temporaire(s) ou de sauvegarde détecté(s) :\n${protectedPaths
        .map((filePath) => `  - ${filePath}`)
        .join("\n")}`,
    );
  }
}

function assertMainBranch(): void {
  const branch = git(["branch", "--show-current"], true).trim();
  if (branch !== "main") {
    throw new Error(`Publication bloquée : la branche active est « ${branch || "détachée"} », pas « main ».`);
  }
}

function assertMainIsCurrent(): void {
  git(["fetch", "origin", "main"]);
  const [behind = "0"] = git(["rev-list", "--left-right", "--count", "origin/main...HEAD"], true)
    .trim()
    .split(/\s+/);

  if (Number(behind) > 0) {
    throw new Error("Publication bloquée : main est en retard sur origin/main. Intégrez d’abord les changements distants.");
  }
}

function displayPendingChanges(): void {
  console.log("\n--- État Git ---");
  git(["status", "--short"]);
  console.log("\n--- Statistiques du diff ---");
  git(["diff", "--stat"]);
  git(["diff", "--cached", "--stat"]);
  console.log("\n--- Diff à publier ---");
  git(["diff"]);
  git(["diff", "--cached"]);
}

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

async function getCommitMessage(options: DeployOptions): Promise<string> {
  if (options.message) return options.message;

  if (!stdin.isTTY) {
    throw new Error("Ajoutez --message \"votre message\" lorsque la commande est exécutée sans terminal interactif.");
  }

  const message = await ask("\nMessage de commit : ");
  if (!message) throw new Error("Publication annulée : aucun message de commit n’a été fourni.");
  return message;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  assertMainBranch();
  assertNoProtectedFiles([
    ...nullSeparatedGitList(["ls-files", "-z"]),
    ...nullSeparatedGitList(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  assertMainIsCurrent();

  const workingTreeHasChanges = git(["status", "--porcelain"], true).trim().length > 0;
  if (!workingTreeHasChanges) {
    throw new Error("Aucun changement local à publier.");
  }

  if (git(["diff", "--cached", "--name-only"], true).trim().length > 0) {
    throw new Error("Publication bloquée : des fichiers sont déjà indexés. Révisez ou désindexez-les avant de lancer la commande.");
  }

  console.log("\n--- Typecheck ---");
  run(nodeCommand, ["tsc", "--noEmit"]);
  console.log("\n--- Build de production ---");
  run(npmCommand, ["run", "build"]);
  displayPendingChanges();

  if (options.dryRun) {
    console.log("\nAperçu terminé : aucun fichier n’a été indexé, commité ou poussé.");
    return;
  }

  const message = await getCommitMessage(options);

  if (!stdin.isTTY) {
    throw new Error("Confirmation impossible sans terminal interactif. Exécutez la commande dans un terminal.");
  }

  const confirmation = await ask("\nTapez PUBLIER pour indexer, créer le commit et pousser sur origin/main : ");
  if (confirmation !== "PUBLIER") {
    console.log("Publication annulée avant toute indexation.");
    return;
  }

  console.log("\n--- Indexation ---");
  git(["add", "-A"]);
  try {
    const stagedPaths = nullSeparatedGitList(["diff", "--cached", "--name-only", "-z"]);
    assertNoProtectedFiles(stagedPaths);

    if (stagedPaths.length === 0) {
      throw new Error("Aucun changement indexé à publier.");
    }

    git(["diff", "--cached", "--check"]);
    console.log("\n--- Diff indexé ---");
    git(["diff", "--cached"]);
  } catch (error) {
    git(["reset"]);
    throw error;
  }

  git(["commit", "-m", message]);
  git(["push", "origin", "main"]);
  console.log("\nPublication terminée : origin/main a été mis à jour.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nPublication bloquée : ${message}`);
  process.exitCode = 1;
});

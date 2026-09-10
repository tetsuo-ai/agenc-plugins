import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryCopyIssues } from "./copy-policy.mjs";

const issues = repositoryCopyIssues(dirname(fileURLToPath(import.meta.url)));
if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Plugin copy checks passed. New prose still requires English review.");
}

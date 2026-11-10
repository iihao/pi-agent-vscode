/**
 * Session-resume capability test:
 * 1. start with --continue (resume the most recent session)
 * 2. the history message structure returned by getMessages()
 * Run: node scripts/test-session.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const pkgEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(pkgEntry), "cli.js");

// Resume the most recent session with --continue
const client = new RpcClient({ cliPath, args: ["--continue"] });

try {
    console.log("=== 1. Start (--continue) ===");
    await client.start();
    console.log("✓ started");

    const state = await client.getState();
    console.log("✓ session id:", state.sessionId, "| messages:", state.messageCount, "| session file:", state.sessionFile ?? "(none)");

    console.log("\n=== 2. getMessages() history structure ===");
    const messages = await client.getMessages();
    console.log("total messages:", messages.length);
    // Print the structure of the last 2 messages (truncated)
    for (const m of messages.slice(-2)) {
        const summary = JSON.stringify(m, null, 1);
        console.log("---");
        console.log(summary.length > 600 ? summary.slice(0, 600) + "\n...(truncated)" : summary);
    }
} catch (e) {
    console.error("❌ error:", e.message);
    console.error("stderr:", client.getStderr().slice(-400));
} finally {
    await client.stop();
    console.log("\n=== stopped ===");
}

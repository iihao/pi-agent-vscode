/**
 * RPC integration test: verify RpcClient can start pi and receive streaming events and tool calls.
 * Run: node scripts/test-rpc.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

// Resolve the CLI entry inside the package (cli.js next to dist/index.js)
const pkgEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(pkgEntry), "cli.js");
console.log("cliPath:", cliPath);

const client = new RpcClient({ cliPath, args: ["--no-session"] });

let eventCount = 0;
const unsub = client.onEvent((event) => {
    eventCount++;
    let detail = "";
    if (event.type === "message_update") {
        const ae = event.assistantMessageEvent;
        detail = ae.type;
        if (ae.type === "text_delta" && ae.delta) {
            detail += " " + JSON.stringify(String(ae.delta).slice(0, 40));
        } else if (ae.type === "toolcall_start") {
            detail += " tool=" + (ae.toolName ?? "?");
        }
    } else if (event.type === "tool_execution_start") {
        detail = event.toolName + " args=" + JSON.stringify(event.args ?? {}).slice(0, 80);
    } else if (event.type === "tool_execution_end") {
        detail = event.toolName + (event.isError ? " (error)" : " (ok)");
    } else if (event.type === "message_end") {
        detail = "role=" + (event.message?.role ?? "?");
    } else if (event.type === "agent_end") {
        detail = "willRetry=" + event.willRetry;
    } else if (event.type === "agent_settled") {
        detail = "aborted=" + event.aborted;
    }
    console.log(`[${eventCount}] ${event.type}${detail ? " | " + detail : ""}`);
});

try {
    console.log("=== 1. Start RPC session ===");
    await client.start();
    console.log("✓ RpcClient started");

    const state = await client.getState();
    console.log("✓ session model:", JSON.stringify(state.model));

    console.log("\n=== 2. Send a prompt (triggers tool calls) ===");
    const disposition = await client.prompt(
        "Read the package.json file and tell me the value of the name field in one sentence."
    );
    console.log("✓ prompt accepted:", JSON.stringify(disposition));

    await client.waitForIdle();
    console.log("\n=== 3. Done (idle) ===");
    console.log("received", eventCount, "events");
} catch (e) {
    console.error("❌ error:", e.message);
    console.error("stderr:", client.getStderr().slice(-800));
} finally {
    unsub();
    await client.stop();
    console.log("=== stopped ===");
}

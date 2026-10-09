/**
 * RPC 集成测试：验证 RpcClient 能启动 pi、接收流式事件与工具调用
 * 运行：node scripts/test-rpc.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

// 动态解析包内的 CLI 入口（dist/index.js 同目录下的 cli.js）
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
        detail = event.toolName + (event.isError ? " (错误)" : " (成功)");
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
    console.log("=== 1. 启动 RPC 会话 ===");
    await client.start();
    console.log("✓ RpcClient 启动成功");

    const state = await client.getState();
    console.log("✓ 会话模型:", JSON.stringify(state.model));

    console.log("\n=== 2. 发送 prompt（会触发工具调用）===");
    const disposition = await client.prompt(
        "请读取 package.json 文件，用一句话告诉我 name 字段的值。"
    );
    console.log("✓ prompt 受理:", JSON.stringify(disposition));

    await client.waitForIdle();
    console.log("\n=== 3. 完成（idle）===");
    console.log("共收到", eventCount, "个事件");
} catch (e) {
    console.error("❌ 错误:", e.message);
    console.error("stderr:", client.getStderr().slice(-800));
} finally {
    unsub();
    await client.stop();
    console.log("=== 已停止 ===");
}

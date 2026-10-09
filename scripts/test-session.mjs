/**
 * 会话恢复能力测试：
 * 1. --continue 启动（续最近会话）
 * 2. getMessages() 返回的历史消息结构
 * 运行：node scripts/test-session.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const pkgEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(pkgEntry), "cli.js");

// 用 --continue 续最近会话
const client = new RpcClient({ cliPath, args: ["--continue"] });

try {
    console.log("=== 1. 启动（--continue）===");
    await client.start();
    console.log("✓ 启动成功");

    const state = await client.getState();
    console.log("✓ 会话 ID:", state.sessionId, "| 消息数:", state.messageCount, "| 会话文件:", state.sessionFile ?? "(无)");

    console.log("\n=== 2. getMessages() 历史结构 ===");
    const messages = await client.getMessages();
    console.log("消息总数:", messages.length);
    // 打印最后 2 条的结构（截断）
    for (const m of messages.slice(-2)) {
        const summary = JSON.stringify(m, null, 1);
        console.log("---");
        console.log(summary.length > 600 ? summary.slice(0, 600) + "\n…(截断)" : summary);
    }
} catch (e) {
    console.error("❌ 错误:", e.message);
    console.error("stderr:", client.getStderr().slice(-400));
} finally {
    await client.stop();
    console.log("\n=== 已停止 ===");
}

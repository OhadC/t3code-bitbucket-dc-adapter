import { parseArgs } from "node:util";
import { createAdapter } from "./adapter.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    upstream: { type: "string" },
  },
});
if (!values.upstream) {
  console.error("usage: node src/main.ts --upstream https://bitbucket.example.com [--port 8787]");
  process.exit(64);
}

const port = Number(values.port);
createAdapter({ upstream: values.upstream }).listen(port, "127.0.0.1", () => {
  console.log(`t3code-bitbucket-dc-adapter on http://127.0.0.1:${port}/2.0 -> ${values.upstream}`);
});

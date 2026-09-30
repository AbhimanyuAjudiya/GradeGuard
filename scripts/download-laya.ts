// `pnpm laya:download`: fetch the Laya ONNX bundle if missing and load it once, printing progress.
import { getLayaStatus, warmLaya } from "@/lib/laya/client";

const mb = (n: number) => (n / 1e6).toFixed(0);
let last = "";
const timer = setInterval(() => {
  const s = getLayaStatus();
  const line =
    s.state === "downloading"
      ? `downloading ${s.file || "..."} ${mb(s.receivedBytes)}${s.totalBytes ? `/${mb(s.totalBytes)}` : ""} MB`
      : s.state;
  if (line !== last) console.log(line);
  last = line;
}, 1000);

warmLaya()
  .then(() => {
    clearInterval(timer);
    console.log(JSON.stringify(getLayaStatus()));
    process.exit(0);
  })
  .catch((e: unknown) => {
    clearInterval(timer);
    console.error("Laya failed:", e instanceof Error ? e.message : e);
    console.error(JSON.stringify(getLayaStatus()));
    process.exit(1);
  });

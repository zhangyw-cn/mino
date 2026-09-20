import mermaid from "mermaid";
import { escapeHtml } from "../lib/preprocess";
import {
  closeMermaidFullscreen,
  createMermaidBlock,
  type MermaidBlockInstance,
} from "../lib/mermaid-block";

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  mermaidInitialized = true;
}

/** Replace ```mermaid fences in rendered markdown with interactive blocks. */
export async function replaceMermaidBlocksIn(
  container: HTMLElement,
  gen: number,
  currentGen: () => number,
): Promise<void> {
  closeMermaidFullscreen();
  const blocks = container.querySelectorAll("pre code.language-mermaid");
  if (!blocks.length) return;
  if (gen !== currentGen()) return;
  ensureMermaidInit();
  const instances: MermaidBlockInstance[] = [];
  for (const block of blocks) {
    const pre = block.parentElement;
    if (!pre) continue;
    const inst = createMermaidBlock(block.textContent || "", escapeHtml);
    pre.replaceWith(inst.root);
    instances.push(inst);
  }
  for (const inst of instances) {
    if (gen !== currentGen()) return;
    try {
      await mermaid.run({ nodes: [inst.diagramEl] });
      inst.cacheBaseSize();
    } catch {
      inst.setRenderFailed();
    }
  }
}

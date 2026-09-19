export function MarkdownViewer({ initialPath }: { initialPath: string }) {
  return (
    <main className="p-4 font-sans text-sm text-neutral-900">
      Markdown viewer scaffold: {initialPath || "(no path)"}
    </main>
  );
}

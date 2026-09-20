import { useEffect, useRef } from "react";

export type FileEventKind = "added" | "removed" | "changed";
export type AssetEventKind = "asset-changed" | "asset-removed";

export type WatchEventPayload = { path: string };

export type UseWatchEventsOptions = {
  enabled: boolean;
  onFileEvent: (kind: FileEventKind, payload: WatchEventPayload) => void;
  onAssetEvent: (kind: AssetEventKind, payload: WatchEventPayload) => void;
};

function parseEventData(data: string): WatchEventPayload | null {
  try {
    const event = JSON.parse(data) as { path?: unknown };
    if (typeof event.path !== "string") return null;
    return { path: event.path };
  } catch (error) {
    console.error("Invalid live reload event", error);
    return null;
  }
}

export function useWatchEvents({
  enabled,
  onFileEvent,
  onAssetEvent,
}: UseWatchEventsOptions): void {
  const onFileEventRef = useRef(onFileEvent);
  const onAssetEventRef = useRef(onAssetEvent);
  onFileEventRef.current = onFileEvent;
  onAssetEventRef.current = onAssetEvent;

  useEffect(() => {
    if (!enabled) return;
    const events = new EventSource("/api/events");
    const fileKinds: FileEventKind[] = ["added", "removed", "changed"];
    const assetKinds: AssetEventKind[] = ["asset-changed", "asset-removed"];

    for (const kind of fileKinds) {
      events.addEventListener(kind, (message) => {
        const payload = parseEventData(message.data);
        if (payload) onFileEventRef.current(kind, payload);
      });
    }
    for (const kind of assetKinds) {
      events.addEventListener(kind, (message) => {
        const payload = parseEventData(message.data);
        if (payload) onAssetEventRef.current(kind, payload);
      });
    }

    return () => {
      events.close();
    };
  }, [enabled]);
}

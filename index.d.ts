export interface ShravelleConfig {
  endpoint: string | string[]; // ingest gateway URL(s); several = automatic failover
  key: string;                 // browser API key (shv_brw_...)
  app?: string;                // application name shown in the UI
  release?: string;            // version, used for release comparison
  sampleRate?: number;         // 0..1 share of sessions to record (default 1)
  flushInterval?: number;      // ms between sends (default 5000)
  maxBatch?: number;           // events per request (default 100)
  tracePropagationTargets?: (string | RegExp)[]; // API hosts that receive traceparent
  captureClicks?: boolean;
  captureAjax?: boolean;
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
}
declare const Shravelle: {
  init(config: ShravelleConfig): void;
  setUser(id: string): void;
  track(name: string, attributes?: Record<string, string>, value?: number): void;
  error(err: unknown, attributes?: Record<string, string>): void;
  flush(): void;
};
export default Shravelle;

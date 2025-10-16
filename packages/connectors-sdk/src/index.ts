export interface ConnectorContext {
  org: string;
  project: string;
  subject?: string;
  emit: (item: { content: string; meta?: Record<string, unknown> }) => Promise<void>;
  logger?: Console;
}

export interface Connector {
  name: string;
  setup?(ctx: ConnectorContext): Promise<void>;
  sync(ctx: ConnectorContext): Promise<void>;
}

import { Hono } from 'hono';

import { registerConversationOwnershipRoutes, type ConversationOwnershipRouteVariables } from './conversation-handoff-route';

const app = new Hono<{ Variables: ConversationOwnershipRouteVariables }>();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'ai-commerce-api',
  }),
);

registerConversationOwnershipRoutes(app);

export default app;

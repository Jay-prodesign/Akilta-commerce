import { Hono } from 'hono';

import { registerConversationOwnershipRoutes, type ConversationOwnershipRouteVariables } from './conversation-handoff-route';
import { registerUsageSummaryRoutes, type UsageSummaryRouteVariables } from './usage-summary-route';
import { registerCustomerContextRoutes, type CustomerContextRouteVariables } from './customer-context-route';
import { registerConversationListRoutes, type ConversationListRouteVariables } from './conversation-list-route';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'ai-commerce-api',
  }),
);

// Each route group is mounted as its own narrowly-typed sub-app (Hono's idiomatic multi-router
// composition via `.route()`) rather than merged into one shared Variables type on `app` itself —
// that would require a generic Context plumbed through every handler, which defeats Hono's own
// typed `c.get(...)` return types and reintroduces the exact `any` leakage this codebase's lint
// rules (no-unsafe-assignment/no-unsafe-return) exist to catch.
const conversationOwnershipApp = new Hono<{ Variables: ConversationOwnershipRouteVariables }>();
registerConversationOwnershipRoutes(conversationOwnershipApp);
app.route('/', conversationOwnershipApp);

const usageSummaryApp = new Hono<{ Variables: UsageSummaryRouteVariables }>();
registerUsageSummaryRoutes(usageSummaryApp);
app.route('/', usageSummaryApp);

const customerContextApp = new Hono<{ Variables: CustomerContextRouteVariables }>();
registerCustomerContextRoutes(customerContextApp);
app.route('/', customerContextApp);

const conversationListApp = new Hono<{ Variables: ConversationListRouteVariables }>();
registerConversationListRoutes(conversationListApp);
app.route('/', conversationListApp);

export default app;
